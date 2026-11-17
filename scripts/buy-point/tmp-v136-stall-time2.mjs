// 补：卖飞 18 张票龄(token_create)+分组时间统计
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const rows = JSON.parse(readFileSync('/tmp/v136-stall-times.json', 'utf8'));
const flown = rows.filter(r => (r.maxRise15m ?? -999) >= 20);
const rest = rows.filter(r => (r.maxRise15m ?? -999) < 20);
const c = await dbManager.getClient();
// token_create（18 张，.in ≤100 一次）
const toks = flown.map(r => r.tok);
const evs = [];
{ let from = 0;
  while (true) {
    const q = await c.from('wss_events').select('token_address,block_time').eq('kind', 'token_create').in('token_address', toks.slice(0, 50)).order('id', { ascending: true }).range(from, from + 999);
    if (q.error) { console.error('ERR', q.error.message); process.exit(1); }
    evs.push(...q.data); from += q.data.length; if (q.data.length < 1000) break; } }
if (toks.length > 50) { let from = 0;
  while (true) { const q = await c.from('wss_events').select('token_address,block_time').eq('kind', 'token_create').in('token_address', toks.slice(50)).order('id', { ascending: true }).range(from, from + 999);
    if (q.error) break; evs.push(...q.data); from += q.data.length; if (q.data.length < 1000) break; } }
const createMap = new Map();
for (const e of evs) { const t = new Date(e.block_time).getTime(); if (!createMap.has(e.token_address) || t < createMap.get(e.token_address)) createMap.set(e.token_address, t); }
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const fmt = a => a.map(x => Math.round(x)).sort((x, y) => x - y).join(',');
console.log('=== 卖飞 18 张：卖飞时刻的票龄（stallAt - token_create）===');
const ages = [];
for (const r of flown) {
  const ct = createMap.get(r.tok);
  const age = ct ? Math.round((new Date(r.stallAt).getTime() - ct) / 1000) : null;
  ages.push(age);
  console.log(`${(r.sym || '').padEnd(10)} 卖飞票龄 ${String(age).padStart(4)}s | 持有 ${String(r.holdSec).padStart(3)}s | 卖后涨破+10% @${String(r.tPlus10).padStart(4)}s | maxRise ${String(r.maxRise15m).padStart(6)}% @+${String(r.riseDelaySec).padStart(3)}s | 卖出时盈亏 ${r.profitPct}%`);
}
console.log('\n=== 分组对比 ===');
console.log(`卖飞组(n=${flown.length})  holdSec: med=${med(flown.map(r => r.holdSec))} 全列=[${fmt(flown.map(r => r.holdSec))}]`);
console.log(`其余组(n=${rest.length})  holdSec: med=${med(rest.map(r => r.holdSec))}`);
console.log(`全体(n=${rows.length})    holdSec: med=${med(rows.map(r => r.holdSec))}`);
console.log(`卖飞组 tPlus10(涨破+10%): med=${med(flown.map(r => r.tPlus10).filter(x => x != null))}s 全列=[${fmt(flown.map(r => r.tPlus10).filter(x => x != null))}]`);
console.log(`卖飞组 riseDelay(maxRise时刻): med=${med(flown.map(r => r.riseDelaySec).filter(x => x != null))}s`);
console.log(`卖飞组票龄: med=${med(ages.filter(x => x != null))}s 全列=[${fmt(ages.filter(x => x != null))}]`);
// 时段(UTC小时)分布
const hrs = {};
for (const r of rows) { const h = new Date(r.stallAt).toISOString().slice(5, 16); hrs[h] = (hrs[h] || 0) + 1; }
console.log('\nstallClose 卖出墙钟分布(UTC, 10min桶仅示非空):', Object.entries(hrs).filter(([, v]) => v > 1).map(([k, v]) => `${k}×${v}`).join(' '));
const dayCnt = { '11-02': 0, '11-03': 0 };
for (const r of rows) dayCnt[r.stallAt.slice(5, 10)]++;
const flownDay = { '11-02': 0, '11-03': 0 };
for (const r of flown) flownDay[r.stallAt.slice(5, 10)]++;
console.log(`天数分布: 11-02 全体${dayCnt['11-02']}/卖飞${flownDay['11-02']} | 11-03 全体${dayCnt['11-03']}/卖飞${flownDay['11-03']}`);
await dbManager.end?.();
process.exit(0);
