#!/usr/bin/env node
/**
 * 列出所有回测实验
 */

require('dotenv').config({ path: '../config/.env' });
const { dbManager } = require('../src/services/dbManager');

async function main() {
  const supabase = dbManager.getClient();

  console.log(`\n=== 查找回测实验 ===\n`);

  // 查找 trading_mode = backtest 的实验
  const { data: backtestExps } = await supabase
    .from('experiments')
    .select('*')
    .eq('trading_mode', 'backtest')
    .order('created_at', { ascending: false })
    .limit(20);

  console.log(`找到 ${backtestExps?.length || 0} 个回测实验:\n`);

  if (backtestExps && backtestExps.length > 0) {
    backtestExps.forEach((exp, i) => {
      const sourceExp = exp.config?.backtest?.sourceExperimentId || 'N/A';
      console.log(`${i + 1}. ID: ${exp.id}`);
      console.log(`   名称: ${exp.experiment_name}`);
      console.log(`   状态: ${exp.status}`);
      console.log(`   源实验: ${sourceExp}`);
      console.log(`   创建时间: ${exp.created_at}`);

      // 检查买入策略配置
      if (exp.config?.strategiesConfig?.buyStrategies) {
        console.log(`   买入策略:`);
        exp.config.strategiesConfig.buyStrategies.forEach((s, j) => {
          console.log(`     ${j + 1}. ${s.condition}`);
        });
      }
      console.log(``);
    });
  }

  // 同时查找原实验的复制品
  console.log(`\n=== 查找原实验的复制品 ===\n`);
  const ORIGINAL_EXP = '004ac5ac-4589-47da-a332-44c76141b1b5';

  const { data: allExps } = await supabase
    .from('experiments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (allExps) {
    const copies = allExps.filter(exp => {
      const name = exp.experiment_name || '';
      return name.includes('副本') || name.includes('copy') || name.includes('复制');
    });

    console.log(`找到 ${copies.length} 个可能是复制品的实验:\n`);
    copies.forEach((exp, i) => {
      const config = exp.config?.strategiesConfig?.buyStrategies || [];
      const hasFDVLimit = config.some(s => s.condition?.includes('fdv <') || s.condition?.includes('fdv <='));
      console.log(`${i + 1}. ${exp.id}`);
      console.log(`   名称: ${exp.experiment_name}`);
      console.log(`   模式: ${exp.trading_mode}`);
      console.log(`   创建: ${exp.created_at}`);
      console.log(`   有fdv限制: ${hasFDVLimit ? '是' : '否'}`);
      console.log(``);
    });
  }
}

main().catch(console.error);
