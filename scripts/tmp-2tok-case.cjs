require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXP = 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f';
const TOK = [
  '0xf818ac2c5545a3d4b7c643efa18aca7237927777',
  '0xd657ad14ec75dec1882e5a2a8d019079766a7777',
];

async function main() {
  const sb = dbManager.getClient();
  const { data: exp } = await sb.from('experiments').select('experiment_name,trading_mode,config->strategyLibrary,config->strategiesConfig').eq('id', EXP).single();
  console.log(`实验: ${exp?.experiment_name}`);

  for (const t of TOK) {
    const { data: sigs, error } = await sb.from('strategy_signals')
      .select('id,signal_type,action,reason,created_at,executed,metadata,token_symbol')
      .eq('experiment_id', EXP).eq('token_address', t).order('created_at').limit(50);
    if (error) throw new Error(error.message);
    console.log(`\n===== ${t} (${sigs?.[0]?.token_symbol}) 信号 ${sigs?.length} 行 =====`);
    for (const s of sigs || []) {
      console.log(`  ${s.created_at?.slice(5, 19)} ${s.signal_type}/${s.action} executed=${s.executed} price=${s.price} reason=${(s.reason||'').slice(0,60)}`);
      const md = s.metadata || {};
      const segs = Object.keys(md);
      console.log(`    md keys: ${segs.join(',')}`);
    }
    const { data: trs } = await sb.from('trades')
      .select('trade_direction,input_amount,output_amount,unit_price,executed_at,created_at,metadata')
      .eq('experiment_id', EXP).eq('token_address', t).order('created_at').limit(50);
    console.log(`  trades: ${trs?.length}`);
    for (const tr of trs || []) {
      const md = tr.metadata || {};
      console.log(`    ${tr.created_at?.slice(5,19)} ${tr.trade_direction} in=${tr.input_amount} out=${tr.output_amount} why=${md.why || md.reason || '-'}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
