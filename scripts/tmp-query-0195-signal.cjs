// 一次性查询：0x0195…7777 信号 metadata 审计 + trades 盈亏 + rounds 实际列名（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x0195119e4806441c871adada6256296265ed7777';

async function main() {
  const client = await dbManager.getClient();

  const { data: sigs, error } = await client
    .from('strategy_signals')
    .select('*')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(5);
  if (error) throw error;
  for (const s of sigs || []) {
    console.log(`=== signal type=${s.signal_type} at=${s.created_at} ===`);
    const md = s.metadata || {};
    console.log('metadata keys:', Object.keys(md).join(','));
    for (const k of ['narrativeCall', 'gmgnCheck', 'narrativeRoundsSummary']) {
      if (md[k]) console.log(`--${k}:`, JSON.stringify(md[k]).slice(0, 600));
    }
    const pf = md.preBuyCheckFactors || md.factorResults || md.factors;
    if (pf) {
      const picks = {};
      for (const key of Object.keys(pf)) {
        if (/narrative|gmgn|marketCap|buyVolume|holder|top1|actNet|launch/i.test(key)) picks[key] = pf[key];
      }
      console.log('--factor picks:', JSON.stringify(picks).slice(0, 800));
    }
  }

  const { data: trades, error: e2 } = await client
    .from('trades')
    .select('*')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(10);
  if (e2) throw e2;
  for (const t of trades || []) {
    console.log(`=== trade row keys: ${Object.keys(t).join(',')}`);
    console.log(JSON.stringify(t, null, 1).slice(0, 1200));
  }

  const { data: rounds, error: e3 } = await client
    .from('narrative_analysis_rounds')
    .select('*')
    .eq('token_address', ADDR)
    .limit(5);
  if (e3) throw e3;
  for (const r of rounds || []) {
    console.log('=== round row:', JSON.stringify(r).slice(0, 800));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
