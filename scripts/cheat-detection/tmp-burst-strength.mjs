// tmp-burst-strength.mjs — burst 强度分布分析（批次六用户指令）
// 裁定待验：「长期停滞突然涌入一波小流量，依然应该算低活跃度；涌入流量大才能推翻低活跃度」
// 对基线存档 sbw=burst 票算 burst 波强度指标：maxGap/波内笔数/波ΣBNB/波钱包数/波买占比
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');

const DATA = 'scripts/cheat-detection/data';
let fixturesDoc;
try { fixturesDoc = JSON.parse(readFileSync('scripts/cheat-detection/fixtures.json', 'utf8')); }
catch { fixturesDoc = JSON.parse(readFileSync(`${DATA}/fixtures.json`, 'utf8')); }
const fixtures = fixturesDoc.cases;
const caseByAddr = new Map(fixtures.map((c) => [c.addr.toLowerCase(), c]));

// 基线档位 join（aed2091d + 4012ce39 两份，后到不覆盖）
const sbwByAddr = new Map(), actByAddr = new Map(), gradeByAddr = new Map();
for (const f of ['cd-baseline-aed2091d-2026-11-01T00-12-49-614Z.json', 'cd-baseline-4012ce39-2026-11-01T00-14-26-500Z.json', 'cd-run-2026-11-02T03-59-29-779Z.json']) {
  let doc; try { doc = JSON.parse(readFileSync(`${DATA}/${f}`, 'utf8')); } catch (e) { console.error('基线读失败:', f, e.message); continue; }
  for (const c of doc.cases ?? doc.results ?? []) {
    const a = c.addr.toLowerCase();
    if (!sbwByAddr.has(a)) {
      sbwByAddr.set(a, c.interp?.extLevels?.stall_burst_wave ?? null);
      actByAddr.set(a, c.interp?.activityLevel?.bucket ?? null);
      gradeByAddr.set(a, c.grade ?? null);
    }
  }
}
console.log(`基线 join 池：${sbwByAddr.size} 案；fixtures：${fixtures.length} 案`);

const sb = dbManager.getClient();
const TICK_COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,sender_address,trader_address';

const burstAddrs = [...sbwByAddr.entries()].filter(([, v]) => v === 'burst').map(([a]) => a);
console.log(`sbw=burst 共 ${burstAddrs.length} 案\n`);

const WAVE_SEC = 5;
console.log('案    | 案号      | act   | 人工裁定 | 锚 | 窗sec | maxGap | 波笔 | 波Σbnb | 波钱包 | 波Σ买 | 波买占比');
for (const addr of burstAddrs) {
  const c = caseByAddr.get(addr);
  const { data, error } = await sb.from('wss_price_ticks')
    .select(TICK_COLS).eq('token_address', addr)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .limit(c?.anchor?.tickCount ?? 3000);
  if (error) throw error;
  const rows = (data ?? []).map((r) => ({
    ts: Date.parse(r.block_time), side: r.trade_type, bnb: r.bnb_amount,
    wallet: (r.sender_address || r.trader_address || '').toLowerCase(),
  }));
  if (rows.length < 2) { console.log(`${(c?.symbol ?? '?').padEnd(5)} | ${c?.caseId ?? addr.slice(0, 8)} | 数据不足`); continue; }
  const t0 = rows[0].ts, t1 = rows[rows.length - 1].ts;
  const dur = (t1 - t0) / 1000;
  let maxGap = 0;
  for (let i = 1; i < rows.length; i++) maxGap = Math.max(maxGap, (rows[i].ts - rows[i - 1].ts) / 1000);
  // 最密 5s 滑窗（双指针）
  let best = { n: 0, bnb: 0, wallets: new Set(), buy: 0 };
  let j = 0, cur = { n: 0, bnb: 0, wallets: new Set(), buy: 0 };
  for (let i = 0; i < rows.length; i++) {
    cur.n++; cur.bnb += rows[i].bnb; cur.wallets.add(rows[i].wallet);
    if (rows[i].side === 'buy') cur.buy += rows[i].bnb;
    while (rows[i].ts - rows[j].ts > WAVE_SEC * 1000) {
      cur.n--; cur.bnb -= rows[j].bnb; cur.wallets.delete(rows[j].wallet);
      if (rows[j].side === 'buy') cur.buy -= rows[j].bnb;
      j++;
    }
    if (cur.n > best.n) best = { n: cur.n, bnb: cur.bnb, wallets: new Set(cur.wallets), buy: cur.buy };
  }
  const totalBuy = rows.filter((r) => r.side === 'buy').reduce((s, r) => s + r.bnb, 0);
  const id = (c?.caseId ?? '?').padEnd(9);
  console.log(
    `${(c?.symbol ?? '?').padEnd(5)} | ${id} | ${(actByAddr.get(addr) ?? '-').padEnd(5)} | ${(c?.expect?.verdict ?? '-').padEnd(7)} | ${String(rows.length).padStart(2)} | ${String(Math.round(dur)).padStart(5)} | ${String(maxGap.toFixed(0)).padStart(6)} | ${String(best.n).padStart(4)} | ${best.bnb.toFixed(2).padStart(6)} | ${String(best.wallets.size).padStart(6)} | ${best.buy.toFixed(2).padStart(6)} | ${totalBuy > 0 ? (best.buy / totalBuy * 100).toFixed(0) + '%' : '-'}`,
  );
}
console.log('\n对照：批次六 CD37/CD79 用户定性「burst 偏弱=涌入一点流量」；强度列供定线参考（波Σ买/波买占比/波钱包数）');
