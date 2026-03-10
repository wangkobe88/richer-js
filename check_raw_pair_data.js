/**
 * 检查 experiment_tokens 表中的原始数据
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkRawPairData() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  const { data: tokenData } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .limit(1);

  if (tokenData && tokenData.length > 0) {
    console.log('=== experiment_tokens 表数据 ===\n');
    console.log('代币地址:', tokenData[0].token_address);
    console.log('符号:', tokenData[0].symbol);
    console.log('内盘交易对:', tokenData[0].inner_pair);
    console.log('外盘交易对:', tokenData[0].outer_pair);
    console.log('链:', tokenData[0].chain);
    console.log('创建时间:', tokenData[0].token_created_at);
    console.log('');

    // 使用正确的交易对格式测试
    const innerPair = tokenData[0].inner_pair;
    const chain = tokenData[0].chain;
    const pairId = `${innerPair}-${chain}`;

    console.log('=== 使用正确的交易对测试 API ===\n');
    console.log('交易对 ID:', pairId);

    const { AveTxAPI } = require('./src/core/ave-api');
    const txApi = new AveTxAPI(
      'https://prod.ave-api.com',
      30000,
      process.env.AVE_API_KEY
    );

    const toTime = Math.floor(Date.now() / 1000);
    const fromTime = toTime - 3600; // 最近1小时

    console.log('fromTime:', fromTime);
    console.log('toTime:', toTime);

    const trades = await txApi.getSwapTransactions(pairId, 100, fromTime, toTime, 'desc');
    console.log('返回交易数:', trades.length);

    if (trades.length > 0) {
      console.log('\n最近5笔交易:');
      trades.slice(0, 5).forEach((t, i) => {
        console.log(`  ${i + 1}. 时间:${t.time} USD:$${t.from_usd?.toFixed(2) || 0}`);
      });
    } else {
      console.log('\n⚠️  API 返回空数据');
      console.log('可能原因:');
      console.log('  1. 交易对ID格式不正确');
      console.log('  2. AVE API 没有这个交易对的数据');
      console.log('  3. 交易对已经不存在了');
    }
  } else {
    console.log('没有找到代币数据');
  }
}

checkRawPairData().catch(console.error);
