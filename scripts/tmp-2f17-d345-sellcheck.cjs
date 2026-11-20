const { dbManager } = require('../src/services/dbManager');
const EXP = 'd3453504-03d5-480c-89e0-483db930361c';
const TOKEN = '0x2f17249e8d291ecb422fc5c0fc0eb313b7a57777';
async function main() {
  const sb = dbManager.getClient();
  // 1. 实验配置
  const { data: exp } = await sb.from('experiments')
    .select('id,name,trading_mode,status,created_at,config')
    .eq('id', EXP).single();
  if (!exp) { console.log('experiment not found'); process.exit(1); }
  console.log('===== 实验 =====');
  console.log(exp.name, '|', exp.trading_mode, '|', exp.status, '| created:', exp.created_at);
  const ws = (exp.config && (exp.config.fourmemeWs || exp.config.flapWs)) || {};
  console.log('factorSellFilter 段:', JSON.stringify(ws.factorSellFilter ?? null));
  console.log('fourmemeWs 键:', Object.keys(exp.config?.fourmemeWs || {}).join(','));
  // 2. 该 token 全部信号
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('signal_type,created_at,execution_status,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(30);
  if (error) throw error;
  console.log('\n===== 信号（' + sigs.length + ' 行）=====');
  for (const s of sigs) {
    const m = s.metadata || {};
    console.log(`\n--- [${s.created_at}] ${s.signal_type} status=${s.execution_status} ---`);
    console.log('  metadata 键:', Object.keys(m).join(','));
    if (s.signal_type === 'SELL') {
      if (m.factorSellFilter) console.log('  factorSellFilter:', JSON.stringify(m.factorSellFilter));
      else console.log('  (无 factorSellFilter 段)');
      const fsf = m.factors || m.factorResults || {};
      const pick = {};
      for (const k of ['profitPercent', 'sinceLastFamousBigBuySec', 'recentFamousSellBnb',
        'sinceLastSmartBigBuySec', 'recentSmartSellBnb', 'sinceEntryNetBuyRatio',
        'sinceEntryBuyBnb', 'realHoldDuration', 'currentPriceBnb'])
        if (fsf[k] !== undefined) pick[k] = fsf[k];
      console.log('  卖出帧因子:', JSON.stringify(pick));
      if (m.legName || m.leg) console.log('  触发腿:', m.legName || m.leg);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
