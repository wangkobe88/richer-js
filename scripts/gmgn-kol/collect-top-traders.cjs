#!/usr/bin/env node
// ============================================================================
// KOL 研究·票池 top_traders 采集（2026-11-12，famous/KOL 问题立项配套）
//
//   对 kol-study-pool.json 每 token 拉 GMGN /v1/market/token_top_traders
//   （含 maker tags=GMGN 权威 KOL 标注 / twitter_username / start·end_holding_at
//    时间线 / buy·sell_volume / profit），幂等落盘 data/kol-study/top-traders/。
//
//   - 串行 + 节流（GAP_MS，免费版 IP 限流敏感）；429 → 退避 BACKOFF_MS 重试
//   - 已存在文件跳过 = 断点续跑；单 token 重试上限后记录失败继续
//
// 用法（182）：node scripts/gmgn-kol/collect-top-traders.cjs [--gap 4000]
// ============================================================================
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../config/.env') });

const args = process.argv.slice(2);
function argVal(k, dflt) { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt; }
const GAP_MS = argVal('--gap', 4000);
const BACKOFF_MS = argVal('--backoff', 120000);
const MAX_RETRY = 5;

const POOL = path.join(__dirname, '../../scripts/buy-point/sets/kol-study-pool.json');
const OUT_DIR = path.join(__dirname, '../../data/kol-study/top-traders');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { GMGNTokenAPI } = require('../../src/core/gmgn-api');
  const api = new GMGNTokenAPI({ apiKey: process.env.GMGN_API_KEY });
  const pool = JSON.parse(fs.readFileSync(POOL, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const todo = pool.tokens.filter((t) => !fs.existsSync(path.join(OUT_DIR, t.address + '.json')));
  console.log(`pool=${pool.tokens.length} done=${pool.tokens.length - todo.length} todo=${todo.length} gap=${GAP_MS}ms`);
  if (!todo.length) { console.log('all done'); return; }

  const t0 = Date.now();
  let done = 0; const failed = [];
  for (const t of todo) {
    const file = path.join(OUT_DIR, t.address + '.json');
    let ok = false;
    for (let i = 0; i < MAX_RETRY && !ok; i++) {
      if (i > 0) { console.log(`  retry ${i} ${t.symbol}`); await sleep(BACKOFF_MS); }
      try {
        const r = await api.getTokenTopTraders('bsc', t.address, { limit: 100 });
        const rows = r.list || [];
        fs.writeFileSync(file + '.tmp', JSON.stringify({ address: t.address, symbol: t.symbol, fetchedAt: new Date().toISOString(), n: rows.length, rows }));
        fs.renameSync(file + '.tmp', file);
        ok = true;
      } catch (e) {
        const is429 = /429|RATE_LIMIT/i.test(e.message);
        console.log(`  ERR ${t.symbol} ${t.address.slice(0, 8)}: ${e.message.slice(0, 90)}${is429 ? ' (rate-limit)' : ''}`);
        if (!is429) break; // 非 429 不重试（4xx 参数/数据问题重试无益）
      }
    }
    if (!ok) failed.push(t.address);
    done++;
    if (done % 10 === 0) console.log(`[${done}/${todo.length}] elapsed=${Math.round((Date.now() - t0) / 1000)}s failed=${failed.length}`);
    await sleep(GAP_MS);
  }
  console.log(`\nDONE ${done} failed=${failed.length}`);
  if (failed.length) console.log('failed list:\n' + failed.join('\n'));
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
