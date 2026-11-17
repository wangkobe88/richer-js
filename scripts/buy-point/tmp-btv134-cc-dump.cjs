// btv134 蝴蝶人生2.0/老貓 生产 cheat 判定完整 dump（182 跑）
import { dbManager } from '../../src/services/dbManager.js';

const EXP = '19ef6433-0c92-47ff-a6fd-9f6bea745b8d';
const TOKS = {
  '0x8894323f7d264cdd8c5bd635036c06db1eb87777': '蝴蝶人生2.0',
  '0xba67f3e17ebfc3e51645bb95122a747e9adf7777': '老貓',
};

const c = await dbManager.getClient();
const { data, error } = await c.from('strategy_signals')
  .select('id,token_address,created_at,metadata')
  .eq('experiment_id', EXP)
  .eq('signal_type', 'BUY')
  .in('token_address', Object.keys(TOKS));
if (error) throw new Error(error.message);
for (const s of data || []) {
  const cc = (s.metadata || {}).cheatCheck;
  if (!cc) { console.log(`${TOKS[s.token_address]} 无 cheatCheck 段`); continue; }
  console.log(`\n=== ${TOKS[s.token_address]} ${s.created_at}`);
  console.log('grade:', cc.grade, '| exempt:', JSON.stringify(cc.exempt || null));
  console.log('levels:', JSON.stringify(cc.levels || null));
  console.log('buckets:', JSON.stringify(cc.buckets || null));
  console.log('reasons:', JSON.stringify(cc.reasons || []));
  const anchors = cc.anchors || {};
  const keys = Object.keys(anchors).filter(k => /burst|stall|act|tick|span|idle/i.test(k));
  for (const k of keys) console.log(`  anchor ${k}: ${JSON.stringify(anchors[k])}`);
}
process.exit(0);
