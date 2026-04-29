#!/usr/bin/env node
/**
 * 批量 GMGN 安全检测 + 社交信息检查
 * 针对指定实验中的所有代币
 */

require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const { GMGNTokenAPI } = require('../src/core/gmgn-api');

const EXPERIMENT_ID = process.argv[2];
if (!EXPERIMENT_ID) {
  console.error('Usage: node scripts/batch-gmgn-check-experiment.js <experiment_id>');
  process.exit(1);
}

// 预检查通过条件（与策略配置一致）
const PASS_CONDITIONS = {
  gmgnIsHoneypot: false,
  gmgnIsOpenSource: true,
  gmgnIsRenounced: true,
  gmgnSellTax: 0.01,
  gmgnBuyTax: 0.01,
  gmgnHasBlacklist: (v) => v !== 1,
  gmgnHasAlert: false,
  gmgnTop10HolderRate: 0.8,
};

function assessPass(factors) {
  const fails = [];
  if (factors.gmgnIsHoneypot !== false) fails.push('HONEYPOT');
  if (factors.gmgnIsOpenSource !== true) fails.push('NOT_OPEN_SOURCE');
  if (factors.gmgnIsRenounced !== true) fails.push('NOT_RENOUNCED');
  if (factors.gmgnSellTax >= 0.01) fails.push(`SELL_TAX=${(factors.gmgnSellTax * 100).toFixed(2)}%`);
  if (factors.gmgnBuyTax >= 0.01) fails.push(`BUY_TAX=${(factors.gmgnBuyTax * 100).toFixed(2)}%`);
  if (factors.gmgnHasBlacklist === 1) fails.push('BLACKLIST');
  if (factors.gmgnHasAlert === true) fails.push('ALERT');
  if (factors.gmgnTop10HolderRate >= 0.8) fails.push(`TOP10=${(factors.gmgnTop10HolderRate * 100).toFixed(1)}%`);
  return fails;
}

