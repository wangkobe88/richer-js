/**
 * 对比两个实验的效果
 * b04ea30f vs 933be40d
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function compareExperiments() {
  console.log('=== 对比实验效果 ===\n');

  const experiments = [
    { id: '933be40d-1056-463f-b629-aa226a2ea064', name: '实验933be40d' },
    { id: 'b04ea30f-9591-442c-88ee-677c29b8da4c', name: '实验b04ea30f' }
  ];

  for (const exp of experiments) {
    console.log(`【${exp.name}】\n`);

    // 获取实验配置
    const { data: experimentData } = await supabase
      .from('experiments')
      .select('*')
      .eq('id', exp.id)
      .single();

    if (experimentData) {
      console.log('实验配置:');
      console.log(`  状态: ${experimentData.status}`);
      console.log(`  创建时间: ${experimentData.created_at}`);
      console.log(`  购买前检查条件: ${experimentData.config?.preBuyCheck?.preBuyCheckCondition || experimentData.config?.preBuyCheckCondition || 'N/A'}`);
      console.log('');
    }

    // 获取信号统计
    const { data: buySignals } = await supabase
      .from('strategy_signals')
      .select('*')
      .eq('experiment_id', exp.id)
      .eq('action', 'buy')
      .order('created_at', { ascending: false });

    const executedSignals = buySignals.filter(s => s.metadata?.execution_status === 'executed');
    const rejectedSignals = buySignals.filter(s => s.metadata?.execution_status !== 'executed');

    console.log('信号统计:');
    console.log(`  总信号数: ${buySignals?.length || 0}`);
    console.log(`  执行信号数: ${executedSignals.length}`);
    console.log(`  拒绝信号数: ${rejectedSignals.length}`);

    // 获取交易统计
    const { data: trades } = await supabase
      .from('trades')
      .select('trade_direction, metadata')
      .eq('experiment_id', exp.id);

    if (trades && trades.length > 0) {
      const buyTrades = trades.filter(t => t.trade_direction === 'buy');
      const sellTrades = trades.filter(t => t.trade_direction === 'sell');

      console.log('\n交易统计:');
      console.log(`  买入交易数: ${buyTrades.length}`);
      console.log(`  卖出交易数: ${sellTrades.length}`);

      // 计算收益
      let totalProfit = 0;
      let profitCount = 0;
      let totalLoss = 0;
      let lossCount = 0;

      sellTrades.forEach(t => {
        const profit = t.metadata?.profitPercent || 0;
        if (profit > 0) {
          totalProfit += profit;
          profitCount++;
        } else {
          totalLoss += profit;
          lossCount++;
        }
      });

      console.log('\n收益统计:');
      console.log(`  盈利交易: ${profitCount}个, 总收益: +${totalProfit.toFixed(1)}%`);
      console.log(`  亏损交易: ${lossCount}个, 总亏损: ${totalLoss.toFixed(1)}%`);
      console.log(`  净收益: ${(totalProfit + totalLoss).toFixed(1)}%`);
      console.log(`  胜率: ${(profitCount / sellTrades.length * 100).toFixed(1)}%`);
    }

    // 分析拒绝原因
    if (rejectedSignals.length > 0) {
      console.log('\n【拒绝原因分析】\n');

      const rejectReasons = {};
      rejectedSignals.forEach(signal => {
        const reason = signal.metadata?.preBuyCheckFactors?.checkReason || signal.metadata?.execution_reason || '未知';
        // 提取关键信息
        if (reason.includes('walletClusterCount')) {
          rejectReasons['聚簇条件'] = (rejectReasons['聚簇条件'] || 0) + 1;
        } else if (reason.includes('earlyTrades')) {
          rejectReasons['早期参与者'] = (rejectReasons['早期参与者'] || 0) + 1;
        } else if (reason.includes('holder') || reason.includes('黑名单')) {
          rejectReasons['持有者检查'] = (rejectReasons['持有者检查'] || 0) + 1;
        } else if (reason.includes('未配置')) {
          rejectReasons['未配置条件'] = (rejectReasons['未配置条件'] || 0) + 1;
        } else {
          rejectReasons[reason.substring(0, 20)] = (rejectReasons[reason.substring(0, 20)] || 0) + 1;
        }
      });

      console.log('拒绝原因分类:');
      Object.entries(rejectReasons).forEach(([reason, count]) => {
        console.log(`  ${reason}: ${count}个`);
      });
    }

    // 分析执行信号的聚簇因子
    console.log('\n【执行信号的聚簇因子分析】\n');

    const executedWithFactors = executedSignals.filter(s => s.metadata?.preBuyCheckFactors);
    if (executedWithFactors.length > 0) {
      console.log('代币        | 簇数 | Top2% | Mega% | 簇数>=3 && Top2>85?');
      console.log('------------|------|-------|-------|-------------------');

      executedWithFactors.slice(0, 15).forEach(signal => {
        const factors = signal.metadata?.preBuyCheckFactors;
        const symbol = signal.metadata?.symbol || signal.token_address.substring(0, 8);
        const clusterCount = factors?.walletClusterCount || 0;
        const top2Ratio = ((factors?.walletClusterTop2Ratio || 0) * 100).toFixed(1);
        const megaRatio = ((factors?.walletClusterMegaRatio || 0) * 100).toFixed(1);
        const wouldReject = clusterCount >= 3 && parseFloat(top2Ratio) > 85;

        console.log(`${symbol.substring(0, 11).padEnd(11)} | ${clusterCount.toString().padStart(4)} | ${top2Ratio.padStart(5)}% | ${megaRatio.padStart(5)}% | ${wouldReject ? '❌ 应拒绝' : ''}`);
      });

      if (executedWithFactors.length > 15) {
        console.log(`  ... 还有 ${executedWithFactors.length - 15} 个信号`);
      }
    }

    console.log('\n' + '='.repeat(60) + '\n');
  }

  // 获取收益率对比
  console.log('【收益率对比】\n');

  for (const exp of experiments) {
    const { data: sellTrades } = await supabase
      .from('trades')
      .select('metadata, token_address')
      .eq('experiment_id', exp.id)
      .eq('trade_direction', 'sell')
      .order('metadata->>profitPercent', { ascending: false });

    if (sellTrades && sellTrades.length > 0) {
      console.log(`${exp.name}:`);

      sellTrades.slice(0, 10).forEach(t => {
        const profit = t.metadata?.profitPercent || 0;
        const symbol = t.metadata?.symbol || t.token_address.substring(0, 8);
        const type = profit > 0 ? '✓' : '✗';
        console.log(`  ${type} ${symbol}: ${profit > 0 ? '+' : ''}${profit.toFixed(1)}%`);
      });

      console.log('');
    }
  }
}

compareExperiments().catch(console.error);
