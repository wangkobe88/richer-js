// Q6 查询留档（只查不删，用户 2026-11-13「先不需要改系统代码」）：low-zone-stall-exit 库条目定位
// + Q4: kol 数据源查 0x609f2c91 是否收录
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const c = await dbManager.getClient();

// ── Q6：定位（只读）──
const { data: rows, error } = await c.from('strategy_library')
  .select('id,name,side,version,legs,created_at')
  .ilike('name', '%low-zone%');
if (error) throw new Error('query: ' + error.message);
console.log(`low-zone 命中 ${rows.length} 条:`);
for (const r of rows) {
  console.log(`  id=${r.id} name=${r.name} side=${r.side} v${r.version} created=${r.created_at}`);
  for (const l of (r.legs || [])) console.log(`    leg: ${JSON.stringify({ name: l.name, condition: l.condition, cards: l.cards, bypassDebounce: l.bypassDebounce })}`);
}

// ── Q4：kol 数据源查 0x609f2c91 ──
try {
  const kj = JSON.parse(fs.readFileSync('data/kol-study/kol-wallet-stats.json', 'utf8'));
  const list = kj.wallets || kj;
  console.log(`\nkol-wallet-stats 总数=${Array.isArray(list) ? list.length : typeof list}`);
  const hit = (Array.isArray(list) ? list : []).filter(w =>
    String(w.address || w.wallet || '').toLowerCase().includes('609f2c91'));
  console.log('0x609f2c91 命中:', JSON.stringify(hit, null, 1).slice(0, 800));
  if (!hit.length) console.log('（未收录）');
} catch (e) { console.log('kol 文件读取失败: ' + e.message); }
process.exit(0);
