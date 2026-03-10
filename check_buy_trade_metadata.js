/**
 * 检查买入交易的 metadata 结构
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkBuyTradeMetadata() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  // 获取买入交易
  const { data: buyTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('trade_direction', 'buy')
    .limit(3);

  console.log('=== 买入交易 metadata 结构 ===\n');

  buyTrades.forEach((trade, i) => {
    console.log(`交易 ${i + 1}: ${trade.token_symbol}`);
    console.log('metadata keys:', Object.keys(trade.metadata || {}).join(', '));

    if (trade.metadata?.factors) {
      console.log('factors keys:', Object.keys(trade.metadata.factors).join(', '));

      if (trade.metadata.factors.preBuyCheckFactors) {
        console.log('preBuyCheckFactors keys:', Object.keys(trade.metadata.factors.preBuyCheckFactors).join(', '));
        console.log('\npreBuyCheckFactors 示例值:');
        const factors = trade.metadata.factors.preBuyCheckFactors;
        console.log('  earlyWhaleCount:', factors.earlyWhaleCount);
        console.log('  earlyWhaleSellRatio:', factors.earlyWhaleSellRatio);
        console.log('  walletClusterSecondToFirstRatio:', factors.walletClusterSecondToFirstRatio);
        console.log('  holderBlacklistCount:', factors.holderBlacklistCount);
      } else {
        console.log('❌ 没有 preBuyCheckFactors');
      }
    }
    console.log('');
  });

  // 检查有多少买入交易有 preBuyCheckFactors
  const { data: allBuyTrades } = await supabase
    .from('trades')
    .select('id, token_symbol, metadata')
    .eq('experiment_id', experimentId)
    .eq('trade_direction', 'buy');

  const withPreBuy = allBuyTrades.filter(t => t.metadata?.factors?.preBuyCheckFactors);
  const withoutPreBuy = allBuyTrades.filter(t => !t.metadata?.factors?.preBuyCheckFactors);

  console.log('=== 统计 ===');
  console.log('总买入交易:', allBuyTrades.length);
  console.log('有 preBuyCheckFactors:', withPreBuy.length);
  console.log('无 preBuyCheckFactors:', withoutPreBuy.length);
}

checkBuyTradeMetadata().catch(console.error);
