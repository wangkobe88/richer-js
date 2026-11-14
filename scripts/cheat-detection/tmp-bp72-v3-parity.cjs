// 一次性（182 跑）：BP72 v3 题面（7186abc1——近窗延展+a813 正例化+速度不设限轴修正）关键票复跑。
//   v2（对拍 15/18 读数所用）与 v3 差异点验证：a813 判例方向反转/LABU 近窗纯小单句/c84a 放行依据强化/
//   保持组（f485/40a2/海水/米/施工鸭）零回归。
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V100 = '11fc182a-b051-4665-857c-5c14e6713334';
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const logger = { info() {}, warn() {}, error() {} };
const RUNS = [
  // 变化票：v3 判例方向反转（臂 A 近窗延展正例——近 30s 买 0.04×3/卖 0.55×10 买方整体缺席）
  { g: 'V3-a813×2', n: 2, exp: V94, addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777', expect: 'crash 拒=设计内（v3 已正例化）' },
  // 变化票：v3 近窗纯小单句（近 30s 买 0.66×6 全 0.1x 级小单、无一笔像样买）
  { g: 'V3-LABU×2', n: 2, exp: V100, addr: '0x1ac4a310874e29290720d2fb55300a91a23e7777', expect: '翻 crash=近窗延展生效；仍 normal_dip=题面失灵攒批坐实' },
  // 变化票：v3 BP66 轴修正（放行依据=有换手有回调非速度缓）
  { g: 'V3-c84a', n: 1, exp: V95, addr: '0xc84a6831a6727e5f7bfdf941875a842532564444', expect: '翻 normal_dip=新轴生效；维持 crash=Jev 未采信换手证据' },
  // 保持组：v2 已翻 crash 的应保持
  { g: 'V3-f485', n: 1, exp: V94, addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777', expect: '保持 crash（臂 B 正例）' },
  { g: 'V3-40a2', n: 1, exp: V94, addr: '0x40a2e8f5ceb8ee6aec025512596b9ffaaa954444', expect: '保持 crash（臂 B 正例）' },
  { g: 'V3-海水', n: 1, exp: V100, addr: '0x30238ffd6137cd0fa70e681d0d5585d413cbffff', expect: '保持 crash（臂 A 正例+缓砸轴）' },
  // 保持组：反例保护
  { g: 'V3-米', n: 1, exp: V95, addr: '0x338a510c6c7abd4c714d74225086542270427777', expect: '保持不拦（对倒反例）' },
  { g: 'V3-施工鸭', n: 1, exp: V95, addr: '0x459f1d098437fad48931372f9b16b6ad25297777', expect: '保持不拦（对倒反例）' },
  // 方差票：v3 下走向
  { g: 'V3-蝴蝶', n: 1, exp: V100, addr: '0xb359716d1affde1fb9d351fec71a0f2e79257777', expect: '方差票读数（v2：2/3 nd+1/3 crash）' },
];

async function sigsAll(exp, addr) {
  const out = []; let cur = '';
  for (let p = 0; p < 10; p++) {
    let b = dbManager.getClient().from('strategy_signals')
      .select('id,created_at,metadata').eq('experiment_id', exp).eq('signal_type', 'BUY').eq('token_address', addr)
      .order('created_at', { ascending: true }).limit(60); if (cur) b = b.gt('created_at', cur);
    const { data, error } = await b;
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    out.push(...data); cur = data[data.length - 1].created_at; if (data.length < 60) break;
  }
  return out;
}

(async () => {
  const client = await dbManager.getClient();
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', RUNS.map((r) => r.addr));
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V100, V95, V94]).in('token_address', RUNS.map((r) => r.addr));
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));
  for (const r of RUNS) {
    const sigs = await sigsAll(r.exp, r.addr);
    if (!sigs.length) { console.log(`[${r.g}] 无信号`); continue; }
    const withBp = sigs.filter((s) => s.metadata && s.metadata.buyPoint);
    const anchor = withBp.length ? withBp[withBp.length - 1] : sigs[sigs.length - 1];
    const anchorMs = Date.parse(anchor.created_at);
    const p = metaBy.get(r.addr) || {};
    const meta = { address: r.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(r.addr) || p.platform || 'fourmeme' };
    for (let i = 1; i <= (r.n || 1); i++) {
      const bp = new BuyPointCheckService({ enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false }, logger, {});
      const res = await bp.gateBuyPoint(r.addr, meta, { experimentId: 'bp72-v3-parity' }, { anchorMs });
      const a = res.assessment || {}, d = res.dimensions || {}, an = res.anchors || {};
      const es = d.entry_shape || {};
      console.log(`[${r.g} #${i}] 锚${anchor.created_at.slice(11, 19)} 综=${a.bucket}(${a.rule}) entry=${es.bucket}(${es.prob != null ? Number(es.prob).toFixed(2) : '?'})` +
        ` chg5=${an.chg5Pct ?? '?'} rDip=${an.recentDip5Pct ?? '?'}@${an.recentDip5SecAgo ?? '?'}s || 期望=${r.expect}`);
    }
  }
  try { if (typeof dbManager.close === 'function') await dbManager.close(); } catch {}
  process.exit(0);
})();
