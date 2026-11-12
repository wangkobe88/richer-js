#!/usr/bin/env node
// ============================================================================
// KOL 研究·KOL 钱包画像批量采集（GMGN getWalletStats：winrate/realized_profit）
//   读 data/kol-study/kol-wallets.json → 分批查询 → data/kol-study/kol-wallet-stats.json
//   用法：node scripts/gmgn-kol/fetch-kol-stats.cjs [--period 30d] [--batch 5]
// ============================================================================
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../config/.env') });

const args = process.argv.slice(2);
function argVal(k, dflt) { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; }
const PERIOD = argVal('--period', '30d');
const BATCH = Number(argVal('--batch', 5));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { GMGNPortfolioAPI } = require('../../src/core/gmgn-api');
  const api = new GMGNPortfolioAPI({ apiKey: process.env.GMGN_API_KEY });
  const wallets = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/kol-study/kol-wallets.json'), 'utf8'));
  const out = {};
  const addrs = wallets.map((w) => w.wallet);
  console.log(`wallets=${addrs.length} period=${PERIOD} batch=${BATCH}`);
  for (let i = 0; i < addrs.length; i += BATCH) {
    const batch = addrs.slice(i, i + BATCH);
    // 实测 /v1/user/wallet_stats 多地址只回第一个 → 强制单地址逐查
    for (const addr of batch) {
      let ok = false;
      for (let t = 0; t < 5 && !ok; t++) {
        if (t > 0) { console.log(`  retry ${t}`); await sleep(120000); }
        try {
          const r = await api.getWalletStats('bsc', [addr], PERIOD);
          if (r && r.wallet_address) out[r.wallet_address.toLowerCase()] = r;
          ok = true;
        } catch (e) {
          const is429 = /429|RATE_LIMIT/i.test(e.message);
          console.log(`  ERR ${addr.slice(0, 8)}…: ${e.message.slice(0, 90)}${is429 ? ' (rate-limit)' : ''}`);
          if (!is429) break;
        }
      }
      await sleep(4000);
    }
    console.log(`[${Math.min(i + BATCH, addrs.length)}/${addrs.length}] stats=${Object.keys(out).length}`);
  }
  fs.writeFileSync(path.join(__dirname, '../../data/kol-study/kol-wallet-stats.json'), JSON.stringify({ period: PERIOD, stats: out }, null, 1));
  console.log('saved kol-wallet-stats.json');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
