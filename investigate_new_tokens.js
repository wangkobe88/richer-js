/**
 * 深度调查新增代币的原因
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function investigateNewTokens() {
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';

  console.log('=== 调查新增代币 ===\n');

  // 1. 首先检查两个实验的配置
  console.log('1. 检查两个回测实验的配置\n');

  const { data: experiments } = await supabase
    .from('experiments')
    .select('*')
    .in('id', [newExpId, oldExpId]);

  experiments.forEach(exp => {
    console.log(`实验 ${exp.id === newExpId ? '新' : '旧'}:`);
    console.log('  名称:', exp.name);
    console.log('  状态:', exp.status);
    console.log('  源实验ID:', exp.config?.backtest?.sourceExperimentId);
    console.log('  创建时间:', exp.created_at);
    console.log('');
  });

  // 2. 获取新增代币的列表
  const { data: newTrades } = await supabase
    .from('trades')
    .select('token_address')
    .eq('experiment_id', newExpId)
    .eq('trade_direction', 'sell');

  const { data: oldTrades } = await supabase
    .from('trades')
    .select('token_address')
    .eq('experiment_id', oldExpId)
    .eq('trade_direction', 'sell');

  const newExecutedTokens = new Set(newTrades.map(t => t.token_address));
  const oldExecutedTokens = new Set(oldTrades.map(t => t.token_address));

  const addedTokens = Array.from(newExecutedTokens).filter(token => !oldExecutedTokens.has(token));
  const removedTokens = Array.from(oldExecutedTokens).filter(token => !newExecutedTokens.has(token));

  console.log('2. 代币执行情况对比\n');
  console.log('新实验执行:', newExecutedTokens.size, '个');
  console.log('旧实验执行:', oldExecutedTokens.size, '个');
  console.log('新增代币:', addedTokens.length, '个');
  console.log('移除代币:', removedTokens.length, '个');
  console.log('');

  // 3. 检查新增代币在旧实验中的信号情况
  console.log('3. 检查新增代币在旧实验中的信号状态\n');

  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', oldExpId);

  console.log('新增代币在旧实验中的状态:');
  console.log('代币地址                              | 信号数 | 执行状态 | 执行原因');
  console.log('-------------------------------------|--------|----------|----------');

  for (const token of addedTokens) {
    const tokenSignals = oldSignals.filter(s => s.token_address === token);
    if (tokenSignals.length > 0) {
      const firstSignal = tokenSignals[0];
      const status = firstSignal.metadata?.execution_status || 'unknown';
      const reason = firstSignal.metadata?.execution_reason || '';
      console.log(`${token} | ${tokenSignals.length} | ${status.padEnd(8)} | ${reason.substring(0, 30)}`);
    } else {
      console.log(`${token} | 0 | 无信号 | -`);
    }
  }

  console.log('');

  // 4. 检查新增代币在新实验中的信号详情
  console.log('4. 检查新增代币在新实验中的信号详情\n');

  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', newExpId);

  console.log('新增代币在新实验中的预检查因子:');
  console.log('代币                                  | earlyWhaleCount | sellRatio | 执行状态');
  console.log('-------------------------------------|-----------------|-----------|----------');

  for (const token of addedTokens) {
    const tokenSignals = newSignals.filter(s => s.token_address === token);
    if (tokenSignals.length > 0) {
      const firstSignal = tokenSignals[0];
      const factors = firstSignal.metadata?.preBuyCheckFactors;
      const whaleCount = factors?.earlyWhaleCount ?? 'N/A';
      const sellRatio = factors?.earlyWhaleSellRatio ?? 'N/A';
      const status = firstSignal.metadata?.execution_status || 'unknown';
      const sellRatioStr = typeof sellRatio === 'number' ? (sellRatio * 100).toFixed(1) + '%' : sellRatio;
      console.log(`${token} | ${whaleCount.toString().padStart(15)} | ${sellRatioStr.padStart(9)} | ${status}`);
    }
  }

  console.log('');

  // 5. 重点检查 1$ 代币的情况
  console.log('5. 重点检查 1$ 代币的情况\n');

  const dollarToken = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  const { data: dollarOldSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', oldExpId)
    .eq('token_address', dollarToken);

  const { data: dollarNewSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', newExpId)
    .eq('token_address', dollarToken);

  console.log('1$ 代币在旧实验中:');
  if (dollarOldSignals.length > 0) {
    console.log('  信号数:', dollarOldSignals.length);
    const first = dollarOldSignals[0];
    console.log('  第一个信号时间:', first.created_at);
    console.log('  执行状态:', first.metadata?.execution_status);
    console.log('  执行原因:', first.metadata?.execution_reason);
    const factors = first.metadata?.preBuyCheckFactors;
    if (factors) {
      console.log('  早期大户数量:', factors.earlyWhaleCount);
      console.log('  早期大户卖出率:', factors.earlyWhaleSellRatio);
    }
  } else {
    console.log('  没有信号');
  }

  console.log('');
  console.log('1$ 代币在新实验中:');
  if (dollarNewSignals.length > 0) {
    console.log('  信号数:', dollarNewSignals.length);
    const first = dollarNewSignals[0];
    console.log('  第一个信号时间:', first.created_at);
    console.log('  执行状态:', first.metadata?.execution_status);
    console.log('  执行原因:', first.metadata?.execution_reason);
    const factors = first.metadata?.preBuyCheckFactors;
    if (factors) {
      console.log('  早期大户数量:', factors.earlyWhaleCount);
      console.log('  早期大户卖出率:', (factors.earlyWhaleSellRatio * 100).toFixed(1) + '%');
    }
  } else {
    console.log('  没有信号');
  }

  // 6. 检查两个实验使用的源实验是否相同
  console.log('\n6. 确认数据源\n');

  const sourceExpId = experiments[0]?.config?.backtest?.sourceExperimentId;
  const sourceExpId2 = experiments[1]?.config?.backtest?.sourceExperimentId;

  console.log('新实验的源实验:', sourceExpId);
  console.log('旧实验的源实验:', sourceExpId2);
  console.log('源实验是否相同:', sourceExpId === sourceExpId2 ? '是' : '否');

  if (sourceExpId) {
    const { data: sourceExp } = await supabase
      .from('experiments')
      .select('*')
      .eq('id', sourceExpId)
      .single();

    if (sourceExp) {
      console.log('\n源实验信息:');
      console.log('  名称:', sourceExp.name);
      console.log('  状态:', sourceExp.status);
      console.log('  模式:', sourceExp.mode);
    }
  }
}

investigateNewTokens().catch(console.error);
