// T137 决定性验证：v3 roster 下 28ad/来财/ba5e fire 时刻 fB 重算 + famous 行地址 v2/v3 对照
import { readFileSync } from 'node:fs';
import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const rosterV3 = new Set(JSON.parse(readFileSync('/home/ubuntu/richer-js/config/rosters/famous-copy-wallets.json', 'utf8')).wallets.map(w => w.toLowerCase()));

// v2 38 址（f935afd1 之前的形状——从 git 拿）
import { execSync } from 'node:child_process';
const v2raw = execSync('git show f935afd1~1:config/rosters/famous-copy-wallets.json', { cwd: '/home/ubuntu/richer-js', encoding: 'utf8' });
const rosterV2 = new Set(JSON.parse(v2raw).wallets.map(w => w.toLowerCase()));
console.log(`roster v3=${rosterV3.size} 址 / v2=${rosterV2.size} 址`);

const CASES = [
  ['28ad', '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', ['07:16:57', '07:17:30', '07:18:24']],
  ['来财', '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', ['12:32:18', '12:33:42']],
  ['ba5e', '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', ['07:41:10', '07:42:34']],
];
for (const [tag, addr, fireTss] of CASES) {
  const { data: ticks, error } = await c.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,sender_address,trader_address,price_outlier')
    .eq('token_address', addr).gte('block_time', '2026-11-05T00:00:00Z').lt('block_time', '2026-11-05T14:00:00Z')
    .order('block_time', { ascending: true }).limit(5000);
  if (error) throw new Error(error.message);
  // famous 行清单（v2∪v3）
  const seen = new Map();
  for (const t of ticks) {
    const w = ((t.sender_address || t.trader_address) || '').toLowerCase();
    if (!rosterV2.has(w) && !rosterV3.has(w)) continue;
    const k = w;
    if (!seen.has(k)) seen.set(k, { v3: rosterV3.has(w), buys: [], sells: [] });
    const b = Number(t.bnb_amount);
    if (t.trade_type === 'buy') seen.get(k).buys.push({ ts: t.block_time, bnb: b });
    else seen.get(k).sells.push({ ts: t.block_time, bnb: b });
  }
  console.log(`\n=== ${tag} ${addr.slice(0, 10)} famous 钱包（v2∪v3=${seen.size}）===`);
  for (const [w, info] of seen) {
    const totB = info.buys.reduce((s, x) => s + x.bnb, 0);
    const totS = info.sells.reduce((s, x) => s + x.bnb, 0);
    console.log(`  ${w.slice(0, 10)} v3=${info.v3 ? 'IN ' : 'OUT'} buys=${info.buys.length}(${totB.toFixed(2)}B) sells=${info.sells.length}(${totS.toFixed(2)}B)`);
  }
  // fire 时刻 fB（v3 口径=FA 实跑；v2 口径=反事实可能形状）
  for (const fts of fireTss) {
    const fireMs = Date.parse(`2026-11-05T${fts}Z`);
    let lastV3 = null, lastV2 = null, lastAny = null;
    for (const t of ticks) {
      const w = ((t.sender_address || t.trader_address) || '').toLowerCase();
      if (t.trade_type !== 'buy' || !(Number(t.bnb_amount) >= 0.1)) continue;
      const ts = Date.parse(t.block_time);
      if (ts > fireMs) continue;
      if (rosterV3.has(w)) lastV3 = ts;
      if (rosterV2.has(w)) lastV2 = ts;
      if (rosterV3.has(w) || rosterV2.has(w)) lastAny = ts;
    }
    const f = (x) => x == null ? 'null' : ((fireMs - x) / 1000).toFixed(0) + 's';
    console.log(`  fire ${fts}: fB(v3)=${f(lastV3)} fB(v2)=${f(lastV2)} fB(union)=${f(lastAny)}  → HOLD(v3)=${lastV3 != null && fireMs - lastV3 <= 120000}`);
  }
}
process.exit(0);
