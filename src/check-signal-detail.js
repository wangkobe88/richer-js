/**
 * 检查信号数据表中的详细信息
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function checkSignals() {
  const experimentId = '95042847-cccd-4316-be03-f172e2885993';
  const tokenSymbol = '创业故事';

  console.log(`\n📊 检查实验 ${experimentId} 中代币 "${tokenSymbol}" 的信号详情\n`);

  // 获取该代币的信号记录
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_symbol', tokenSymbol)
    .order('created_at', { ascending: true });

  if (!signals || signals.length === 0) {
    console.log('没有找到信号记录');
    return;
  }

  console.log(`信号记录条数: ${signals.length}\n`);

  signals.forEach((s, i) => {
    const signalType = s.signal_type || s.action?.toUpperCase() || '-';
    const confidence = s.confidence || 'N/A';
    const reason = s.reason || '-';
    const executed = s.executed || false;
    const sellRatio = s.sell_ratio !== undefined ? (s.sell_ratio * 100).toFixed(0) + '%' : 'N/A';

    console.log(`[${i + 1}] ${s.created_at}`);
    console.log(`    类型: ${signalType}`);
    console.log(`    原因: ${reason}`);
    console.log(`    卖出比例: ${sellRatio}`);
    console.log(`    执行: ${executed}\n`);
  });

  // 获取实验配置
  console.log('\n=== 实验配置 ===');
  const { data: exp } = await supabase
    .from('experiments')
    .select('config')
    .eq('id', experimentId)
    .single();

  if (exp && exp.config) {
    const strategy = exp.config.strategy || {};
    console.log('takeProfit1:', strategy.takeProfit1);
    console.log('takeProfit1Sell:', strategy.takeProfit1Sell, `(${(strategy.takeProfit1Sell * 100).toFixed(0)}%)`);
    console.log('takeProfit2:', strategy.takeProfit2);
    console.log('takeProfit2Sell:', strategy.takeProfit2Sell, `(${(strategy.takeProfit2Sell * 100).toFixed(0)}%)`);
  }
}

checkSignals().catch(console.error);
