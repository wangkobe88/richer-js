// 一次性对拍（182 跑）：BP58/题集 BP52 两改制——entry_shape 点位性质新题 + market_pattern 异常盘面识别四桶 + 统一位置门 27.5。
// 七票=bt-v94（85cbad14）全部实际成交票复盘锚（首 BUY 信号时刻）：
//   拒绝组：LOVE/STOCKLESS/币安之心（crash 砸盘——entry_shape 四臂命中）+ 苍蝇（活跃衰减——act=low 或 crash 双拦方向一致）+ YiYi（尖刺拉盘——spike 与统一门 38.8>27.5 双拦）
//   放行组：米/施工鸭（对倒低价 normal_dip → neutral gates_passed）
// 风险点：①米 BP51 fresh 重判曾翻 famous_monopoly（ticks=11 极短窗 Jev 方差）→ 若仍翻③=pattern_gate 拒与用户意图矛盾留痕攒批
//        ②nearMaxUp5Pct（120s 口径）≥ 观察 maxUp5（60s 口径），米 12.0 逼近 15 线须验证不误中 spike
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const EXP = '85cbad14-696f-49b2-baa4-a5407df4a2d2'; // bt-v94
const TOKENS = [
  { key: 'LOVE-砸盘', addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', expect: '拒 entry_gate(crash)' },
  { key: 'STOCKLESS-砸盘', addr: '0xb6f4e229d446747c41dc1c7eb631816f95f17777', expect: '拒 entry_gate(crash)' },
  { key: '币安之心-砸盘', addr: '0x08aa150d7d86c4a0dfa37f310c1380de9c187777', expect: '拒 entry_gate(crash)' },
  { key: '米-对倒低价', addr: '0x338a510c6c7abd4c714d74225086542270427777', expect: '放行 neutral' },
  { key: '施工鸭-对倒低价', addr: '0x459f1d098437fad48931372f9b16b6ad25297777', expect: '放行 neutral' },
  { key: '苍蝇-衰减', addr: '0x04323e04c5f48587951c2d974b7f1b007b6e7777', expect: '拒(activity_gate|entry_gate)' },
  { key: 'YiYi-尖刺', addr: '0xbfc8f025427ef4049b6d679c0506cdf2b4164444', expect: '拒(pattern_gate|entry_gate)' },
];
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', TOKENS.map((t) => t.addr));
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').eq('experiment_id', EXP).in('token_address', TOKENS.map((t) => t.addr));
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  for (const t of TOKENS) {
    const { data: sigs, error } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', EXP).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(1);
    if (error || !sigs || !sigs.length) { console.log(`${t.key} 无信号行跳过`); continue; }
    const anchorMs = Date.parse(sigs[0].created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp58-parity' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    console.log(`${t.key} ${sigs[0].created_at.slice(11, 19)} → ${r.status} 综=${a.bucket}(${a.rule})` +
      ` pattern=${dim('market_pattern')} entry=${dim('entry_shape')} act=${dim('activity_level')}` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} curVsAth=${an.currentVsAthPct ?? '?'} chg30=${an.chg30Pct ?? '?'}` +
      ` nUp5=${an.nearMaxUp5Pct ?? '?'} nDn5=${an.nearMaxDn5Pct ?? '?'} minGap=${an.curVsMinGapPct ?? '?'} v=${r.questionVersion ?? '?'}` +
      ` || 期望=${t.expect}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
