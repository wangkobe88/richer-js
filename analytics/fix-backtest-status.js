#!/usr/bin/env node
/**
 * 修复已完成但状态未更新的回测实验
 */

require('dotenv').config({ path: '../config/.env' });
const { dbManager } = require('../src/services/dbManager');

async function main() {
  const supabase = dbManager.getClient();

  console.log(`\n=== 查找需要修复的回测实验 ===\n`);

  // 查找所有 backtest 模式且状态为 running 的实验
  const { data: runningBacktests, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('trading_mode', 'backtest')
    .eq('status', 'running')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('查询失败:', error.message);
    return;
  }

  if (!runningBacktests || runningBacktests.length === 0) {
    console.log('没有找到 running 状态的回测实验');
    return;
  }

  console.log(`找到 ${runningBacktests.length} 个 running 状态的回测实验:\n`);

  // 检查每个实验是否有对应的交易数据
  const toUpdate = [];

  for (const exp of runningBacktests) {
    const expId = exp.id;
    const expName = exp.experiment_name;

    // 检查是否有交易记录
    const { data: trades, error: tradeError } = await supabase
      .from('trades')
      .select('id')
      .eq('experiment_id', expId)
      .limit(1);

    if (tradeError) {
      console.log(`⏭️  ${expName} (${expId}): 检查失败`);
      continue;
    }

    // 检查实验创建时间，如果超过一定时间没有交易，可能已经完成了
    const createdTime = new Date(exp.created_at);
    const now = new Date();
    const ageInMinutes = (now - createdTime) / 1000 / 60;

    if (trades && trades.length > 0) {
      // 有交易数据，检查最后交易时间
      const { data: lastTrade } = await supabase
        .from('trades')
        .select('created_at')
        .eq('experiment_id', expId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (lastTrade && lastTrade.length > 0) {
        const lastTradeTime = new Date(lastTrade[0].created_at);
        const minutesSinceLastTrade = (now - lastTradeTime) / 1000 / 60;

        console.log(`${expName} (${expId}):`);
        console.log(`  创建于: ${createdTime.toLocaleString('zh-CN')}`);
        console.log(`  最后交易: ${lastTradeTime.toLocaleString('zh-CN')} (${minutesSinceLastTrade.toFixed(1)} 分钟前)`);
        console.log(`  已运行: ${ageInMinutes.toFixed(1)} 分钟`);
      }

      // 如果有交易数据且超过一定时间没有新交易，认为已完成
      // 这里简单处理：如果实验创建超过5分钟且是回测模式，很可能已完成
      if (ageInMinutes > 5) {
        console.log(`  ⚠️  可能已完成（超过5分钟），建议更新状态`);
        toUpdate.push(exp);
      } else {
        console.log(`  ⏳ 可能还在运行中`);
      }
    } else {
      console.log(`${expName} (${expId}): 无交易数据，可能初始化失败`);
      // 没有交易数据，可能需要更新为 failed
      toUpdate.push({ ...exp, noTrades: true });
    }

    console.log(``);
  }

  if (toUpdate.length === 0) {
    console.log('没有需要更新的实验');
    return;
  }

  console.log(`\n=== 准备更新 ${toUpdate.length} 个实验的状态 ===\n`);

  for (const exp of toUpdate) {
    const newStatus = exp.noTrades ? 'failed' : 'completed';
    const updateData = {
      status: newStatus,
      stopped_at: new Date().toISOString()
    };

    const { error: updateError } = await supabase
      .from('experiments')
      .update(updateData)
      .eq('id', exp.id);

    if (updateError) {
      console.error(`❌ 更新失败 [${exp.experiment_name}]:`, updateError.message);
    } else {
      console.log(`✅ 已更新 [${exp.experiment_name}]: ${exp.status} → ${newStatus}`);
    }
  }

  console.log(`\n✅ 修复完成`);
}

main().catch(console.error);
