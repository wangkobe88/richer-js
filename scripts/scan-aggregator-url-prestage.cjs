#!/usr/bin/env node
/**
 * C99 存量影响面扫描：聚合器自动页 URL 致 prestage addressVerified=true 的行
 *
 * 背景：修复前 isProjectCoin 的 classifiedUrls URL 臂把 dex.coinmarketcap.com 等
 * 聚合器自动 token 页（URL 路径天然含本币 CA）当成「项目币网站验证」→
 * skipAddressValidation → performRulesValidation 直接 addressVerified=true，
 * 短路了小号的强制地址门。
 *
 * 判据（近似，偏保守）：prestage_result.details.addressVerified===true 且
 * classified_urls.websites 存在聚合器域名 URL 其路径含本币地址。落库 twitter_info
 * 无推文列表，无法重放「推文臂是否本来也会命中」——命中行需人工复核（重析即消）。
 *
 * 在 182 跑（重查询红线：本地 VPN 直连必超时）。service key + id keyset 分页。
 * 退出码 1=有命中（对齐 scan-unknown-factor-conditions 惯例）。
 *
 * 用法：node scripts/scan-aggregator-url-prestage.cjs
 */
'use strict';

const { dbManager } = require('../src/services/dbManager.js');

const PAGE = 500;

async function main() {
  const { isAutoTokenPageUrl } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');
  const client = await dbManager.getClient();

  const hits = [];
  let scanned = 0;
  let cursor = null;

  while (true) {
    let q = client
      .from('token_narrative')
      .select('id,token_address,token_symbol,prompt_type,prestage_result,classified_urls')
      .order('id', { ascending: true })
      .limit(PAGE);
    if (cursor) q = q.gt('id', cursor);
    const { data, error } = await q;
    if (error) throw error;
    if (!data.length) break;
    cursor = data[data.length - 1].id;
    scanned += data.length;

    for (const row of data) {
      const av = row.prestage_result?.details?.addressVerified ?? row.prestage_result?.addressVerified;
      if (av !== true) continue;
      const websites = row.classified_urls?.websites || [];
      const addr = String(row.token_address || '').toLowerCase();
      if (!addr) continue;
      const hitUrls = websites
        .map(w => w?.url)
        .filter(u => u && String(u).toLowerCase().includes(addr) && isAutoTokenPageUrl(u));
      if (hitUrls.length) {
        hits.push({
          token: row.token_address,
          symbol: row.token_symbol,
          promptType: row.prompt_type,
          prestageRating: row.prestage_result?.rating ?? row.prestage_result?.details?.rating ?? null,
          urls: hitUrls,
        });
      }
    }
    if (data.length < PAGE) break;
  }

  console.log(`扫描 ${scanned} 行，疑似经聚合器 URL 洞获得 addressVerified=true：${hits.length} 行`);
  for (const h of hits) {
    console.log(`  ${h.token} ${h.symbol ?? ''} [${h.promptType ?? '-'}] prestage=${h.prestageRating} 命中URL=${h.urls.join(' , ')}`);
  }
  if (hits.length) {
    console.log('\n注：近似判据（落库无推文列表，无法排除「推文本也宣告 CA」）——命中行建议重析复核。');
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
