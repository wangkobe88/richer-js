#!/usr/bin/env node
/**
 * 检查回测实验的详细情况
 */

require('dotenv').config({ path: '../config/.env' });
const { ExperimentDataService } = require('../src/web/services/ExperimentDataService');

const BACKTEST_EXP = '5f8978ca-dd63-46ac-8878-a5bdd319805d';

async function main() {
  const dataService = new ExperimentDataService();
  const { dbManager } = require('../src/services/dbManager');
  const supabase = dbManager.getClient();

  console.log(`\n=== 检查回测实验 ${BACKTEST_EXP} ===\n`);

  // 获取实验信息
  const { data: expData } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', BACKTEST_EXP)
    .single();

  if (expData) {
    console.log(`实验名称: ${expData.experiment_name}`);
    console.log(`状态: ${expData.status}`);
    console.log(`交易模式: ${expData.trading_mode}`);
    console.log(`区块链: ${expData.blockchain}`);
    console.log(`创建时间: ${expData.created_at}`);
    console.log(`配置:`, JSON.stringify(expData.config, null, 2));
  }

  // 获取交易数据
  const trades = await dataService.getTrades(BACKTEST_EXP, { limit: 1000 });
  console.log(`\n交易数: ${trades.length}`);

  // 获取信号数据
  const signals = await dataService.getSignals(BACKTEST_EXP, { limit: 1000 });
  console.log(`信号数: ${signals.length}`);

  // 获取代币数据
  const tokens = await dataService.getTokens(BACKTEST_EXP, { limit: 1000 });
  console.log(`代币数: ${tokens.length}`);

  // 检查买入信号的metadata
  const buySignals = signals.filter(s => s.signalType === 'BUY' || s.action === 'buy');
  console.log(`\n买入信号数: ${buySignals.length}`);

  if (buySignals.length > 0) {
    const firstBuy = buySignals[0];
    console.log(`\n第一个买入信号的metadata字段:`);
    console.log(Object.keys(firstBuy.metadata || {}));

    console.log(`\n前5个买入信号的fdv值:`);
    buySignals.slice(0, 5).forEach((s, i) => {
      const fdv = s.metadata?.fdv ?? 'N/A';
      const symbol = s.tokenSymbol;
      console.log(`  ${i + 1}. ${symbol}: fdv = ${fdv}`);
    });
  }

  // 统计有多少买入信号包含fdv
  const withFDV = buySignals.filter(s => s.metadata?.fdv !== undefined);
  console.log(`\n包含fdv字段的买入信号: ${withFDV.length}/${buySignals.length}`);

  // 如果有fdv，统计分布
  if (withFDV.length > 0) {
    const fdvValues = withFDV.map(s => s.metadata.fdv);
    const under8000 = fdvValues.filter(v => v < 8000).length;
    const over8000 = fdvValues.filter(v => v >= 8000).length;

    console.log(`\nfdv < 8000: ${under8000}个`);
    console.log(`fdv >= 8000: ${over8000}个`);
  }
}

main().catch(console.error);
