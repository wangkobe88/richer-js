// 侦察3:narrative_analysis_rounds token 全集 + rating 分布 + 实买 token(小结果)
const { dbManager } = require('../src/services/dbManager');
const EXP = '8a51f2fd-e467-4459-9004-18b9486ab567';
(async () => {
  const client = dbManager.getClient();
  const { data: rounds, error } = await client
    .from('narrative_analysis_rounds').select('token_address,rating,round_no,trigger_reason,from_cache,error,created_at')
    .eq('experiment_id', EXP).limit(5000);
  if (error) { console.log('ERR', error.message); process.exit(1); }
  const byToken = {};
  for (const r of rounds) {
    const t = (byToken[r.token_address] ||= { ratings: [], rounds: 0 });
    t.ratings.push(r.rating); t.rounds++;
  }
  const toks = Object.keys(byToken);
  const finalRating = {};
  for (const [a, t] of Object.entries(byToken)) {
    const last = [...t.ratings].pop();
    const any2or3 = t.ratings.some(x => x === 2 || x === 3);
    const k = any2or3 ? 'ever-2/3' : `last=${last}`;
    finalRating[k] = (finalRating[k] || 0) + 1;
  }
  console.log('rounds rows:', rounds.length, '| tokens:', toks.length);
  console.log('token rating buckets:', JSON.stringify(finalRating, null, 1));
  console.log('window:', rounds[0]?.created_at, '→', rounds[rounds.length - 1]?.created_at);
  // 实买 token
  const { data: trs } = await client.from('trades').select('trade_direction,token_address,input_amount,output_amount,trade_status').eq('experiment_id', EXP).limit(2000);
  const buyToks = new Set((trs || []).filter(t => t.trade_direction === 'BUY').map(t => t.token_address));
  const sellRows = (trs || []).filter(t => t.trade_direction === 'SELL');
  console.log('trades rows:', (trs || []).length, '| BUY tokens:', buyToks.size, '| SELL rows:', sellRows.length);
  const notInRounds = [...buyToks].filter(a => !byToken[a]);
  console.log('实买但无 rounds 的 token:', notInRounds.length, notInRounds.slice(0, 5).join(','));
  // 输出 token 清单供后续用
  const fs = require('fs');
  fs.writeFileSync('/tmp/8a51-rounds-tokens.json', JSON.stringify({
    exp: EXP, tokens: toks.map(a => ({ address: a, ratings: byToken[a].ratings })),
    buyTokens: [...buyToks],
  }, null, 1));
  console.log('written /tmp/8a51-rounds-tokens.json');
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
