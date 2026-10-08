#!/usr/bin/env node
// ============================================================================
// 一次性实测（2026-10-08 锚定探针修复配套，跑完即删）：真实 6f92e2f9 地址集 ×
// 真实缓存锚跑锚定探针形状计时。护栏：连续 5 批 >3s 提前中止（避免全批 8s 超时
// 拖满 24 分钟）。dbManager service key（wss_price_ticks anon 被 RLS 过滤）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const SRC = '6f92e2f9-1b21-4ea6-b6a1-2e8dc70090e3';
const ANCHORS = { fourmeme: 3582799, flap: 4998366 };   // 182 缓存 meta 实测值

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const supabase = dbManager.getClient();

  // token 全集（回测引擎同口径：experiment_tokens 源实验全集）
  const addrs = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from('experiment_tokens')
      .select('token_address').eq('experiment_id', SRC)
      .range(from, from + 999);
    if (error) throw new Error('experiment_tokens: ' + error.message);
    if (!data || data.length === 0) break;
    for (const r of data) addrs.push(r.token_address);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`token 全集: ${addrs.length}`);

  for (const platform of ['fourmeme', 'flap']) {
    const anchor = ANCHORS[platform];
    const t0 = Date.now();
    const batchTimes = [];
    let maxId = null, slowStreak = 0, aborted = false;
    for (let ci = 0; ci < addrs.length; ci += 100) {
      const chunk = addrs.slice(ci, ci + 100);
      const b0 = Date.now();
      const { data, error } = await supabase.from('wss_price_ticks')
        .select('id').in('token_address', chunk).eq('platform', platform)
        .gt('id', anchor)
        .order('id', { ascending: false }).limit(1);
      const dt = Date.now() - b0;
      batchTimes.push(dt);
      if (error) { console.log(`  批 ${ci} ERR: ${error.message}`); }
      if (data && data.length > 0) {
        const id = Number(data[0].id);
        if (maxId === null || id > maxId) maxId = id;
      }
      if (dt > 3000) { slowStreak++; if (slowStreak >= 5) { aborted = true; break; } }
      else slowStreak = 0;
      if ((ci / 100) % 50 === 49) console.log(`  … ${ci + chunk.length}/${addrs.length} 批, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
    const sorted = batchTimes.slice().sort((a, b) => b - a);
    console.log(`\n[${platform}] anchor=${anchor} 批数=${batchTimes.length}${aborted ? '（⚠️ 连续慢批中止）' : ''}`);
    console.log(`  总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s | 最慢5批 ${sorted.slice(0, 5).join('ms, ')}ms | 均值 ${(batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length).toFixed(0)}ms`);
    console.log(`  探针结果 maxId=${maxId}${maxId === null ? '（增量区间无行 → FRESH 预期）' : ''}`);

    // 锚行 PK 核验计时
    const p0 = Date.now();
    const { data: pk, error: pkErr } = await supabase.from('wss_price_ticks')
      .select('id').eq('id', anchor).limit(1);
    console.log(`  锚行 PK 核验: ${Date.now() - p0}ms → ${pkErr ? 'ERR ' + pkErr.message : (pk && pk.length > 0 ? '存在' : '不存在')}`);
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
