require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const p = await sb.from('gmgn_wallet_profiles').select('address,stats_period,buy_count,sell_count,token_num,realized_profit,winrate,last_active_sec,fetched_at').limit(5);
  if (p.error) console.log('profiles err:', p.error.message);
  else {
    console.log('profiles cols:', Object.keys(p.data[0]).join(','));
    const c = await sb.from('gmgn_wallet_profiles').select('address', { count: 'exact', head: true });
    console.log('profiles 行数:', c.count, '| fetched_at 范围样本:', p.data.map(r => r.fetched_at).join(','));
  }
  // 信号行 GMGN 原始数据是否在（signalGate 腿应无 GMGN 层）
  const g = await sb.from('strategy_signals').select('id,gmgn_token_info_raw_data')
    .eq('experiment_id', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f').eq('signal_type', 'BUY').not('gmgn_token_info_raw_data', 'is', null).limit(3);
  console.log('bt-v162 带 gmgn_token_info_raw_data 的 BUY 信号:', g.data ? g.data.length : g.error && g.error.message);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
