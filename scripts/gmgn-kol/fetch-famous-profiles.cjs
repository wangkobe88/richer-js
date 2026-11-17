#!/usr/bin/env node
// ============================================================================
// famous 名单 GMGN 身份档案采集（/v1/user/wallet_stats 的 common 段：
// twitter_username/twitter_name/粉丝数/tags + 30d 盈亏统计）
//   读 config/rosters/famous-copy-wallets.json → 逐址查询（增量：档案里已有
//   的跳过，--refresh 全量重查）→ 写 config/rosters/famous-wallet-profiles.json
//   （tmp+rename 原子写，进 git——web /api/rosters/famous-wallets 合并返回，
//   signals 页价格图 famous 标记 tooltip 显示用户名）
//   用法：node scripts/gmgn-kol/fetch-famous-profiles.cjs [--refresh]
// ============================================================================
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../config/.env') });

const ROSTER = path.join(__dirname, '../../config/rosters/famous-copy-wallets.json');
const OUT = path.join(__dirname, '../../config/rosters/famous-wallet-profiles.json');
const REFRESH = process.argv.includes('--refresh');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickProfile(data) {
  const c = (data && data.common) || {};
  return {
    name: c.name || '',
    twitterName: c.twitter_name || '',
    twitterUsername: c.twitter_username || '',
    twitterFans: typeof c.twitter_fans_num === 'number' ? c.twitter_fans_num : null,
    tags: Array.isArray(c.tags) ? c.tags : [],
    realizedProfit: data && data.realized_profit != null ? String(data.realized_profit) : null,
    winrate: data && data.pnl_stat && data.pnl_stat.winrate != null ? data.pnl_stat.winrate : null,
    tokenNum: data && data.pnl_stat && data.pnl_stat.token_num != null ? data.pnl_stat.token_num : null,
    lastActiveAt: data && data.last_timestamp ? data.last_timestamp : null,
    fetchedAt: new Date().toISOString(),
  };
}

async function main() {
  const { GMGNPortfolioAPI } = require('../../src/core/gmgn-api');
  const api = new GMGNPortfolioAPI({ apiKey: process.env.GMGN_API_KEY });

  const roster = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
  const addrs = (roster.wallets || []).map((w) => String(w).toLowerCase());
  const existing = fs.existsSync(OUT)
    ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { profiles: {} };
  const profiles = REFRESH ? {} : { ...(existing.profiles || {}) };

  const todo = addrs.filter((a) => !profiles[a]);
  console.log(`famous=${addrs.length} 已有=${addrs.length - todo.length} 待查=${todo.length}${REFRESH ? ' (--refresh 全量)' : ''}`);

  let done = 0, failed = 0;
  for (const addr of todo) {
    let ok = false;
    for (let t = 0; t < 5 && !ok; t++) {
      if (t > 0) { console.log(`  retry ${t}`); await sleep(120000); }
      try {
        const r = await api.getWalletStats('bsc', [addr], '30d');
        if (r && r.wallet_address) {
          profiles[addr] = pickProfile(r);
          ok = true;
        } else {
          // 空/无记录也是结论（GMGN 未收录）——占位防每轮重查
          profiles[addr] = { name: '', twitterName: '', twitterUsername: '', twitterFans: null, tags: [], realizedProfit: null, winrate: null, tokenNum: null, lastActiveAt: null, fetchedAt: new Date().toISOString() };
          console.log(`  ${addr.slice(0, 10)}… GMGN 无记录`);
          ok = true;
        }
      } catch (e) {
        const is429 = /429|RATE_LIMIT/i.test(e.message);
        console.log(`  ERR ${addr.slice(0, 10)}…: ${e.message.slice(0, 90)}${is429 ? ' (rate-limit)' : ''}`);
        if (!is429) break;
      }
    }
    if (!ok) { failed++; } else { done++; }
    await sleep(4000);
  }

  // 按 roster 顺序输出（对象键序稳定，git diff 友好）
  const ordered = {};
  for (const a of addrs) if (profiles[a]) ordered[a] = profiles[a];
  const payload = { version: roster.version || null, updatedAt: new Date().toISOString(), profiles: ordered };
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 1));
  fs.renameSync(tmp, OUT);
  const named = Object.values(ordered).filter((p) => p.twitterUsername || p.name || p.twitterName).length;
  console.log(`saved ${OUT}: ${Object.keys(ordered).length} 址（有身份 ${named}），本次新查 ${done} 失败 ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
