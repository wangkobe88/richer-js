/** GMGN 路由入口占比分布（182 跑，一次性）：fixtures 全票锚窗——买入笔/金额
 * viaRouter 占比 + trader 形状 top3，按 expect.verdict 分组看误伤面（CD350 立案）*/
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { AGGREGATOR_ROUTER_ADDRS } = require_('../../src/trading-engine/pre-check/aggregator-routers');
const sb = () => require_('../../src/services/dbManager').dbManager.getClient();

// 9 址聚合路由全集（GMGN 清单 + 182 sender 多样性验证补录 8 址：distinct sender≥10
// 且零自 sender 行=trader 恒合约、sender 恒用户 EOA；完整地址 182 实查）
const ROUTERS = new Set([
  ...AGGREGATOR_ROUTER_ADDRS,
  '0x9689992f5b5c09447f15906d8d11214944488341',
  '0x3508dca95a64c9378cb07ef6f40553a50905372a',
  '0xd36b6d646ac6e23672e9eedec558164c7f2d6deb',
  '0x9e698d361bb2375bd335dad156accbbad45bf364',
  '0x01a21c857a3219991fba2b1a2824b1b758966b54',
  '0x296b00198dc7ec3410e12da814d9267bb8df506a',
  '0x90497450f2a706f1951b5bdda52b4e5d16f34c06',
  '0x168303a96a767e2a6b2e00cb862eb95e416f72fa',
]);
const isRouter = (t) => ROUTERS.has((t || '').toLowerCase());
const TICK_COLS = 'block_number,log_index,trade_type,bnb_amount,trader_address,sender_address';
const fx = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const cases = (fx.cases ?? fx).filter((c) => c.addr && c.anchor && Number.isFinite(c.anchor.tickCount));
console.log('票数:', cases.length);

const pct = (a, b) => (b > 0 ? +((a / b) * 100).toFixed(1) : null);
const out = [];
for (const c of cases) {
  const n = c.anchor.tickCount;
  let rows = [];
  let err = null;
  for (let p = 0; p < 8; p++) {
    const { data, error } = await sb().from('wss_price_ticks')
      .select(`${TICK_COLS},id`).eq('token_address', c.addr.toLowerCase())
      .gt('id', p === 0 ? 0 : rows[rows.length - 1].id)
      .order('id', { ascending: true }).limit(1000);
    if (error) { err = error.message; break; }
    rows.push(...data);
    if (data.length < 1000 || rows.length >= n) break;
  }
  if (err) { out.push({ id: c.caseId, sym: c.symbol, v: c.expect?.verdict, err }); continue; }
  rows.sort((a, b) => Number(a.block_number) - Number(b.block_number) || Number(a.log_index) - Number(b.log_index));
  const win = rows.slice(0, n);
  const buys = win.filter((r) => r.trade_type === 'buy');
  const rb = buys.filter((r) => isRouter(r.trader_address));
  const rbBnb = rb.reduce((s, r) => s + Number(r.bnb_amount), 0);
  const bBnb = buys.reduce((s, r) => s + Number(r.bnb_amount), 0);
  // 非 router 的 trader 形状 top2（识别平台级合约入口）
  const tCnt = {};
  for (const r of buys) {
    const t = (r.trader_address || '').toLowerCase();
    if (isRouter(t)) continue;
    const k = t.slice(0, 10);
    tCnt[k] = (tCnt[k] || 0) + 1;
  }
  const tTop = Object.entries(tCnt).sort((x, y) => y[1] - x[1]).slice(0, 2)
    .map(([k, v]) => `${k}×${v}`).join(' ');
  out.push({
    id: c.caseId, sym: c.symbol, v: c.expect?.verdict, n, buyN: buys.length,
    rN: rb.length, rPctN: pct(rb.length, buys.length),
    rPctBnb: pct(rbBnb, bBnb), tTop,
  });
  process.stdout.write(`\r${out.length}/${cases.length}`);
}
console.log('\n');
// 分组汇总
const groups = {};
for (const r of out) (groups[r.v] ??= []).push(r);
for (const [v, rs] of Object.entries(groups).sort()) {
  const ok = rs.filter((r) => r.rPctN !== null);
  const ds = ok.map((r) => r.rPctN).sort((a, b) => a - b);
  const q = (p) => ds[Math.min(ds.length - 1, Math.floor(p * ds.length))];
  console.log(`== ${v}: ${rs.length} 票（可评 ${ok.length}）笔数占比 min/25/50/75/max = ${ds[0]} / ${q(0.25)} / ${q(0.5)} / ${q(0.75)} / ${ds[ds.length - 1]}`);
  const low = ok.filter((r) => r.rPctN < 10).sort((a, b) => a.rPctN - b.rPctN);
  console.log(`   <10% 共 ${low.length} 票: ${low.map((r) => `${r.id}:${r.rPctN}%(${r.buyN}笔)`).join(' ')}`);
}
console.log('\n== 明细（全部按占比升序）==');
for (const r of out.slice().sort((a, b) => (a.rPctN ?? 999) - (b.rPctN ?? 999))) {
  console.log(`${String(r.rPctN ?? 'ERR').padStart(5)}% ${String(r.rPctBnb ?? '-').padStart(5)}% b${String(r.buyN).padStart(3)} ${r.id.padEnd(6)} ${(r.sym ?? '').padEnd(12).slice(0, 12)} ${(r.v ?? '').padEnd(12)} ${r.tTop ?? r.err ?? ''}`);
}
// 跨票 trader 形状聚合（找平台级合约）
const cross = {};
for (const r of out) if (r.tTop) for (const m of r.tTop.matchAll(/^(0x[0-9a-f]{8})×(\d+)$/gm)) cross[m[1]] = (cross[m[1]] || 0) + Number(m[2]);
console.log('\n非 router trader 前缀跨票聚合 top8:', Object.entries(cross).sort((a, b) => b[1] - a[1]).slice(0, 8));
