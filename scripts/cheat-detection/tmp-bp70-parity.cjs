// 一次性对拍（182 跑）：BP53 十修/案号 BP70 ③桶 burst 重启盘尘埃残仓豁免臂——
// fresh gateBuyPoint persist:false，锚=BUY 信号行 created_at。矩阵：
//   翻案：28ad 两锚（bt-v100 P1 triggerNo=1/2——restart 立法票被 BP65 薄盘臂吞入；
//     minVs +0.9 基本归零+近 60s 买 1.45B/14 笔涌入，famous 在场净额合计仅 0.0152
//     尘埃（0xfb4e 卖/买 94% 剩 +0.015+0xb4e1 卖/买 112% 已清仓）→ 应翻 none 放行）
//   不翻：59f5（同回 almost_launch 域 minVs 5.2 但 0xe1e3 一笔未卖 0.693、在场净额
//     合计 0.78=真实在场持有 → 照落③拒 pattern_gate）
//   不翻：ea7d（minVs +14 未归零过——BP70 域外照①判读，单 famous 在场 0.1976 保持③）
//   不翻：d928（minVs +20.9 未归零过，双 famous 在场 0.8933 保持③）
//   回归：147d/0432/米338a 收割族保持③；c84a 厚盘 none 保持；LOVE crash 照拒
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be';
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const V100 = '11fc182a-b051-4665-857c-5c14e6713334';
const TOKENS = [
  { exp: V100, key: '28ad-立法翻案(锚1 t1)', addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', anchorIndex: 0, expect: '翻 none 综 neutral 放行（BP70 尘埃残仓豁免——在场净额 0.0152<0.05）' },
  { exp: V100, key: '28ad-立法翻案(锚2 t2)', addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', anchorIndex: 1, expect: '翻 none 综 neutral 放行（BP70 同上——cheat activity_high 豁免后应走通全门）' },
  { exp: V99_TOKEN(), key: '59f5-不翻(在场持有大额)', addr: '0x59f5ccb671f1651db2ca8aba4fd0254fcef87777', fallbackExp: V96, expect: '保持③拒（豁免只给尘埃残仓——0xe1e3 一笔未卖在场净额 0.78）' },
  { exp: V97, key: 'ea7d-不翻(未归零域外)', addr: '0xea7dc0825d4e6d90c026201ecc6aa8d82c577777', expect: '保持③拒（minVs +14 未基本归零过不适用 BP70）' },
  { exp: V96, key: 'd928-不翻(未归零域外)', addr: '0xd9289dbf4fd6716d9d7f443cd07cc43a40ce7777', expect: '保持③拒（minVs +20.9 未基本归零过不适用 BP70）' },
  { exp: V97, key: '147d-回归③', addr: '0x147d75f133130713c803d35a046da9b7c19effff', expect: '保持③拒（收割完臂回归）' },
  { exp: V97, key: '0432-回归③', addr: '0x04323e04c5f48587951c2d974b7f1b007b6e7777', expect: '保持③拒（收割中臂回归）' },
  { exp: V97, key: '米338a-回归③', addr: '0x338a510c6c7abd4c714d74225086542270427777', fallbackExp: V94, expect: '保持③拒（收割完臂回归）' },
  { exp: V95, key: 'c84a-回归none(厚盘)', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', anchorIndex: 1, fallbackExp: V97, expect: 'none 保持（BP62/BP65 厚盘判例——BP70 不误放开）' },
  { exp: V94, key: 'LOVE-回归照拒', addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', expect: 'crash 拒 entry_gate 保持' },
];
function V99_TOKEN() { return '87cc5a7d-d845-4c46-8edd-f19dde4ef10f'; }
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = [...new Set(TOKENS.map((t) => t.addr))];
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V94, V95, V96, V97, V100, V99_TOKEN()]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  for (const t of TOKENS) {
    let sigs = null;
    const idx = t.anchorIndex || 0;
    for (const expId of [t.exp, t.fallbackExp].filter(Boolean)) {
      const { data, error } = await client.from('strategy_signals')
        .select('id,created_at').eq('experiment_id', expId).eq('signal_type', 'BUY')
        .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(idx + 1);
      if (!error && data && data.length > idx) { sigs = data; break; }
    }
    if (!sigs) { console.log(`${t.key} 无信号行跳过`); continue; }
    const anchorMs = Date.parse(sigs[idx].created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp70-parity' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    console.log(`${t.key} ${sigs[idx].created_at.slice(11, 19)} → ${r.status} 综=${a.bucket}(${a.rule})` +
      ` pattern=${dim('market_pattern')} entry=${dim('entry_shape')} act=${dim('activity_level')}` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} minVs=${an.minVsLaunchPct ?? '?'} athVs=${an.athVsLaunchPct ?? '?'} v=${r.questionVersion ?? '?'}` +
      ` || 期望=${t.expect}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
