// 一次性：三票点名信号锚全键 dump——臂 B recentDip5/近窗买入/最密 5s 波定线用
const { dbManager } = require('../../src/services/dbManager.js');
const V101 = 'bbd6e464-f8db-46c3-93b4-6638e53d72dc';
const TOKENS = [
  ['28ad', '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', ['07:15:58']],
  ['c84a', '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', null],
  ['ba5e', '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', ['07:40:45']],
];
// 只打与三条裁定相关的键
const KEYS = [
  'chg5Pct', 'chg10Pct', 'chg30Pct', 'currentVsAthPct', 'curVsMinGapPct', 'nearMaxDn5Pct', 'nearMaxUp5Pct',
  'recentDip5Pct', 'recentDip5SecAgo', 'recentDip5UnrecoveredPct',
  'currentVsLaunchPct', 'minVsLaunchPct', 'anchorTickCount',
];
// 近窗/尖刺相关（键名不确定，前缀匹配全打）
const PREFIXES = ['near', 'burst', 'tail', 'open', 'act', 'buy'];
async function main() {
  const client = await dbManager.getClient();
  for (const [name, addr, only] of TOKENS) {
    const { data: sigs } = await client.from('strategy_signals')
      .select('created_at,reason,metadata')
      .eq('experiment_id', V101).eq('token_address', addr)
      .order('created_at', { ascending: true }).limit(40);
    console.log(`\n===== ${name} =====`);
    for (const s of sigs || []) {
      if (!s.reason || s.reason.includes('卖出')) continue;
      const t = s.created_at.slice(11, 19);
      if (only && !only.some((x) => t.startsWith(x))) continue;
      const m = s.metadata || {};
      const bp = m.buyPoint || {};
      const an = bp.anchors || {};
      const dims = bp.dimensions || {};
      const entry = dims.entry_shape || {};
      const pattern = dims.market_pattern || {};
      const line = {};
      for (const k of KEYS) if (an[k] !== undefined) line[k] = an[k];
      console.log(`[${t}] rule=${(bp.assessment || {}).rule} 综=${(bp.assessment || {}).bucket} entry=${entry.bucket}(${entry.prob}) pattern=${pattern.bucket}(${pattern.prob})`);
      console.log(`   ${JSON.stringify(line)}`);
      const extra = {};
      for (const k of Object.keys(an)) {
        if (PREFIXES.some((p) => k.toLowerCase().startsWith(p)) && !KEYS.includes(k)) extra[k] = an[k];
      }
      if (Object.keys(extra).length) console.log(`   近窗/尖刺: ${JSON.stringify(extra)}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
