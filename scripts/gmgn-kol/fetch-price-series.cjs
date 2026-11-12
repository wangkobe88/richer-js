#!/usr/bin/env node
// ============================================================================
// KOL 研究·票池价格序列提取（流式读 BacktestTickCache jsonl.gz → 派生指标）
//   → data/kol-study/price-series.json
//   per token：launch（首 tick 价）/ath/athTs/末价 + 2s 降采样序列
//   价格剔除 price_outlier 行；tick 为链上真序（cache 已排）
// ============================================================================
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');

const SRC = '/home/ubuntu/richer-js/data/tick-cache/backtest/c6efed13-ce9d-41b0-89a5-8ca8b029a609';
const POOL = path.join(__dirname, '../../scripts/buy-point/sets/kol-study-pool.json');
const OUT = path.join(__dirname, '../../data/kol-study/price-series.json');

async function* lines(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()) });
  for await (const l of rl) if (l.trim()) yield l;
}

async function main() {
  const pool = JSON.parse(fs.readFileSync(POOL, 'utf8'));
  const want = new Set(pool.tokens.map((t) => t.address));
  const ticks = {}; // addr -> [{ts, p}]
  let nRead = 0, nKept = 0;
  for (const plat of ['fourmeme', 'flap']) {
    const f = path.join(SRC, plat + '.jsonl.gz');
    if (!fs.existsSync(f)) continue;
    for await (const l of lines(f)) {
      nRead++;
      let r; try { r = JSON.parse(l); } catch { continue; }
      if (!want.has(r.token_address) || r.price_outlier || !r.price_bnb) continue;
      (ticks[r.token_address] || (ticks[r.token_address] = [])).push({ ts: Date.parse(r.block_time), p: r.price_bnb });
      nKept++;
    }
  }
  const out = {};
  for (const [addr, arr] of Object.entries(ticks)) {
    arr.sort((a, b) => a.ts - b.ts);
    const launch = arr[0].p;
    let ath = 0, athTs = null;
    const samples = []; // 2s 降采样（保极值近似）
    let lastS = -1e18;
    for (const t of arr) {
      if (t.p > ath) { ath = t.p; athTs = t.ts; }
      if (t.ts - lastS >= 2000) { samples.push([Math.round(t.ts / 1000), t.p]); lastS = t.ts; }
    }
    out[addr] = { symbol: pool.tokens.find((x) => x.address === addr)?.symbol, platform: pool.tokens.find((x) => x.address === addr)?.platform || null, n: arr.length, firstTs: Math.round(arr[0].ts / 1000), lastTs: Math.round(arr[arr.length - 1].ts / 1000), launch, ath, athTs: athTs && Math.round(athTs / 1000), lastP: arr[arr.length - 1].p, samples };
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const missed = pool.tokens.filter((t) => !out[t.address]);
  console.log(`read=${nRead} kept=${nKept} tokens=${Object.keys(out).length}/${want.size} missed=${missed.length}`);
  if (missed.length) console.log('missed:', missed.map((m) => m.symbol).join(','));
  // 速览：ATH 涨幅分布
  const aths = Object.values(out).map((v) => (v.ath / v.launch - 1) * 100).sort((a, b) => a - b);
  const q = (x) => aths[Math.floor(aths.length * x)];
  console.log(`ATH% 分布: min=${aths[0].toFixed(0)} P25=${q(0.25).toFixed(0)} 中位=${q(0.5).toFixed(0)} P75=${q(0.75).toFixed(0)} max=${aths[aths.length - 1].toFixed(0)}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