function parseTax(val) {
  if (val == null || val === '') return 0;
  return parseFloat(val) || 0;
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const api = new GMGNTokenAPI({
    apiKey: process.env.GMGN_API_KEY,
    socksProxy: process.env.GMGN_SOCKS_PROXY,
  });

  // 预解析域名
  console.log('预解析 GMGN API 域名...');
  await api.init();

  // 获取实验代币
  const { data: tokens, error } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, blockchain')
    .eq('experiment_id', EXPERIMENT_ID);

  if (error) {
    console.error('查询代币失败:', error.message);
    process.exit(1);
  }

  console.log(`\n共 ${tokens.length} 个代币需要检测\n`);

  const results = [];
  let passCount = 0;
  let failCount = 0;
  let errorCount = 0;
  let socialCount = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const chain = (t.blockchain || 'eth').replace('ethereum', 'eth');
    const symbol = t.token_symbol || '?';

    process.stdout.write(`\r[${i + 1}/${tokens.length}] ${symbol}...`);

    try {
      // 并行获取 security + info
      const [sec, inf] = await Promise.all([
        api.getTokenSecurity(chain, t.token_address),
        api.getTokenInfo(chain, t.token_address),
      ]);

      // 提取因子
      const security = sec || {};
      const info = inf || {};
      const link = info.link || {};

      const hasTwitter = !!(link.twitter_username);
      const hasTelegram = !!(link.telegram);
      const hasWebsite = !!(link.website);
      const hasDiscord = !!(link.discord);
      const socialLinks = [hasTwitter && 'Twitter', hasTelegram && 'Telegram', hasWebsite && 'Website', hasDiscord && 'Discord'].filter(Boolean);
      const hasAnySocial = socialLinks.length > 0;

      if (hasAnySocial) socialCount++;

      const factors = {
        gmgnSecurityAvailable: 1,
        gmgnIsHoneypot: security.is_honeypot === true,
        gmgnIsOpenSource: security.is_open_source === true,
        gmgnIsRenounced: security.is_renounced === true,
        gmgnHasBlacklist: security.blacklist === 1 ? 1 : (security.blacklist === -1 ? -1 : 0),
        gmgnBuyTax: parseTax(security.buy_tax),
        gmgnSellTax: parseTax(security.sell_tax),
        gmgnTop10HolderRate: parseTax(security.top_10_holder_rate),
        gmgnHasAlert: security.is_show_alert === true,
        gmgnHolderCount: info.holder_count || 0,
        gmgnLiquidity: parseFloat(info.liquidity) || 0,
        hasAnySocial,
        socialLinks: socialLinks.join(','),
        hasTwitter,
        hasTelegram,
        hasWebsite,
        lpLocked: (security.lock_summary || {}).is_locked === true,
        privilegesCount: Array.isArray(security.privileges) ? security.privileges.length : 0,
      };

      const fails = assessPass(factors);
      const passed = fails.length === 0 && hasAnySocial;

      if (passed) passCount++;
      else failCount++;

      results.push({
        idx: i + 1,
        symbol,
        address: t.token_address,
        passed,
        fails: fails.join(', '),
        noSocial: !hasAnySocial,
        ...factors,
      });

    } catch (e) {
      errorCount++;
      const errMsg = e.message?.slice(0, 100) || 'Unknown error';
      results.push({
        idx: i + 1,
        symbol,
        address: t.token_address,
        passed: false,
        fails: 'API_ERROR',
        error: errMsg,
      });

      // 遇到限频等待
      if (errMsg.includes('429') || errMsg.includes('RATE_LIMIT')) {
        console.log(`\n  ⚠️ 限频，等待 10s...`);
        await new Promise(r => setTimeout(r, 10000));
      }
    }

    // 每个代币间隔 2s 避免限频
    if (i < tokens.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log('\n\n========================================');
  console.log('📊 检测结果汇总');
  console.log('========================================');
  console.log(`总代币数: ${tokens.length}`);
  console.log(`✅ 通过: ${passCount} (${(passCount / tokens.length * 100).toFixed(1)}%)`);
  console.log(`❌ 未通过: ${failCount} (${(failCount / tokens.length * 100).toFixed(1)}%)`);
  console.log(`⚠️ API错误: ${errorCount}`);
  console.log(`📱 有社交信息: ${socialCount} (${(socialCount / tokens.length * 100).toFixed(1)}%)`);
  console.log('');

  // 统计失败原因分布
  const failReasonStats = {};
  for (const r of results) {
    if (r.fails && r.fails !== 'API_ERROR') {
      for (const f of r.fails.split(', ')) {
        if (f) failReasonStats[f] = (failReasonStats[f] || 0) + 1;
      }
    }
    if (r.noSocial) failReasonStats['NO_SOCIAL'] = (failReasonStats['NO_SOCIAL'] || 0) + 1;
  }
  console.log('失败原因分布:');
  for (const [reason, count] of Object.entries(failReasonStats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count} (${(count / tokens.length * 100).toFixed(1)}%)`);
  }

  // 输出通过的代币
  const passed = results.filter(r => r.passed);
  if (passed.length > 0) {
    console.log('\n========================================');
    console.log('✅ 通过预检查的代币');
    console.log('========================================');
    for (const t of passed) {
      console.log(`  ${t.symbol} | ${t.address}`);
      console.log(`    持有者:${t.gmgnHolderCount} 流动性:$${t.gmgnLiquidity.toFixed(0)} 社交:${t.socialLinks} LP锁定:${t.lpLocked}`);
    }
  }

  // 输出所有结果（JSON）
  console.log('\n========================================');
  console.log('📋 详细结果');
  console.log('========================================');
  for (const r of results) {
    const icon = r.passed ? '✅' : r.error ? '⚠️' : '❌';
    const reason = r.error || r.fails || '';
    const social = r.hasAnySocial ? `📱${r.socialLinks}` : '📱无';
    console.log(`${icon} [${r.idx}] ${r.symbol} | ${r.address.slice(0, 10)}...`);
    console.log(`   原因:${reason || 'PASS'} | ${social} | 持有者:${r.gmgnHolderCount || '-'} | 流动性:$${(r.gmgnLiquidity || 0).toFixed(0)}`);
    if (!r.passed && !r.error) {
      console.log(`   蜜罐:${r.gmgnIsHoneypot} 开源:${r.gmgnIsOpenSource} 放弃:${r.gmgnIsRenounced} 买税:${(r.gmgnBuyTax * 100).toFixed(2)}% 卖税:${(r.gmgnSellTax * 100).toFixed(2)}% 黑名单:${r.gmgnHasBlacklist} 警报:${r.gmgnHasAlert} Top10:${(r.gmgnTop10HolderRate * 100).toFixed(1)}%`);
    }
  }

  console.log('\n✅ 检测完成');
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
