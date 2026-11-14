// T003 信号 2 完整 cheatCheck metadata 扒取
import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const { data: sigs, error: e } = await c.from('strategy_signals')
  .select('id,created_at,metadata')
  .eq('experiment_id', '5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .eq('token_address', '0xf1fc8f441e224923f44fd45f3f5bc034ba887777')
  .order('created_at');
if (e) throw new Error(e.message);
for (const s of sigs) {
  const cc = s.metadata?.cheatCheck;
  if (!cc) continue;
  console.log('=== signal', s.id.slice(0, 8), s.created_at, '===');
  console.log('cheatCheck 顶层键:', Object.keys(cc).join(','));
  const lv = cc.levels ?? cc.info?.levels ?? null;
  const an = cc.anchors ?? cc.info?.anchors ?? null;
  if (lv) console.log('levels 键:', Object.keys(lv).join(','));
  if (an) console.log('anchors 键:', Object.keys(an).join(','));
  if (an) {
    const nd = Object.entries(an).filter(([k]) => k.toLowerCase().includes('dump'));
    console.log('anchors dump 相关键:', JSON.stringify(Object.fromEntries(nd)));
  }
  if (lv) {
    const nd = Object.entries(lv).filter(([k]) => k.toLowerCase().includes('dump'));
    console.log('levels dump 相关键:', JSON.stringify(Object.fromEntries(nd)));
  }
  console.log('exempt:', JSON.stringify(cc.exempt ?? null), 'exemptDenied:', JSON.stringify(cc.exemptDenied ?? null));
}
