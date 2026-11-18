#!/usr/bin/env node
// ============================================================================
// 临时探针：GMGN BSC 聪明钱流 (/v1/user/smartmoney) 单次快照统计
//   - 唯一 maker 数、tags 分布、token 覆盖、金额量级
//   - 注意该端点只有最近 ~24min 流窗、无翻页（snapshot-kol-stream.cjs 已实测）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../config/.env') });

async function main() {
  const { GMGNTrackAPI } = require('../../src/core/gmgn-api');
  const api = new GMGNTrackAPI({ apiKey: process.env.GMGN_API_KEY });
  const r = await api.getSmartMoneyTrades('bsc', 200);
  const list = (r && (r.list || r)) || [];
  console.log('返回行数:', list.length);

  const wallets = new Map();
  const tokens = new Set();
  let usdSum = 0;
  for (const t of list) {
    const info = t.maker_info || {};
    const addr = t.maker || t.base_address;
    tokens.add(t.base_address);
    const usd = Number(t.amount_usd) || 0;
    usdSum += usd;
    if (!wallets.has(addr)) {
      wallets.set(addr, { name: info.name || null, twitter: info.twitter_username || null, tags: Array.isArray(info.tags) ? info.tags : [], n: 0, usd: 0 });
    }
    const w = wallets.get(addr);
    w.n++; w.usd += usd;
  }
  console.log('唯一聪明钱 maker:', wallets.size);
  console.log('覆盖 token 数:', tokens.size);
  console.log('流内成交额合计 USD:', Math.round(usdSum));

  const tagCount = {};
  for (const w of wallets.values()) for (const tag of w.tags) tagCount[tag] = (tagCount[tag] || 0) + 1;
  console.log('maker tags 分布:', JSON.stringify(tagCount));

  const sorted = [...wallets.entries()].sort((a, b) => b[1].usd - a[1].usd).slice(0, 10);
  console.log('\nTop10 按 USD:');
  for (const [addr, w] of sorted) {
    console.log(`  ${addr} ${w.name || '-'} tags=[${w.tags.join(',')}] tx=${w.n} usd=${Math.round(w.usd)}`);
  }
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
