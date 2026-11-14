// btv111 复审材料补充：per point 合并生产 BP anchors.currentVsLaunchPct → /tmp/btv111-review.json 的 prodCurVs
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const set = JSON.parse(fs.readFileSync('scripts/buy-point/sets/btv111-trades.json', 'utf8'));
const c = await dbManager.getClient();

const buyIds = set.points.map(p => String(p.trade && p.trade.buyTradeId)).filter(Boolean);
const t2s = new Map();
for (let i = 0; i < buyIds.length; i += 100) {
  const { data, error } = await c.from('trades').select('id,signal_id').in('id', buyIds.slice(i, i + 100));
  if (error) throw new Error('trades: ' + error.message);
  for (const t of data || []) t2s.set(String(t.id), t.signal_id);
}
const sigIds = [...new Set([...t2s.values()].filter(Boolean))];
const prod = new Map();
for (let i = 0; i < sigIds.length; i += 50) {
  const { data, error } = await c.from('strategy_signals').select('id,metadata').in('id', sigIds.slice(i, i + 50));
  if (error) throw new Error('signals: ' + error.message);
  for (const s of data || []) prod.set(String(s.id), (s.metadata && s.metadata.buyPoint) || {});
}
const rows = JSON.parse(fs.readFileSync('/tmp/btv111-review.json', 'utf8'));
let miss = 0;
for (const p of set.points) {
  const row = rows.find(r => r.pointId === p.pointId);
  if (!row) continue;
  const sigId = t2s.get(String(p.trade && p.trade.buyTradeId));
  const bp = sigId ? prod.get(String(sigId)) : null;
  if (!bp) { miss++; continue; }
  row.prodCurVs = (bp.anchors && bp.anchors.currentVsLaunchPct) != null ? bp.anchors.currentVsLaunchPct : null;
}
fs.writeFileSync('/tmp/btv111-review.json', JSON.stringify(rows));
console.log(`merged prodCurVs, miss=${miss}`);
process.exit(0);
