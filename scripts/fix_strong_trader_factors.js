/**
 * 修复强势交易者因子
 * 使用早期交易数据重新计算强势交易者因子并更新到数据库
 */

const { createClient } = require('@supabase/supabase-js');
const { STRONG_TRADERS } = require('../src/trading-engine/pre-check/STRONG_TRADERS');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const TOTAL_SUPPLY = 1000000000; // fourmeme总供应量10亿

function analyzeStrongTradersFromTrades(trades, tokenAddress) {
  let buyAmount = 0;
  let sellAmount = 0;
  let tradeCount = 0;
  const wallets = new Set();

  const tokenAddressLower = tokenAddress.toLowerCase();

  for (const trade of trades) {
    const wallet = trade.wallet_address?.toLowerCase() || trade.from_address?.toLowerCase();
    if (!wallet) continue;

    // 检查是否是强势交易者
    if (!STRONG_TRADERS.has(wallet)) continue;

    const toToken = trade.to_token?.toLowerCase();
    const fromToken = trade.from_token?.toLowerCase();

    const isBuy = toToken === tokenAddressLower;
    const isSell = fromToken === tokenAddressLower;

    if (isBuy) {
      const amount = parseFloat(trade.to_amount) || 0;
      buyAmount += amount;
      wallets.add(wallet);
      tradeCount++;
    }

    if (isSell) {
      const amount = parseFloat(trade.from_amount) || 0;
      sellAmount += amount;
      wallets.add(wallet);
      tradeCount++;
    }
  }

  const netAmount = Math.abs(buyAmount - sellAmount);
  const totalVolume = buyAmount + sellAmount;

  return {
    strongTraderNetPositionRatio: (netAmount / TOTAL_SUPPLY * 100),
    strongTraderTotalBuyRatio: (buyAmount / TOTAL_SUPPLY * 100),
    strongTraderTotalSellRatio: (sellAmount / TOTAL_SUPPLY * 100),
    strongTraderWalletCount: wallets.size,
    strongTraderTradeCount: tradeCount,
    strongTraderSellIntensity: totalVolume > 0 ? (sellAmount / totalVolume) : 0
  };
}

async function fixSignal(signalId) {
  // 获取信号数据
  const { data: signal, error } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('id', signalId)
    .single();

  if (error || !signal) {
    console.error('获取信号失败:', error);
    return;
  }

  console.log('信号:', signal.id);
  console.log('代币:', signal.token_address);

  // 获取早期交易数据
  const { data: earlyData } = await supabase
    .from('early_participant_trades')
    .select('trades_data')
    .eq('signal_id', signalId)
    .single();

  if (!earlyData || !earlyData.trades_data) {
    console.log('没有找到早期交易数据');
    return;
  }

  const trades = earlyData.trades_data;
  console.log('交易数据:', trades.length, '笔');

  // 分析强势交易者
  const factors = analyzeStrongTradersFromTrades(trades, signal.token_address);

  console.log('');
  console.log('强势交易者因子:');
  console.log('  strongTraderNetPositionRatio:', factors.strongTraderNetPositionRatio.toFixed(2));
  console.log('  strongTraderTotalBuyRatio:', factors.strongTraderTotalBuyRatio.toFixed(2));
  console.log('  strongTraderTotalSellRatio:', factors.strongTraderTotalSellRatio.toFixed(2));
  console.log('  strongTraderWalletCount:', factors.strongTraderWalletCount);
  console.log('  strongTraderTradeCount:', factors.strongTraderTradeCount);
  console.log('  strongTraderSellIntensity:', factors.strongTraderSellIntensity.toFixed(2));

  // 更新 metadata
  const metadata = signal.metadata || {};
  if (!metadata.preBuyCheckFactors) {
    metadata.preBuyCheckFactors = {};
  }

  // 更新强势交易者因子
  Object.assign(metadata.preBuyCheckFactors, factors);

  // 保存到数据库
  const { error: updateError } = await supabase
    .from('strategy_signals')
    .update({ metadata })
    .eq('id', signalId);

  if (updateError) {
    console.error('更新失败:', updateError);
    return;
  }

  console.log('');
  console.log('✓ 更新成功');
}

async function main() {
  const signalId = process.argv[2];

  if (!signalId) {
    console.log('用法: node fix_strong_trader_factors.js <signal_id>');
    console.log('');
    console.log('示例:');
    console.log('  node fix_strong_trader_factors.js da6c3c81-4fdf-419c-9e80-08d9bb851d9c');
    return;
  }

  await fixSignal(signalId);
}

main().catch(console.error);
