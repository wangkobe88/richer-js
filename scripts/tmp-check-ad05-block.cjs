const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const TOKEN = '0xad05bf6f03a098ae823383fd2e479a4fd3b57777';
const EXP = '0e7c7e09-5b3c-4e14-b039-fce040199f83';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();

  // 1. 叙事评级
  const { data: narr, error: e1 } = await client.from('token_narrative')
    .select('token_address,rating,numeric_rating,reason,created_at,updated_at,token_category')
    .eq('token_address', TOKEN);
  console.log('=== token_narrative ===');
  if (e1) console.error('err:', e1.message);
  console.log(JSON.stringify(narr, null, 1));

  // 2. 叙事轮次（挂实验）
  const { data: rounds, error: e2 } = await client.from('narrative_analysis_rounds')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true });
  console.log('=== narrative_analysis_rounds ===');
  if (e2) console.error('err:', e2.message);
  console.log(JSON.stringify(rounds, null, 1));

  // 3. 信号行
  const { data: sigs, error: e3 } = await client.from('strategy_signals')
    .select('id,strategy_id,signal_type,action,status,created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true });
  console.log('=== strategy_signals ===', (sigs||[]).length, 'rows');
  if (e3) console.error('err:', e3.message);
  if (sigs) for (const s of sigs) {
    const m = s.metadata || {};
    console.log(JSON.stringify({ id: s.id, strat: s.strategy_id, type: s.signal_type, action: s.action, status: s.status, at: s.created_at,
      rating: m.narrativeRating, gmgn: m.gmgnCheck && m.gmgnCheck.evaluated, keys: Object.keys(m).slice(0, 40) }));
  }

  // 4. trades
  const { data: trades } = await client.from('trades')
    .select('id,side,amount_bnb,quantity,created_at').eq('experiment_id', EXP).eq('token_address', TOKEN);
  console.log('=== trades ===', JSON.stringify(trades));

  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
