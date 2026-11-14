// 一次性查询：v72 票 0xc50a...7777 最后一笔卖出为何走止损臂（本地小查询）
const { dbManager } = require('../src/services/dbManager.js');

const EXP = 'edbd5b38-27db-4dd4-8205-4bebfa410ea6';
const TOKEN = '0xc50a297634f887496988c45cdfcb0a516e2b7777';

async function main() {
  const client = await dbManager.getClient();

  // 1. 实验配置：stopLoss 段 + 卖腿
  const { data: exp, error: expErr } = await client.from('experiments')
    .select('id,status,config').eq('id', EXP).limit(1);
  if (expErr) throw expErr;
  const cfg = exp[0]?.config || {};
  console.log('=== 实验 ===');
  console.log('status=', exp[0]?.status);
  console.log('platform=', cfg.platform);
  console.log('stopLoss 段 =', JSON.stringify(cfg.stopLoss ?? null));
  const sc = cfg.strategiesConfig || {};
  for (const l of (sc.sellStrategies || [])) {
    console.log(`卖腿[${l.name}] id=${l.id} stopLossPrice=${l.stopLossPrice ?? '-'} stopLossTime=${l.stopLossTime ?? '-'}` +
      ` cards=${JSON.stringify(l.cards ?? null)} cooldownSec=${l.cooldownSec ?? '-'} maxExecutions=${l.maxExecutions ?? '-'} bypass=${l.bypassDebounce ?? '-'}` +
      ` cond=${(l.condition || '').slice(0, 90)}`);
  }
  for (const l of (sc.buyStrategies || [])) {
    console.log(`买腿[${l.name}] id=${l.id}`);
  }

  // 2. 该 token 全部信号
  const { data: sigs, error: sigErr } = await client.from('strategy_signals')
    .select('id,created_at,signal_type,action,executed,reason,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(100);
  if (sigErr) throw sigErr;
  console.log('\n=== 信号 ===');
  for (const s of sigs) {
    const m = s.metadata || {};
    console.log(`${s.created_at} | ${s.signal_type} ${s.action} | executed=${s.executed} | price=${m.price ?? '?'}` +
      ` | strat=${m.strategyId ?? m.strategyName ?? '?'}` +
      ` | profitPercent=${m.profitPercent ?? '?'} realHold=${m.realHoldDuration ?? '?'} hold=${m.holdDuration ?? '?'}` +
      ` | signalId=${s.id}`);
  }

  // 3. 最后一笔卖出信号 metadata 关键域
  const sells = sigs.filter(s => s.action === 'sell');
  const lastSell = sells[sells.length - 1];
  if (lastSell) {
    const m = lastSell.metadata || {};
    console.log('\n=== 最后一笔卖出信号 detail ===');
    console.log('id=', lastSell.id, '| created_at=', lastSell.created_at, '| executed=', lastSell.executed);
    console.log('strategyId=', m.strategyId, '| strategyName=', m.strategyName);
    console.log('reason=', lastSell.reason);
    for (const k of ['profitPercent', 'realHoldDuration', 'holdDuration', 'currentPriceBnb', 'buyPriceBnb',
      'peakProfitPct', 'drawdownFromPeakPct', 'buySignalAt', 'buyExecutedAt', 'cardTrade']) {
      if (m[k] !== undefined) console.log(`  ${k}=${JSON.stringify(m[k])}`);
    }
  }

  // 4. 该 token 成交
  const { data: trades, error: tErr } = await client.from('trades')
    .select('id,created_at,trade_direction,success,price_bnb,token_amount,bnb_amount,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  if (tErr) throw tErr;
  console.log('\n=== 成交 ===');
  for (const t of trades) {
    console.log(`${t.created_at} | ${t.trade_direction} | success=${t.success} | price_bnb=${t.price_bnb}` +
      ` | bnb=${t.bnb_amount} | id=${t.id}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
