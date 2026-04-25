#!/usr/bin/env node
/**
 * ETH 代币调研脚本
 * 查询实验中所有 ETH 代币的交易 swap、合约审计风险、交易税情况
 */

require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const { AveTokenAPI } = require('../src/core/ave-api/token-api');
const config = require('../config/default.json');

const EXPERIMENT_ID = '0cbf02fc-55d8-4298-ad93-10cb37bcbc74';

async function main() {
  // 初始化 AVE API
  const apiKey = process.env.AVE_API_KEY;
  const aveApi = new AveTokenAPI(config.ave.apiUrl, config.ave.timeout, apiKey);

  // 初始化 Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  // 1. 查询实验中所有 ETH 代币
  console.log('========================================');
  console.log('📊 查询实验中的 ETH 代币信号...');
  console.log('========================================\n');

  const { data: signals, error: sigError } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, chain, signal_type, action, confidence')
    .eq('experiment_id', EXPERIMENT_ID);

  if (sigError) {
    console.error('查询失败:', sigError.message);
    process.exit(1);
  }

  // 去重，获取唯一代币
  const tokenMap = new Map();
  for (const s of signals || []) {
    if (s.token_address && !tokenMap.has(s.token_address.toLowerCase())) {
      tokenMap.set(s.token_address.toLowerCase(), {
        address: s.token_address,
        symbol: s.token_symbol
      });
    }
  }

  const tokens = Array.from(tokenMap.values());
  console.log(`找到 ${tokens.length} 个唯一 ETH 代币\n`);

  if (tokens.length === 0) {
    console.log('没有找到 ETH 代币');
    process.exit(0);
  }

  // 2. 逐个调研每个代币
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const tokenId = `${token.address}-eth`;

    console.log('========================================');
    console.log(`🔍 [${i + 1}/${tokens.length}] ${token.symbol || 'Unknown'}`);
    console.log(`   地址: ${token.address}`);
    console.log('========================================\n');

    // --- A. getTokenDetail: 交易 swap 信息 ---
    try {
      const detail = await aveApi.getTokenDetail(tokenId);
      const tokenInfo = detail.token || {};
      const pairs = detail.pairs || [];

      console.log('--- 基本信息 ---');
      console.log(`  名称: ${tokenInfo.name || 'N/A'}`);
      console.log(`  符号: ${tokenInfo.symbol || 'N/A'}`);
      console.log(`  价格(USD): ${tokenInfo.current_price_usd || 'N/A'}`);
      console.log(`  价格(ETH): ${tokenInfo.current_price_eth || 'N/A'}`);
      console.log(`  市值: ${tokenInfo.market_cap || 'N/A'}`);
      console.log(`  FDV: ${tokenInfo.fdv || 'N/A'}`);
      console.log(`  持有者: ${tokenInfo.holders || 'N/A'}`);
      console.log(`  24h交易量: ${tokenInfo.tx_volume_u_24h || 'N/A'} USD`);
      console.log(`  24h交易数: ${tokenInfo.tx_count_24h || 'N/A'}`);
      console.log(`  是否审计: ${detail.is_audited === 1 ? '✅ 是' : '❌ 否'}`);
      console.log(`  风险分数: ${tokenInfo.risk_score || 'N/A'}`);
      console.log(`  风险等级: ${tokenInfo.risk_level || 'N/A'}`);

      console.log('\n--- 交易对信息 (pairs) ---');
      if (pairs.length === 0) {
        console.log('  ⚠️ 无交易对数据');
      } else {
        for (let j = 0; j < Math.min(pairs.length, 5); j++) {
          const pair = pairs[j];
          console.log(`  [${j + 1}] AMM: ${pair.amm || 'N/A'}`);
          console.log(`      Pair: ${pair.pair || 'N/A'}`);
          console.log(`      Token0: ${pair.token0_symbol || 'N/A'} (${pair.token0_address || 'N/A'})`);
          console.log(`      Token1: ${pair.token1_symbol || 'N/A'} (${pair.token1_address || 'N/A'})`);
          console.log(`      Reserve0: ${pair.reserve0 || 'N/A'}`);
          console.log(`      Reserve1: ${pair.reserve1 || 'N/A'}`);
          console.log(`      交易量(USD): ${pair.volume_u || 'N/A'}`);
          console.log(`      交易数: ${pair.tx_count || 'N/A'}`);
          console.log(`      市值: ${pair.market_cap || 'N/A'}`);
          console.log(`      是否假交易对: ${pair.is_fake ? '⚠️ 是' : '否'}`);
          console.log('');
        }
        if (pairs.length > 5) {
          console.log(`  ... 还有 ${pairs.length - 5} 个交易对`);
        }
      }
    } catch (error) {
      console.error(`  ❌ getTokenDetail 失败: ${error.message}`);
    }

    // --- B. getContractRisk: 合约审计和交易税 ---
    try {
      const risk = await aveApi.getContractRisk(tokenId);

      console.log('--- 合约风险分析 ---');
      console.log(`  风险分数(risk_score): ${risk.risk_score}`);
      console.log(`  是否蜜罐(is_honeypot): ${risk.is_honeypot === 1 ? '⚠️ 是!' : '✅ 否'}`);
      console.log(`  是否代理合约(is_proxy): ${risk.is_proxy === 1 ? '⚠️ 是' : '否'}`);
      console.log(`  是否可mint(has_mint_method): ${risk.has_mint_method === 1 ? '⚠️ 是' : '否'}`);
      console.log(`  是否可自毁(selfdestruct): ${risk.selfdestruct === 1 ? '⚠️ 是!' : '否'}`);
      console.log(`  隐藏所有者(hidden_owner): ${risk.hidden_owner === 1 ? '⚠️ 是' : '否'}`);
      console.log(`  可收回所有权(can_take_back_ownership): ${risk.can_take_back_ownership === 1 ? '⚠️ 是' : '否'}`);
      console.log(`  有黑名单方法(has_black_method): ${risk.has_black_method === 1 ? '⚠️ 是' : '否'}`);
      console.log(`  有白名单方法(has_white_method): ${risk.has_white_method === 1 ? '⚠️ 是' : '否'}`);
      console.log(`  可暂停转账(transfer_pausable): ${risk.transfer_pausable === 1 ? '⚠️ 是' : '否'}`);
      console.log(`  外部调用(external_call): ${risk.external_call}`);
      console.log(`  不能购买(cannot_buy): ${risk.cannot_buy === 1 ? '⚠️ 是!' : '否'}`);
      console.log(`  不能全部卖出(cannot_sell_all): ${risk.cannot_sell_all === 1 ? '⚠️ 是!' : '否'}`);
      console.log(`  同创建者蜜罐数: ${risk.honeypot_with_same_creator || 0}`);
      console.log(`  Owner地址: ${risk.owner || 'N/A'}`);
      console.log(`  Creator地址: ${risk.creator_address || 'N/A'}`);

      console.log('\n--- 交易税 ---');
      console.log(`  买入税(buy_tax): ${risk.buy_tax !== undefined ? (risk.buy_tax / 100).toFixed(2) + '%' : 'N/A'}`);
      console.log(`  卖出税(sell_tax): ${risk.sell_tax !== undefined ? (risk.sell_tax / 100).toFixed(2) + '%' : 'N/A'}`);
      console.log(`  转账税(transfer_tax): ${risk.transfer_tax !== undefined ? (risk.transfer_tax / 100).toFixed(2) + '%' : 'N/A'}`);
      console.log(`  是否反鲸(is_anti_whale): ${risk.is_anti_whale === 1 ? '是' : '否'}`);
      console.log(`  反鲸可修改(anti_whale_modifiable): ${risk.anti_whale_modifiable === 1 ? '⚠️ 是' : '否'}`);
      console.log(`  滑点可修改(slippage_modifiable): ${risk.slippage_modifiable === 1 ? '⚠️ 是' : '否'}`);
      console.log(`  个人滑点可修改(personal_slippage_modifiable): ${risk.personal_slippage_modifiable === 1 ? '⚠️ 是' : '否'}`);
      console.log(`  交易冷却(trading_cooldown): ${risk.trading_cooldown === 1 ? '⚠️ 是' : '否'}`);
      console.log(`  买入Gas: ${risk.buy_gas || 'N/A'}`);
      console.log(`  卖出Gas: ${risk.sell_gas || 'N/A'}`);
      console.log(`  授权Gas: ${risk.approve_gas || 'N/A'}`);
      console.log(`  是否在DEX: ${risk.is_in_dex === 1 ? '是' : '否'}`);

      if (risk.dex && risk.dex.length > 0) {
        console.log(`  DEX列表: ${risk.dex.join(', ')}`);
      }

      // AI 报告
      if (risk.ai_report && Object.keys(risk.ai_report).length > 0) {
        console.log('\n--- AI 报告 ---');
        const report = risk.ai_report;
        if (report.summary) console.log(`  摘要: ${report.summary}`);
        if (report.suggestion) console.log(`  建议: ${report.suggestion}`);
      }

    } catch (error) {
      console.error(`  ❌ getContractRisk 失败: ${error.message}`);
    }

    console.log('\n');

    // 延迟避免 API 限流
    if (i < tokens.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log('========================================');
  console.log('✅ 调研完成');
  console.log('========================================');
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
