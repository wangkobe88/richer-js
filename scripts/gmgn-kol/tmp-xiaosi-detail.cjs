#!/usr/bin/env node
// tmp：小四 0xf0576fc1 KOL 参与明细时间线
const path = require('path');
const fs = require('fs');
const DIR = path.join(__dirname, '../../data/kol-study');
const ADDR = '0xf0576fc1267506123b0bb843b2a325e9010b4444';
const roster = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map((w) => w.toLowerCase()));
const ps = JSON.parse(fs.readFileSync(path.join(DIR, 'price-series.json'), 'utf8'))[ADDR];
const creates = JSON.parse(fs.readFileSync(path.join(DIR, 'token-create.json'), 'utf8'));
const bt = JSON.parse(fs.readFileSync(path.join(DIR, 'btv105-trades.json'), 'utf8')).tokens.find((t) => t.address === ADDR);
const { rows } = JSON.parse(fs.readFileSync(path.join(DIR, 'top-traders', ADDR + '.json'), 'utf8'));
const createSec = Date.parse(creates[ADDR].blockTime) / 1000;
const buySec = Date.parse(bt.firstBuyAt) / 1000;
const priceAt = (sec) => { if (sec == null || sec <= ps.firstTs) return ps.launch; let lo = 0, hi = ps.samples.length - 1, ans = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (ps.samples[m][0] <= sec) { ans = m; lo = m + 1; } else hi = m - 1; } return ps.samples[ans][1]; };
const pct = (sec) => { const p = priceAt(sec); return p != null ? ((p / ps.launch - 1) * 100).toFixed(1) : '?'; };
const t0 = (sec) => (sec == null ? '?' : sec < createSec ? 't-' + Math.round(createSec - sec) + 's' : 't+' + Math.round(sec - createSec) + 's');
console.log(`小四 ${ADDR}`);
console.log(`create=${creates[ADDR].blockTime}  我方买点=${bt.firstBuyAt}(${t0(buySec)} @+${pct(buySec)}%)  pnl=${bt.pnl}`);
console.log(`launch=${ps.launch.toExponential(4)}  ATH=+${((ps.ath / ps.launch - 1) * 100).toFixed(1)}% @${t0(ps.athTs)}  ticks=${ps.n}\n`);
console.log('== KOL（tags 含 kol）==');
const kols = rows.filter((r) => Array.isArray(r.tags) && r.tags.includes('kol'));
for (const r of kols) {
  const s = r.start_holding_at, e = r.end_holding_at;
  console.log(`${(r.maker_info?.name || r.twitter_username || r.address.slice(0, 8)).padEnd(16)} ${roster.has(r.address.toLowerCase()) ? '★' : ' '} 入${t0(s)}@+${pct(s)}% → 出${t0(e)}${e ? `@+${pct(e)}%` : '(仍持有)'}  持${s && e ? e - s : '?'}s  买$${(r.buy_volume_cur || 0).toFixed(0)} 卖$${(r.sell_volume_cur || 0).toFixed(0)} 利$${(r.profit || 0).toFixed(0)}  tx ${r.buy_tx_count_cur || 0}/${r.sell_tx_count_cur || 0}`);
}
console.log(`\nKOL 合计买入 $${kols.reduce((s, r) => s + (r.buy_volume_cur || 0), 0).toFixed(0)}（${kols.length} 人）`);
console.log('\n== top traders 买入额前十（含非 KOL）==');
for (const r of [...rows].sort((a, b) => (b.buy_volume_cur || 0) - (a.buy_volume_cur || 0)).slice(0, 10)) {
  const kol = Array.isArray(r.tags) && r.tags.includes('kol');
  console.log(`${(r.maker_info?.name || r.address.slice(0, 8)).padEnd(16)}${kol ? '[KOL]' : '     '} 买$${(r.buy_volume_cur || 0).toFixed(0)} 卖$${(r.sell_volume_cur || 0).toFixed(0)} 利$${(r.profit || 0).toFixed(0)} 入${t0(r.start_holding_at)}@+${pct(r.start_holding_at)}%`);
}
console.log(`\ntop100 合计买入 $${rows.reduce((s, r) => s + (r.buy_volume_cur || 0), 0).toFixed(0)}`);
