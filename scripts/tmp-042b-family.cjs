const { dbManager } = require('../src/services/dbManager');
const EXPS = {
  'd345': 'd3453504-03d5-480c-89e0-483db930361c',
  'd345a': 'a76a1c82-d329-4809-976d-bb2e2e222688',
  'd345b': 'c73b62be-bb1d-4acf-8002-652e5fb8a507',
  'bt-v150': '8ebaccce-62c6-4209-a2a0-40f361c49bf9',
  'bt-v156': 'b8ae9f2e-832f-42db-bbda-8d8701aecb63',
};
(async () => {
  const c = dbManager.getClient();
  console.log('exp | token | 时间(虚拟钟) | 状态 | pp | peak | chg5 | chg10 | chg30 | curVs | sinceLastFamous | sinceLastSmart | rFamSell | rSmartSell');
  for (const [name, id] of Object.entries(EXPS)) {
    const { data: sigs, error } = await c.from('strategy_signals')
      .select('token_symbol,created_at,metadata')
      .eq('experiment_id', id).eq('signal_type', 'SELL')
      .eq('metadata->>strategyId', 'sell_2_5')
      .order('created_at', { ascending: true }).limit(100);
    if (error) { console.log(name, 'ERR', error.message); continue; }
    for (const s of sigs || []) {
      const md = s.metadata || {};
      const fsf = md.factorSellFilter || {};
      const tf = md.trendFactors || {};
      const st = md.execution_status ?? (s.executed ? 'executed' : '?');
      const chg5 = fsf.chg5Pct ?? tf.chg5Pct;
      const chg10 = tf.chg10Pct ?? '-';
      const chg30 = fsf.recoveryMinChg5Pct !== undefined ? tf.chg30Pct : tf.chg30Pct;
      const pp = md.profitPercent;
      console.log(`${name} | ${s.token_symbol} | ${s.created_at.slice(5, 19)} | ${st}${fsf.rule ? '(' + fsf.rule + ')' : ''} | pp=${pp?.toFixed(1)} peak=${(fsf.peakProfitPct ?? tf.peakProfitPct)?.toFixed?.(1)} | chg5=${chg5} chg10=${chg10} chg30=${tf.chg30Pct} | curVs=${fsf.currentVsLaunchPct ?? tf.currentVsLaunchPct} | sLF=${fsf.sinceLastFamousBigBuySec ?? tf.sinceLastFamousBigBuySec} sLS=${fsf.sinceLastSmartBigBuySec ?? tf.sinceLastSmartBigBuySec} | rFS=${fsf.recentFamousSellBnb} rSS=${fsf.recentSmartSellBnb}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
