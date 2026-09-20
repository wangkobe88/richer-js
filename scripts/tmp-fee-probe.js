#!/usr/bin/env node
/**
 * 临时探针：实测 four.meme TokenManagerHelper3 的费率字段语义
 * - 从 Supabase 取最近 3 个活跃 four.meme 代币（单条小查询）
 * - 链上 getTokenInfo / tryBuy / trySell，对比 fee 金额比例与 tradingFeeRate 字段
 */
require('dotenv').config({ path: './config/.env' });
const { ethers } = require('ethers');

const HELPER = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
const HELPER_ABI = [
  'function getTokenInfo(address token) view returns (uint256 version, address tokenManager, address quote, uint256 lastPrice, uint256 tradingFeeRate, uint256 minTradingFee, uint256 launchTime, uint256 offers, uint256 maxOffers, uint256 funds, uint256 maxFunds, bool liquidityAdded)',
  'function tryBuy(address token, uint256 amount, uint256 funds) view returns (address tokenManager, address quote, uint256 estimatedAmount, uint256 estimatedCost, uint256 estimatedFee, uint256 amountMsgValue, uint256 amountApproval, uint256 amountFunds)',
  'function trySell(address token, uint256 amount) view returns (address tokenManager, address quote, uint256 funds, uint256 fee)',
];

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const supabase = dbManager.getClient();
  // 最近的活跃代币（ticks 里最近的）
  const { data: ticks, error } = await supabase
    .from('wss_price_ticks')
    .select('token_address, block_time')
    .order('id', { ascending: false })
    .limit(200);
  if (error) throw new Error(`DB: ${error.message}`);
  const seen = new Map();
  for (const t of ticks || []) if (!seen.has(t.token_address)) seen.set(t.token_address, t.block_time);
  const tokens = [...seen.entries()].slice(0, 3).map(([a]) => a);
  console.log('样本代币:', tokens);

  // ANKR_WS_URL (wss://rpc.ankr.com/bsc/ws/<key>) → https://rpc.ankr.com/bsc/<key>
  const httpRpc = (process.env.ANKR_WS_URL || '').replace(/^wss:/, 'https:').replace('/ws/', '/');
  const provider = new ethers.JsonRpcProvider(httpRpc);
  const helper = new ethers.Contract(HELPER, HELPER_ABI, provider);

  for (const token of tokens) {
    try {
      const info = await helper.getTokenInfo(token);
      const feeRateBps = Number(info.tradingFeeRate);
      console.log(`\n=== ${token}`);
      console.log(`  getTokenInfo.tradingFeeRate = ${feeRateBps} (${feeRateBps / 100}%)  minTradingFee=${ethers.formatEther(info.minTradingFee)} quote=${info.quote}`);

      // 买入 0.001 BNB 的费率实测
      const tryBuyRes = await helper.tryBuy(token, 0, ethers.parseEther('0.001'));
      const buyFeePct = Number(tryBuyRes.estimatedFee) / Number(tryBuyRes.estimatedCost) * 100;
      console.log(`  tryBuy(0.001 BNB): cost=${ethers.formatEther(tryBuyRes.estimatedCost)} fee=${ethers.formatEther(tryBuyRes.estimatedFee)} → 买费率≈${buyFeePct.toFixed(3)}%  msgValue=${ethers.formatEther(tryBuyRes.amountMsgValue)}`);

      // 卖出小额的费率实测（卖 1e6 个 token）
      const amount = ethers.parseUnits('1000', 18);
      const trySellRes = await helper.trySell(token, amount);
      const sellFeePct = Number(trySellRes.fee) / Number(trySellRes.funds) * 100;
      console.log(`  trySell(1000 tok): funds=${ethers.formatEther(trySellRes.funds)} fee=${ethers.formatEther(trySellRes.fee)} → 卖费率≈${sellFeePct.toFixed(3)}%`);
    } catch (e) {
      console.log(`  查询失败: ${e.message.slice(0, 120)}`);
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
