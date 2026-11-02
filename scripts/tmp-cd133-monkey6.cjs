const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
async function main() {
  const client = dbManager.getClient();
  // 1) 全表最新 5 行看 created_at 形状与真实最后时间
  const latest = await client.from('cheat_detection').select('token_address, created_at, status, verdict, snapshot_digest')
    .order('created_at', { ascending: false }).limit(5);
  console.log('== cheat_detection 最新 5 行:');
  for (const r of latest.data || []) {
    const d = r.snapshot_digest || {};
    console.log('  ' + r.token_address.slice(0, 10) + ' created_at=' + r.created_at + ' status=' + r.status + ' grade=' + d.grade + ' v=' + d.gradeVersion);
  }
  // 2) 全表行数 + 最大最小 created_at
  const all = await client.from('cheat_detection').select('created_at').order('created_at', { ascending: false }).limit(2000);
  const rows = all.data || [];
  console.log('全表行数(≤2000): ' + rows.length + '；最新=' + (rows[0] || {}).created_at + '；最旧=' + (rows[rows.length - 1] || {}).created_at);
  // 3) 按小时分布（UTC 原值）
  const byHour = {};
  for (const r of rows) { const h = String(r.created_at).slice(0, 13); byHour[h] = (byHour[h] || 0) + 1; }
  const hours = Object.keys(byHour).sort();
  for (const h of hours) console.log('  ' + h + ' -> ' + byHour[h] + ' 行');
  // 4) v67 07:47 后 signals 行数（买点是否存在）
  const s = await client.from('strategy_signals').select('id, created_at, signal_type')
    .eq('experiment_id', 'e3d00085-9aa9-4dd2-8422-c30c14a9a576')
    .gte('created_at', '2026-11-02T07:47:41+00:00').order('created_at', { ascending: true }).limit(500);
  console.log('\n== v67 07:47 后 strategy_signals: ' + (s.data || []).length + ' 行');
  for (const r of (s.data || []).slice(0, 8)) console.log('  ' + r.created_at + ' ' + r.signal_type);
  if ((s.data || []).length) { const lastS = s.data[s.data.length - 1]; console.log('  …末行 ' + lastS.created_at + ' ' + lastS.signal_type); }
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
