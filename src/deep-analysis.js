const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function deepAnalysis() {
  const experimentId = '8f688916-a7a7-4501-badc-6cc3a5efc8d8';

  console.log('='.repeat(80));
  console.log('实验深度分析报告');
  console.log('实验ID:', experimentId);
  console.log('='.repeat(80));

  // 获取所有数据
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId);

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 按代币分组分析
  const tokenAnalysis = {};

  // 初始化代币分析对象
  tokens.forEach(t => {
    tokenAnalysis[t.token_address] = {
      symbol: t.token_symbol,
      address: t.token_address,
      status: t.status,
      discoveredAt: new Date(t.discovered_at),
      buySignals: [],
      sellSignals: [],
      trades: [],
      apiData: t.raw_api_data ? (typeof t.raw_api_data === 'string' ? JSON.parse(t.raw_api_data) : t.raw_api_data) : null
    };
  });

  // 分析信号
  signals.forEach(s => {
    const addr = s.token_address;
    if (tokenAnalysis[addr]) {
      if (s.signal_type === 'BUY') {
        tokenAnalysis[addr].buySignals.push({
          createdAt: new Date(s.created_at),
          reason: s.reason,
          metadata: s.metadata ? (typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata) : null
        });
      } else if (s.signal_type === 'SELL') {
        tokenAnalysis[addr].sellSignals.push({
          createdAt: new Date(s.created_at),
          reason: s.reason,
          metadata: s.metadata ? (typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata) : null
        });
      }
    }
  });

  // 计算每个代币的盈亏
  console.log('\n【已买入代币盈亏分析】');
  console.log('='.repeat(80));

  const boughtTokens = Object.values(tokenAnalysis).filter(t => t.status === 'bought');
  let totalInvested = 0;
  let totalReturnValue = 0;
  let totalProfit = 0;
  const profitLossList = [];

  boughtTokens.forEach(t => {
    if (t.buySignals.length > 0 && t.sellSignals.length > 0) {
      const buySignal = t.buySignals[0];
      const buyPrice = buySignal.metadata?.price || buySignal.metadata?.tradeResult?.trade?.unit_price || 0;

      // 找到最后一次卖出信号
      const lastSellSignal = t.sellSignals[t.sellSignals.length - 1];
      const sellPrice = lastSellSignal.metadata?.price || 0;
      const profitPercent = lastSellSignal.metadata?.profitPercent || 0;

      const invested = buySignal.metadata?.cardConfig?.totalCards * buySignal.metadata?.cardConfig?.perCardMaxBNB || 0.4;
      const returnValue = invested * (1 + profitPercent / 100);
      const profit = returnValue - invested;

      totalInvested += invested;
      totalReturnValue += returnValue;
      totalProfit += profit;

      profitLossList.push({
        symbol: t.symbol,
        address: t.address,
        buyPrice,
        sellPrice,
        profitPercent,
        invested,
        returnValue,
        profit,
        holdDuration: (lastSellSignal.metadata?.holdDuration / 60).toFixed(2) + '分钟'
      });
    }
  });

  // 按盈亏排序
  profitLossList.sort((a, b) => b.profitPercent - a.profitPercent);

  console.log('\n代币盈亏明细（按收益率排序）：');
  console.log('代币\t\t买入价\t\t卖出价\t\t收益率\t\t投入\t\t回报\t\t利润\t\t持仓时间');
  console.log('-'.repeat(120));
  profitLossList.forEach(p => {
    console.log(`${p.symbol}\t\t${p.buyPrice}\t\t${p.sellPrice}\t\t${p.profitPercent.toFixed(2)}%\t\t${p.invested}\t\t${p.returnValue.toFixed(2)}\t\t${p.profit.toFixed(2)}\t\t${p.holdDuration}`);
  });

  console.log('\n【总体盈亏统计】');
  console.log('总投入:', totalInvested.toFixed(2), 'BNB');
  console.log('总回报:', totalReturnValue.toFixed(2), 'BNB');
  console.log('总盈亏:', totalProfit.toFixed(2), 'BNB');
  console.log('总收益率:', (totalProfit / totalInvested * 100).toFixed(2), '%');

  // 分析盈利和亏损代币
  const profitable = profitLossList.filter(p => p.profitPercent > 0);
  const lossMaking = profitLossList.filter(p => p.profitPercent < 0);

  console.log('\n【盈利代币分析】');
  console.log('盈利代币数:', profitable.length);
  if (profitable.length > 0) {
    const avgProfitPercent = profitable.reduce((sum, p) => sum + p.profitPercent, 0) / profitable.length;
    const totalProfit = profitable.reduce((sum, p) => sum + p.profit, 0);
    console.log('平均收益率:', avgProfitPercent.toFixed(2), '%');
    console.log('总利润:', totalProfit.toFixed(2), 'BNB');
    console.log('\n表现最好的5个代币：');
    profitable.slice(0, 5).forEach(p => {
      console.log(`  ${p.symbol}: ${p.profitPercent.toFixed(2)}% (利润: ${p.profit.toFixed(2)} BNB)`);
    });
  }

  console.log('\n【亏损代币分析】');
  console.log('亏损代币数:', lossMaking.length);
  if (lossMaking.length > 0) {
    const avgLossPercent = lossMaking.reduce((sum, p) => sum + p.profitPercent, 0) / lossMaking.length;
    const totalLoss = lossMaking.reduce((sum, p) => sum + p.profit, 0);
    console.log('平均亏损率:', avgLossPercent.toFixed(2), '%');
    console.log('总亏损:', totalLoss.toFixed(2), 'BNB');
    console.log('\n亏损最严重的5个代币：');
    lossMaking.reverse().slice(0, 5).forEach(p => {
      console.log(`  ${p.symbol}: ${p.profitPercent.toFixed(2)}% (亏损: ${p.profit.toFixed(2)} BNB)`);
    });
  }

  // 分析止损策略
  console.log('\n【止损策略分析】');
  const stopLossTrades = profitLossList.filter(p => p.profitPercent < -30);
  console.log('触发止损的代币数（亏损>30%）:', stopLossTrades.length);
  if (stopLossTrades.length > 0) {
    stopLossTrades.forEach(p => {
      console.log(`  ${p.symbol}: ${p.profitPercent.toFixed(2)}%`);
    });
  }

  // 分析监控中可能错失的机会
  console.log('\n【监控中代币特征分析】');
  const monitoringTokens = Object.values(tokenAnalysis).filter(t => t.status === 'monitoring');

  // 按发现时间分析，看看有没有错过的机会
  const earlyTokens = monitoringTokens.filter(t => {
    const age = (Date.now() - new Date(t.discoveredAt).getTime()) / 1000 / 60; // 分钟
    return age > 30; // 超过30分钟的代币
  });

  console.log('监控中超过30分钟的代币数:', earlyTokens.length);
  console.log('这些代币可能已被系统过滤，分析其特征：');

  // 定义统计变量
  let fdvStats = {
    min: Infinity,
    max: 0,
    avg: 0,
    hasData: false
  };
  let tvlStats = {
    min: Infinity,
    max: 0,
    avg: 0,
    hasData: false
  };

  if (earlyTokens.length > 0) {
    // 分析这些代币的FDV、TVL等特征

    earlyTokens.forEach(t => {
      if (t.apiData) {
        const fdv = parseFloat(t.apiData.fdv) || 0;
        const tvl = parseFloat(t.apiData.tvl) || 0;
        if (fdv > 0) {
          fdvStats.min = Math.min(fdvStats.min, fdv);
          fdvStats.max = Math.max(fdvStats.max, fdv);
          fdvStats.avg += fdv;
          fdvStats.hasData = true;
        }
        if (tvl > 0) {
          tvlStats.min = Math.min(tvlStats.min, tvl);
          tvlStats.max = Math.max(tvlStats.max, tvl);
          tvlStats.avg += tvl;
          tvlStats.hasData = true;
        }
      }
    });

    fdvStats.avg /= earlyTokens.filter(t => t.apiData?.fdv).length || 1;
    tvlStats.avg /= earlyTokens.filter(t => t.apiData?.tvl).length || 1;

    console.log('\nFDV范围:', fdvStats.min === Infinity ? 'N/A' : fdvStats.min.toFixed(2), '-', fdvStats.max.toFixed(2));
    console.log('FDV平均:', fdvStats.avg.toFixed(2));
    console.log('TVL范围:', tvlStats.min === Infinity ? 'N/A' : tvlStats.min.toFixed(2), '-', tvlStats.max.toFixed(2));
    console.log('TVL平均:', tvlStats.avg.toFixed(2));

    // 显示一些示例
    console.log('\n示例代币：');
    earlyTokens.slice(0, 10).forEach(t => {
      console.log(`  ${t.symbol || 'N/A'}: FDV=${t.apiData?.fdv || 'N/A'}, TVL=${t.apiData?.tvl || 'N/A'}`);
    });
  }

  // 分析已买入代币的特征
  console.log('\n【已买入代币特征分析】');
  const boughtTokensData = Object.values(tokenAnalysis).filter(t => t.status === 'bought');

  const boughtFdvStats = {
    min: Infinity,
    max: 0,
    avg: 0
  };
  const boughtTvlStats = {
    min: Infinity,
    max: 0,
    avg: 0
  };

  boughtTokensData.forEach(t => {
    if (t.apiData) {
      const fdv = parseFloat(t.apiData.fdv) || 0;
      const tvl = parseFloat(t.apiData.tvl) || 0;
      if (fdv > 0) {
        boughtFdvStats.min = Math.min(boughtFdvStats.min, fdv);
        boughtFdvStats.max = Math.max(boughtFdvStats.max, fdv);
        boughtFdvStats.avg += fdv;
      }
      if (tvl > 0) {
        boughtTvlStats.min = Math.min(boughtTvlStats.min, tvl);
        boughtTvlStats.max = Math.max(boughtTvlStats.max, tvl);
        boughtTvlStats.avg += tvl;
      }
    }
  });

  boughtFdvStats.avg /= boughtTokensData.filter(t => t.apiData?.fdv).length || 1;
  boughtTvlStats.avg /= boughtTokensData.filter(t => t.apiData?.tvl).length || 1;

  console.log('FDV范围:', boughtFdvStats.min === Infinity ? 'N/A' : boughtFdvStats.min.toFixed(2), '-', boughtFdvStats.max.toFixed(2));
  console.log('FDV平均:', boughtFdvStats.avg.toFixed(2));
  console.log('TVL范围:', boughtTvlStats.min === Infinity ? 'N/A' : boughtTvlStats.min.toFixed(2), '-', boughtTvlStats.max.toFixed(2));
  console.log('TVL平均:', boughtTvlStats.avg.toFixed(2));

  // 对比分析
  console.log('\n【特征对比分析】');
  console.log('已买入代币 vs 监控中代币的特征差异：');
  if (fdvStats.hasData && tvlStats.hasData) {
    console.log('FDV差异:', boughtFdvStats.avg.toFixed(2), '(买入) vs', fdvStats.avg.toFixed(2), '(监控)');
    console.log('TVL差异:', boughtTvlStats.avg.toFixed(2), '(买入) vs', tvlStats.avg.toFixed(2), '(监控)');
  } else {
    console.log('监控中代币无有效特征数据');
  }

  // 分析卖出策略触发情况
  console.log('\n【卖出策略触发统计】');
  const sellReasonCount = {};
  signals.filter(s => s.signal_type === 'SELL').forEach(s => {
    const reason = s.reason;
    sellReasonCount[reason] = (sellReasonCount[reason] || 0) + 1;
  });
  Object.entries(sellReasonCount).forEach(([reason, count]) => {
    console.log(`  ${reason}: ${count} 次`);
  });

  console.log('\n='.repeat(80));
  console.log('分析完成');
  console.log('='.repeat(80));
}

deepAnalysis().catch(console.error);
