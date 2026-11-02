// 侦察：近期叙事分析通过票分布（rating 桶 high/mid=2|3 按天计数，分页拉全）+ rounds 表结构样例（本地小结果只读）
const { dbManager } = require('../src/services/dbManager.js');

const PAGE = 1000;
const DAYS = Number(process.argv[2] || 8);

(async () => {
  const db = dbManager.getClient();
  const cutoff = new Date(Date.now() - DAYS * 86400000).toISOString();

  const rows = [];
  for (;;) {
    const { data, error } = await db
      .from('token_narrative')
      .select('token_address,token_symbol,analyzed_at,final_result')
      .gte('analyzed_at', cutoff)
      .order('analyzed_at', { ascending: true })
      .range(rows.length, rows.length + PAGE - 1);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const byDay = new Map();
  const byRating = new Map();
  const pass = [];
  for (const row of rows) {
    const r = row.final_result?.rating; // 字符串桶：high=3 mid=2 low=1（C233）
    const day = row.analyzed_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
    byRating.set(String(r), (byRating.get(String(r)) || 0) + 1);
    if (r === 'high' || r === 'mid' || r === 2 || r === 3) pass.push(row);
  }
  console.log(`近${DAYS}天 analyzed 行数:`, rows.length);
  console.log('按天:', [...byDay.entries()].map(([d, n]) => `${d}:${n}`).join(' '));
  console.log('按 rating 桶:', [...byRating.entries()].map(([k, n]) => `${k}:${n}`).join(' '));
  console.log('通过票(high+mid) 总数:', pass.length);

  const addr = pass[pass.length - 1]?.token_address;
  if (addr) {
    const { data: rounds, error: e2 } = await db
      .from('narrative_analysis_rounds')
      .select('*')
      .eq('token_address', addr)
      .order('created_at', { ascending: true })
      .limit(3);
    if (e2) console.log('rounds error:', e2.message);
    else if (rounds.length) {
      console.log('\nrounds 字段:', Object.keys(rounds[0]).join(','));
      for (const r of rounds) console.log(JSON.stringify({ ...r, details: undefined }).slice(0, 260));
    }
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
