/**
 * 步骤1: 检查数据库中是否有_trades数据
 *
 * 由于FactorBuilder.buildPreBuyCheckFactorValues()没有包含_trades字段，
 * 需要验证当前数据库中是否存在交易数据。
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 步骤1: 检查数据库中的交易数据 ===\n');

  const expId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取一个执行过的买入信号的完整metadata
  const { data: signal } = await supabase
    .from('strategy_signals')
    .select('metadata')
    .eq('experiment_id', expId)
    .eq('action', 'buy')
    .eq('executed', true)
    .limit(1)
    .single();

  if (!signal) {
    console.log('没有找到执行的买入信号');
    return;
  }

  console.log('信号 metadata 结构:');
  console.log('-'.repeat(60));

  const preBuyCheckFactors = signal.metadata?.preBuyCheckFactors || {};

  // 检查是否有_trades字段
  if (preBuyCheckFactors._trades) {
    console.log('✅ 发现 _trades 数据!');
    console.log(`   交易数量: ${preBuyCheckFactors._trades.length}`);
    if (preBuyCheckFactors._trades.length > 0) {
      const firstTrade = preBuyCheckFactors._trades[0];
      console.log('   第一笔交易样例:', {
        tx_id: firstTrade.tx_id,
        from_address: firstTrade.from_address,
        to_address: firstTrade.to_address,
        time: firstTrade.time,
        from_usd: firstTrade.from_usd
      });
    }
  } else {
    console.log('❌ 没有发现 _trades 数据');
    console.log('\n可用的 preBuyCheckFactors 字段:');
    console.log(Object.keys(preBuyCheckFactors).join('\n'));
  }

  // 统计所有执行的买入信号
  const { count } = await supabase
    .from('strategy_signals')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', expId)
    .eq('action', 'buy')
    .eq('executed', true);

  console.log(`\n总执行买入信号数: ${count}`);
}

main().catch(console.error);
