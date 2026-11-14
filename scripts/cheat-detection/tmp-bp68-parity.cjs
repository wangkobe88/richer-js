// 一次性对拍（182 跑）：BP68 spike 出拦域——ENTRY_GATE_POOR_BUCKETS 收 ['crash'] 单桶，
// spike 判型保留落档不拦。v100 ea78 案（用户观察「锚窗仅两笔 0.136/0.16 正常额度买单
// 被判 spike」——取证=05:48:33 行综判其实 pattern_gate（统一门 27.8>27.5 T131 毫秒竞态）
// 贴顶臂 -5.13 恰过线误判 spike 判型；用户裁定「我们已经控制了价格，所以 spike 没有
// 必要再存在……或者保留也可以，但是不 block 买入」）。
// 矩阵：
//   ea78 05:48:33（主票首信号）：entry 判型或仍 spike 但不再拦 → 综判只由统一门拒
//     pattern_gate（T131 语义内拒不变——真实价 27.8>27.5）
//   ea78 09:59:56（后四行代表）：act=low 死寂拒 activity_gate 保持（BP68 不动活跃度门）
//   YiYi（bt-v94，生产曾 spike 0.97+统一门 38.8 双拦）：entry 判型照出但综判只剩统一门
//     pattern_gate——终态 poor 不变
//   LOVE（bt-v94）：crash 拒 entry_gate 保持（BP68 只动 spike，crash 拦截保留）
//   米（bt-v94）：normal_dip 放行 neutral 保持
//   施工鸭（bt-v94）：曾 spike/normal_dip 贴顶线摆动（Jev 方差攒批）——BP68 后摆动不再
//     影响综判，期望 neutral 放行（若其它门过）
//   回归锚：147d@v97 ③ pattern_gate 保持 / c84a@v96 none neutral 保持（anchorIndex 1）
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be';
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const TOKENS = [
  { exp: V100, key: 'ea78-首信号', addr: '0xea7886d590ba1d7d6d4e7761148ba26405c67777', anchorIndex: 0, expect: 'entry 或仍 spike 判型、不拦 → 综 poor(pattern_gate) 统一门 27.8>27.5（T131 语义内拒不变）' },
  { exp: V100, key: 'ea78-后段act', addr: '0xea7886d590ba1d7d6d4e7761148ba26405c67777', anchorIndex: 1, expect: '综 poor(activity_gate) act=low 死寂保持（BP68 不动活跃度门）' },
  { exp: V94, key: 'YiYi-尖刺', addr: '0xbfc8f025427ef4049b6d679c0506cdf2b4164444', anchorIndex: 0, expect: '综 poor(pattern_gate) 统一门 38.8>27.5 仍拒——spike 判型照出不拦、终态不变' },
  { exp: V94, key: 'LOVE-砸盘', addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', anchorIndex: 0, expect: '综 poor(entry_gate) crash 拦截保持（BP68 只动 spike）' },
  { exp: V94, key: '米-对倒低价', addr: '0x338a510c6c7abd4c714d74225086542270427777', anchorIndex: 0, expect: '综 neutral(gates_passed) 放行保持' },
  { exp: V94, key: '施工鸭-摆动票', addr: '0x459f1d098437fad48931372f9b16b6ad25297777', anchorIndex: 0, expect: '观察：entry spike/normal_dip 摆动不再影响综判（期望 neutral 放行）' },
  { exp: V97, key: '147d-回归③', addr: '0x147d75f133130713c803d35a046da9b7c19effff', anchorIndex: 0, expect: '综 poor(pattern_gate) ③独食保持（零漂移）' },
  { exp: V96, key: 'c84a-回归none', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', anchorIndex: 1, expect: '综 neutral(gates_passed) none 保持（零漂移）' },
];
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = [...new Set(TOKENS.map((t) => t.addr))];
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V94, V96, V97, V100]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  for (const t of TOKENS) {
    const idx = t.anchorIndex || 0;
    const { data: sigs, error } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(idx + 1);
    if (error || !sigs || sigs.length <= idx) { console.log(`${t.key} 无信号行跳过`); continue; }
    const anchorMs = Date.parse(sigs[idx].created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp68-parity' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    console.log(`${t.key} ${sigs[idx].created_at.slice(11, 19)} → ${r.status} 综=${a.bucket}(${a.rule})` +
      ` pattern=${dim('market_pattern')} entry=${dim('entry_shape')} act=${dim('activity_level')}` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} curVsAth=${an.currentVsAthPct ?? '?'} chg30=${an.chg30Pct ?? '?'}` +
      ` nUp5=${an.nearMaxUp5Pct ?? '?'} v=${r.questionVersion ?? '?'} || 期望=${t.expect}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
