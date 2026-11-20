// 波窗 crew vs 卖后买家：承接是否迟到 2~5s
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xe9e82d1fa74283991dec5543453373ec836b7777';
async function main() {
  const sb = dbManager.getClient();
  const { data: rows } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,trader_address,sender_address,bnb_amount,price_bnb')
    .eq('token_address', TOKEN)
    .gte('block_time', '2026-10-19T17:19:50')
    .lte('block_time', '2026-10-19T17:21:30')
    .order('block_time');
  const wallet = r => (r.sender_address || r.trader_address || '').toLowerCase();
  // 波窗定位：fire=17:20:51 前 60s 最密 5s 窗（全 tick 口径）
  const FIRE = Date.parse('2026-10-19T17:20:51Z');
  const cand = (rows || []).map(r => ({ ...r, ms: Date.parse(r.block_time) })).filter(r => r.ms >= FIRE - 60000 && r.ms <= FIRE + 5000);
  let best = null;
  for (let i = 0; i < cand.length; i++) {
    let j = i;
    while (j < cand.length && cand[j].ms - cand[i].ms <= 5000) j++;
    if (best === null || j - i > best.n) best = { n: j - i, i, end: j - 1 };
  }
  const winStart = cand[best.i].ms, winEnd = cand[best.end].ms;
  const crew = new Set(); let crewBnb = 0;
  for (const r of cand) if (r.ms >= winStart && r.ms <= winEnd && r.trade_type === 'buy' && wallet(r)) { crew.add(wallet(r)); crewBnb += r.bnb_amount; }
  console.log(`波窗: ${new Date(winStart).toISOString()} ~ ${new Date(winEnd).toISOString()} | crew=${crew.size} 钱包 | crewBnb=${crewBnb.toFixed(4)}`);
  // 承接窗 [fire, fire+15s] 与卖后 [fire+15s, +30s]
  const w1 = [], after = [];
  for (const r of rows || []) {
    if (r.trade_type !== 'buy') continue;
    const ms = Date.parse(r.block_time); const w = wallet(r);
    if (ms < FIRE) continue;
    const row = { t: r.block_time.slice(17,23), w: w.slice(0, 10), bnb: +r.bnb_amount.toFixed(4), inCrew: crew.has(w) };
    if (ms < FIRE + 15000) w1.push(row); else if (ms <= FIRE + 30000) after.push(row);
  }
  console.log('\n承接窗 [fire, +15s] 买:');
  for (const r of w1) console.log(' ', r.t, r.w, r.bnb + 'B', r.inCrew ? 'CREW' : 'NEW');
  console.log('\n卖后 [+15s, +30s] 买（T189 观测不到的部分）:');
  for (const r of after) console.log(' ', r.t, r.w, r.bnb + 'B', r.inCrew ? 'CREW' : 'NEW');
  const w1New = w1.filter(r => !r.inCrew).reduce((s, r) => s + r.bnb, 0);
  const afterNew = after.filter(r => !r.inCrew).reduce((s, r) => s + r.bnb, 0);
  console.log(`\n结论: 批1承接(非crew)=${w1New.toFixed(4)}B < 0.1 → 卖 | 若窗到 +30s: 非crew承接=${afterNew.toFixed(4)}B`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
