/**
 * v72 edbd5b38 信号票收录数据收集（182 跑，一次性不进 git）
 * 输入 /tmp/v72-tokens.json（94 票）→ 输出 /tmp/v72-collect.json
 * 1) cheat_detection 全表瘦身列 → 每票生产首析行（created_at 最早；qv 记录）
 * 2) wss_events token_create → platform/symbol/createAt
 * 3) 无首析行票：[create-7d, firstSignalAt] ticks 窗拉 → 行数=信号时刻锚
 *    （block_time≤信号 created_at 行数，宁多勿少近似，cheat --experiment 同款口径）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const sb = () => require_('../src/services/dbManager').dbManager.getClient();

const TOKENS = JSON.parse(readFileSync('/tmp/v72-tokens.json', 'utf8'));
const TICK_COLS = 'id,block_time';

// 列名先验
{
  const { data, error } = await sb().from('cheat_detection').select('*').limit(1);
  if (error) throw new Error('cheat_detection 探列失败: ' + error.message);
  console.log('cheat_detection 列:', Object.keys(data[0] || {}).join(','));
}

// 1) cheat_detection 全表瘦身（分页拉全量，内存 filter；grade 在 snapshot_digest JSON）
async function loadCheatFirst() {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb().from('cheat_detection')
      .select('id,token_address,platform,question_version,anchor_tick_count,analyzed_at,snapshot_digest->grade,snapshot_digest->gradeReasons')
      .order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error('cheat_detection 拉取失败: ' + error.message);
    rows.push(...data.map((r) => ({ ...r, grade: r.grade ?? null, gradeReasons: r.gradeReasons ?? null })));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log('cheat_detection 全表行数:', rows.length);
  const byToken = new Map();
  for (const r of rows) {
    const t = (r.token_address || '').toLowerCase();
    if (!byToken.has(t)) byToken.set(t, []);
    byToken.get(t).push(r);
  }
  return byToken;
}

// 2) token meta（run.mjs loadTokenMeta 同款）
async function loadTokenMeta(token) {
  const { data, error } = await sb().from('wss_events')
    .select('platform,payload,block_time')
    .eq('kind', 'token_create')
    .eq('token_address', token)
    .order('id', { ascending: true })
    .limit(5);
  if (error) throw new Error('wss_events 查询失败: ' + error.message);
  const hit = (data ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  const createdAt = p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null);
  return { platform: hit ? hit.platform : null, createdAt, symbol: p.symbol || null };
}

// 3) 信号时刻锚：[start, firstSignalAt] 行数
async function anchorCountAt(token, startIso, endIso) {
  let n = 0, anchorId = 0;
  for (let page = 0; page < 15; page++) {
    const { data, error } = await sb().from('wss_price_ticks')
      .select(TICK_COLS)
      .eq('token_address', token)
      .gte('block_time', startIso)
      .lte('block_time', endIso)
      .gt('id', anchorId)
      .order('id', { ascending: true })
      .limit(1000);
    if (error) throw new Error(`ticks 查询失败(${token}): ${error.message}`);
    n += data.length;
    if (data.length < 1000) return { count: n, capped: false };
    anchorId = data[data.length - 1].id;
  }
  return { count: n, capped: true };
}

const cheatByToken = await loadCheatFirst();
const out = [];
let i = 0;
for (const t of TOKENS) {
  i++;
  const addr = t.addr.toLowerCase();
  const meta = await loadTokenMeta(addr);
  const rows = (cheatByToken.get(addr) || []).sort((a, b) => a.analyzed_at < b.analyzed_at ? -1 : 1);
  const first = rows[0] || null;
  let anchorTickCount = null, anchorBasis = null;
  if (first) {
    anchorTickCount = first.anchor_tick_count;
    anchorBasis = `cheat_detection 首析行 ${first.analyzed_at} qv=${first.question_version}`;
  } else {
    const startIso = meta.createdAt
      ? new Date(new Date(meta.createdAt).getTime() - 7 * 864e5).toISOString()
      : new Date(new Date(t.firstSignalAt).getTime() - 2 * 36e5).toISOString();
    const r = await anchorCountAt(addr, startIso, t.firstSignalAt);
    anchorTickCount = r.count;
    anchorBasis = `信号时刻锚（无生产首析行）${r.capped ? ' [窗拉 capped]' : ''}${meta.createdAt ? '' : ' [create 缺失兜底窗]'}`;
  }
  out.push({
    addr, symbol: t.symbol || meta.symbol || '?', platform: meta.platform,
    signals: t.signals, firstSignalAt: t.firstSignalAt,
    cheatRows: rows.length,
    cheatFirstGrade: first ? first.grade : null,
    cheatFirstAt: first ? first.analyzed_at : null,
    cheatFirstQv: first ? first.question_version : null,
    cheatFirstReasons: first ? (first.gradeReasons || null) : null,
    anchorTickCount, anchorBasis,
  });
  if (i % 10 === 0) console.log(`… ${i}/${TOKENS.length}`);
}

writeFileSync('/tmp/v72-collect.json', JSON.stringify(out, null, 1));
const g = {};
for (const r of out) g[r.cheatFirstGrade || 'no-row'] = (g[r.cheatFirstGrade || 'no-row'] || 0) + 1;
console.log('完成', out.length, '票 | 生产首判分布:', JSON.stringify(g));
console.log('platform 分布:', JSON.stringify(out.reduce((a, r) => { a[r.platform || '?'] = (a[r.platform || '?'] || 0) + 1; return a; }, {})));
