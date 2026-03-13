/**
 * 分析自定义过滤条件的效果
 * 条件: earlyReturn < 300 AND earlyTradesCountPerMin < 150
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

async function main() {
  console.log('=== 分析过滤条件效果 ===\n');
  console.log('条件: earlyReturn < 300% (第一阶段) AND earlyTradesCountPerMin < 150 (第二阶段)\n');

  const expId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取数据
  const { data: trades } = await supabase
    .from('trades')
    .select('token_address, token_symbol, trade_direction, input_amount, output_amount')
    .eq('experiment_id', expId);

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, metadata')
    .eq('experiment_id', expId)
    .eq('action', 'buy')
    .eq('executed', true);

  // 计算收益
  const tokenProfits = {};
  for (const trade of trades || []) {
    const addr = trade.token_address;
    if (!tokenProfits[addr]) {
      tokenProfits[addr] = { symbol: trade.token_symbol, spent: 0, received: 0 };
    }
    if (trade.trade_direction === 'buy') {
      tokenProfits[addr].spent += parseFloat(trade.input_amount || 0);
    } else {
      tokenProfits[addr].received += parseFloat(trade.output_amount || 0);
    }
  }

  const data = (signals || []).map(s => {
    const p = tokenProfits[s.token_address] || { spent: 0, received: 0 };
    const profit = p.spent > 0 ? ((p.received - p.spent) / p.spent * 100) : 0;
    return {
      address: s.token_address,
      symbol: s.token_symbol,
      profit,
      trendFactors: s.metadata?.trendFactors || {},
      preBuyCheckFactors: s.metadata?.preBuyCheckFactors || {}
    };
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【原始数据（无过滤）】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const allProfits = data.map(d => d.profit);
  const winCount = allProfits.filter(p => p > 0).length;
  const lossCount = allProfits.filter(p => p < 0).length;

  console.log(`总代币数: ${data.length}`);
  console.log(`盈利: ${winCount} / 亏损: ${lossCount}`);
  console.log(`胜率: ${(winCount / data.length * 100).toFixed(2)}%`);
  console.log(`平均收益: ${avg(allProfits).toFixed(2)}%`);
  console.log(`总收益: ${allProfits.reduce((sum, p) => sum + p, 0).toFixed(2)}%`);

  // 应用过滤条件
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【应用过滤条件后】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const filtered = data.filter(d => {
    const ear = d.trendFactors.earlyReturn || 0;
    const count = d.preBuyCheckFactors.earlyTradesCountPerMin || 0;
    return ear < 300 && count < 150;
  });

  if (filtered.length === 0) {
    console.log('没有符合条件的代币！');
    return;
  }

  const filteredProfits = filtered.map(d => d.profit);
  const filteredWinCount = filteredProfits.filter(p => p > 0).length;
  const filteredLossCount = filteredProfits.filter(p => p < 0).length;

  console.log(`符合条件的代币数: ${filtered.length} (过滤掉 ${data.length - filtered.length} 个)`);
  console.log(`保留比例: ${(filtered.length / data.length * 100).toFixed(1)}%`);
  console.log('');
  console.log(`盈利: ${filteredWinCount} / 亏损: ${filteredLossCount}`);
  console.log(`胜率: ${(filteredWinCount / filtered.length * 100).toFixed(2)}% (原始: ${(winCount / data.length * 100).toFixed(2)}%)`);
  console.log(`平均收益: ${avg(filteredProfits).toFixed(2)}% (原始: ${avg(allProfits).toFixed(2)}%)`);
  console.log(`总收益: ${filteredProfits.reduce((sum, p) => sum + p, 0).toFixed(2)}%`);

  // 被过滤掉的代币分析
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【被过滤掉的代币分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const removed = data.filter(d => {
    const ear = d.trendFactors.earlyReturn || 0;
    const count = d.preBuyCheckFactors.earlyTradesCountPerMin || 0;
    return ear >= 300 || count >= 150;
  });

  const removedProfits = removed.map(d => d.profit);
  const removedWinCount = removedProfits.filter(p => p > 0).length;

  console.log(`被过滤掉的代币数: ${removed.length}`);
  console.log(`其中盈利的: ${removedWinCount} 个 (占 ${(removedWinCount/removed.length*100).toFixed(1)}%)`);
  console.log(`平均收益: ${avg(removedProfits).toFixed(2)}%`);
  console.log(`总收益: ${removedProfits.reduce((sum, p) => sum + p, 0).toFixed(2)}%`);

  // 被过滤代币的详情
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【被过滤掉的代币详情（按收益排序）】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const removedSorted = [...removed].sort((a, b) => b.profit - a.profit);

  console.log('过滤原因'.padEnd(20) + '代币'.padEnd(15) + '收益'.padEnd(10) + 'EAR'.padEnd(10) + 'Count/min');
  console.log('─'.repeat(70));

  for (const r of removedSorted) {
    const ear = r.trendFactors.earlyReturn || 0;
    const count = r.preBuyCheckFactors.earlyTradesCountPerMin || 0;

    let reason = '';
    if (ear >= 300 && count >= 150) reason = 'EAR>=300 + Cnt>=150';
    else if (ear >= 300) reason = 'EAR>=300';
    else if (count >= 150) reason = 'Cnt>=150';

    console.log(
      reason.padEnd(20) +
      r.symbol.padEnd(15) +
      `${r.profit.toFixed(2)}%`.padEnd(10) +
      `${ear.toFixed(0)}%`.padEnd(10) +
      count.toFixed(0)
    );
  }

  // 保留的代币详情
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【保留的代币详情（按收益排序）】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const keptSorted = [...filtered].sort((a, b) => b.profit - a.profit);

  console.log('代币'.padEnd(20) + '收益'.padEnd(10) + 'EAR'.padEnd(10) + 'Count/min'.padEnd(10) + 'age');
  console.log('─'.repeat(65));

  for (const r of keptSorted) {
    const ear = r.trendFactors.earlyReturn || 0;
    const count = r.preBuyCheckFactors.earlyTradesCountPerMin || 0;
    const age = r.trendFactors.age || 0;

    console.log(
      r.symbol.padEnd(20) +
      `${r.profit.toFixed(2)}%`.padEnd(10) +
      `${ear.toFixed(0)}%`.padEnd(10) +
      count.toFixed(0).padEnd(10) +
      `${age.toFixed(2)}min`
    );
  }

  // 总结
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【总结】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const improvement = avg(filteredProfits) - avg(allProfits);
  const winRateImprovement = (filteredWinCount / filtered.length * 100) - (winCount / data.length * 100);

  console.log(`如果应用这个过滤条件：`);
  console.log(`• 交易数量: ${data.length} → ${filtered.length} (减少 ${data.length - filtered.length} 个, ${((1 - filtered.length/data.length)*100).toFixed(1)}%)`);
  console.log(`• 胜率: ${(winCount / data.length * 100).toFixed(2)}% → ${(filteredWinCount / filtered.length * 100).toFixed(2)}% (${winRateImprovement >= 0 ? '+' : ''}${winRateImprovement.toFixed(2)}%)`);
  console.log(`• 平均收益: ${avg(allProfits).toFixed(2)}% → ${avg(filteredProfits).toFixed(2)}% (${improvement >= 0 ? '+' : ''}${improvement.toFixed(2)}%)`);
  console.log('');
  console.log(`这个过滤条件${improvement > 0 ? '有效' : '无效'}，建议${improvement > 0 ? '采用' : '不采用'}。`);
}

main().catch(console.error);
