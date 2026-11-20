require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data } = await sb.from('strategy_signals')
    .select('id,created_at,metadata->cheatCheck,metadata->buyPoint->anchors->routerEntryBuyPct')
    .eq('experiment_id', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f')
    .eq('token_address', '0x06c78718d19d9a19721d4794f80606976e428888')
    .eq('signal_type', 'BUY').limit(5);
  for (const s of data) {
    console.log('signal', s.created_at);
    const ch = s.cheatCheck;
    if (ch) {
      console.log('cheat info:', JSON.stringify({ status: ch.status, grade: ch.grade, reasons: ch.gradeReasons || ch.reasons, levels: ch.levels }).slice(0, 900));
    } else console.log('cheatCheck: 无(跳过?)');
    console.log('bp anchors routerEntryBuyPct:', s.routerEntryBuyPct);
  }
  // cheat_detection 表观测行（锚窗 count 口径真值）
  const { data: obs, error } = await sb.from('cheat_detection')
    .select('created_at,grade,digest').eq('token_address', '0x06c78718d19d9a19721d4794f80606976e428888')
    .order('created_at').limit(5);
  if (error) console.log('cheat_detection err:', error.message);
  else for (const o of obs || []) {
    const d = o.digest || {};
    console.log('obs', o.created_at, 'grade:', o.grade, 'routerEntryBuyPct:', d.anchors ? d.anchors.routerEntryBuyPct : undefined, 'activity:', d.activityLevel);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
