// 一次性对拍（182 跑）：BP59 crash 急跌进行时第三形态轴（commit 5e871034）——
// fresh gateBuyPoint persist:false，锚=首 BUY 信号行 created_at。
// 矩阵：
//   翻案：2ef6（bt-v96 立法案——+81.6% 横盘后买点前 5s 突发 -32%、chg5=chg10=-32.4
//     同深无铺垫，首版判 normal_dip(0.53) 误放 → 应翻 crash 拒 entry_gate）
//   不翻（正例锚——chg5 温和或已收复）：a813(-0.8)/f485/c84a/28ad(+14) 保持 normal_dip 非拒
//   照拒：LOVE/STOCKLESS（crash 形态——直线垂直砸落）；米/施工鸭（对倒低价放行不翻）
//   观察：40a2（数值深跌+chg5 边缘张力，不预设）
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2'; // bt-v94
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd'; // bt-v95
const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be'; // bt-v96
const TOKENS = [
  { exp: V96, key: '2ef6-立法翻案', addr: '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777', expect: '翻 crash 拒 entry_gate（BP59 接刀进行时）' },
  { exp: V94, key: 'a813-正例不翻', addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777', expect: 'normal_dip 保持非 crash 拒' },
  { exp: V94, key: 'f485-正例不翻', addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777', expect: 'normal_dip 保持非 crash 拒' },
  { exp: V95, key: 'c84a-正例不翻', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', expect: 'normal_dip 保持非 crash 拒' },
  { exp: V95, key: '28ad-正例不翻', addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', expect: 'normal_dip 保持非 crash 拒' },
  { exp: V94, key: 'LOVE-照拒',     addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', expect: 'crash 拒 entry_gate' },
  { exp: V94, key: 'STOCKLESS-照拒', addr: '0xb6f4e229d446747c41dc1c7eb631816f95f17777', expect: 'crash 拒 entry_gate' },
  { exp: V94, key: '米-不翻',       addr: '0x338a510c6c7abd4c714d74225086542270427777', expect: '放行 neutral' },
  { exp: V94, key: '施工鸭-不翻',   addr: '0x459f1d098437fad48931372f9b16b6ad25297777', expect: '放行 neutral' },
  { exp: V94, key: '40a2-观察',     addr: '0x40a2e8f5ceb8ee6aec025512596b9ffaaa954444', expect: '观察（chg5 边缘不预设）' },
];
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V94, V95, V96]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  for (const t of TOKENS) {
    const { data: sigs, error } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(1);
    if (error || !sigs || !sigs.length) { console.log(`${t.key} 无信号行跳过`); continue; }
    const anchorMs = Date.parse(sigs[0].created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp59-parity' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    console.log(`${t.key} ${sigs[0].created_at.slice(11, 19)} → ${r.status} 综=${a.bucket}(${a.rule})` +
      ` pattern=${dim('market_pattern')} entry=${dim('entry_shape')} act=${dim('activity_level')}` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} curVsAth=${an.currentVsAthPct ?? '?'} chg5=${an.chg5Pct ?? '?'} chg10=${an.chg10Pct ?? '?'} chg30=${an.chg30Pct ?? '?'}` +
      ` nDn5=${an.nearMaxDn5Pct ?? '?'} minGap=${an.curVsMinGapPct ?? '?'} v=${r.questionVersion ?? '?'}` +
      ` || 期望=${t.expect}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
