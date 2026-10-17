#!/usr/bin/env node
/**
 * GMGN bundler 口径验证（单次真调，轻量）：Agentum/HUDIE
 * - stat.top_bundler_trader_percentage（交易量口径，GMGN 网页显示值）
 * - security.bundler_trader_amount_rate
 * - wallet_tags_stat 全 8 键（含未提取的 rat_trader_wallets）
 * - stat/security 其它占比字段群
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { GMGNTokenAPI } = require(path.join(__dirname, '../src/core/gmgn-api'));

const TOKENS = [
  ['Agentum', '0x76e85a190587d0a600179b60a4236211c61b7777'],
  ['HUDIE', '0x80b7d7c79716ebacf23d49b00ac8bd9fa9b17777'],
];

async function main() {
  const api = new GMGNTokenAPI({ apiKey: process.env.GMGN_API_KEY, timeout: 15000 });
  for (const [sym, addr] of TOKENS) {
    console.log(`\n===== ${sym} ${addr} =====`);
    try {
      const info = await api.getTokenInfo(addr);
      const stat = info?.stat || {};
      const sec = info?.security || {};
      const wts = info?.wallet_tags_stat || {};
      console.log('[stat] top_bundler_trader_percentage =', stat.top_bundler_trader_percentage);
      console.log('[stat] top_10_holder_rate =', stat.top_10_holder_rate);
      console.log('[stat] dev_team_hold_rate =', stat.dev_team_hold_rate);
      console.log('[stat] creator_hold_rate =', stat.creator_hold_rate);
      console.log('[stat] private_vault_hold_rate =', stat.private_vault_hold_rate);
      console.log('[security] bundler_trader_amount_rate =', sec.bundler_trader_amount_rate);
      console.log('[security] suspected_insider_hold_rate =', sec.suspected_insider_hold_rate);
      console.log('[wallet_tags_stat 全键]', JSON.stringify(wts));
      // 我们现行提取口径复算：bundler_wallets / top_wallets
      const ratio = wts.top_wallets ? (wts.bundler_wallets / wts.top_wallets * 100) : null;
      console.log(`[现行口径复算] bundler/top = ${wts.bundler_wallets}/${wts.top_wallets} = ${ratio === null ? 'null' : ratio.toFixed(1)}%`);
    } catch (e) {
      console.log('getTokenInfo 失败:', e.message);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
