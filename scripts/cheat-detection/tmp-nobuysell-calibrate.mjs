// tmp-nobuysell-calibrate.mjs — 零买入纯卖方锚 + insider 档位 128 票定线研究（批次六 G8+分仓通道）
// 用户裁定「双修」：noBuySellPct 代码锚+分仓通道 / insider_supply_sell 进通道——本脚本出分布与人工对照
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');

const DATA = 'scripts/cheat-detection/data';
let fxDoc; try { fxDoc = JSON.parse(readFileSync('scripts/cheat-detection/fixtures.json', 'utf8')); }
catch { fxDoc = JSON.parse(readFileSync(`${DATA}/fixtures.json`, 'utf8')); }
const fixtures = fxDoc.cases;

// 存档档位 join（基线×2 + 批次六真调）
const insiderByAddr = new Map(), gradeByAddr = new Map();
for (const f of ['cd-baseline-aed2091d-2026-11-01T00-12-49-614Z.json', 'cd-baseline-4012ce39-2026-11-01T00-14-26-500Z.json', 'cd-run-2026-11-02T03-59-29-779Z.json']) {
  let doc; try { doc = JSON.parse(readFileSync(`${DATA}/${f}`, 'utf8')); } catch { continue; }
  for (const c of doc.cases ?? doc.results ?? []) {
    const a = c.addr.toLowerCase();
    if (!insiderByAddr.has(a)) {
      insiderByAddr.set(a, c.interp?.extLevels?.insider_supply_sell ?? null);
      gradeByAddr.set(a, c.grade ?? null);
    }
  }
}

const sb = dbManager.getClient();
const out = [];
for (const c of fixtures) {
  const addr = c.addr.toLowerCase();
  const { data, error } = await sb.from('wss_price_ticks')
    .select('trade_type,bnb_amount,sender_address,trader_address')
    .eq('token_address', addr)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .limit(c.anchor?.tickCount ?? 3000);
  if (error) throw error;
  const rows = data ?? [];
  const agg = new Map();
  for (const r of rows) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    const e = agg.get(w) || { buy: 0, sell: 0 };
    if (r.trade_type === 'buy') e.buy += r.bnb_amount; else e.sell += r.bnb_amount;
    agg.set(w, e);
  }
  const totalSell = [...agg.values()].reduce((s, e) => s + e.sell, 0);
  const noBuySell = [...agg.values()].filter((e) => e.buy === 0 && e.sell > 0).reduce((s, e) => s + e.sell, 0);
  const noBuyN = [...agg.values()].filter((e) => e.buy === 0 && e.sell > 0).length;
  out.push({
    id: c.caseId, sym: (c.symbol ?? c.caseId).slice(0, 10), anchor: rows.length,
    noBuySellPct: totalSell > 0 ? +(noBuySell / totalSell * 100).toFixed(1) : null,
    noBuyN, insider: insiderByAddr.get(addr) ?? '-', expect: c.expect?.verdict ?? '-', grade: gradeByAddr.get(addr) ?? '-',
  });
}
out.sort((a, b) => (b.noBuySellPct ?? -1) - (a.noBuySellPct ?? -1));
console.log('案号     | 代币       | 锚  | 零买纯卖% | 纯卖户数 | insider    | 人工     | 机器grade');
for (const r of out) {
  console.log(`${r.id.padEnd(8)} | ${(r.sym ?? '').padEnd(10)} | ${String(r.anchor).padStart(3)} | ${r.noBuySellPct === null ? '  null' : String(r.noBuySellPct).padStart(5) + '%'} | ${String(r.noBuyN).padStart(6)} | ${r.insider.padEnd(10)} | ${r.expect.padEnd(8)} | ${r.grade}`);
}
const withPct = out.filter((r) => r.noBuySellPct !== null);
for (const line of [20, 30, 40, 50, 60]) {
  const hit = withPct.filter((r) => r.noBuySellPct >= line);
  const bad = hit.filter((r) => r.expect === 'healthy');
  console.log(`\n线 ${line}%：触发 ${hit.length} 票（人工 cheat/unhealthy ${hit.filter((r) => r.expect === 'cheat' || r.expect === 'unhealthy').length}）误伤 healthy ${bad.length}${bad.length ? '：' + bad.map((r) => r.id).join(',') : ''}`);
}
console.log(`\ninsider 档位分布（join ${insiderByAddr.size} 案）：`);
const insDist = {};
for (const r of out) insDist[r.insider] = (insDist[r.insider] || 0) + 1;
console.log(JSON.stringify(insDist));
const insMod = out.filter((r) => r.insider === 'moderate' || r.insider === 'strong');
console.log(`insider moderate/strong ${insMod.length} 票：`);
for (const r of insMod) console.log(`  ${r.id} ${r.sym} 纯卖${r.noBuySellPct ?? '-'}% 人工=${r.expect} 机器=${r.grade}`);
