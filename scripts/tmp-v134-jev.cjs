// v134 Jev 燃烧实测（182）
const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const c = await dbManager.getClient();
  const { data: sigs } = await c.from('strategy_signals').select('metadata').eq('experiment_id', '19ef6433-0c92-47ff-a6fd-9f6bea745b8d').eq('signal_type', 'BUY').range(0, 2999);
  let cheat = 0, bp = 0, tok = 0;
  for (const s of sigs || []) {
    const cc = s.metadata && s.metadata.cheatCheck;
    if (cc && cc.status === 'analyzed') cheat++;
    const u = s.metadata && s.metadata.buyPoint && s.metadata.buyPoint.usage;
    if (u && u.input_tokens) { bp++; tok += (u.input_tokens + (u.output_tokens || 0)); }
  }
  console.log(`v134 Jev 燃烧：cheat=${cheat} / BP=${bp}（${(tok / 1000).toFixed(0)}k tok）`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
