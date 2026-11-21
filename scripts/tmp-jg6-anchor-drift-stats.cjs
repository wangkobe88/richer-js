/**
 * 一次性统计（2026-11-21，JG6 token_meta 修复配套）：2489 票「出生锚偏差」分布
 * =case_ticks 首 tick 时刻 − wss_events token_create block_time。
 *
 * 背景：token_meta 旧形状导致 BacktestEngine 装载 createdAtSec=null → _registerToken
 * 回落首 tick 时间当出生锚（契约口径=真创建时间）。已跑 8 实验（bt-v166b~v173）的
 * tokenAgeSec 系统性偏小 → tokenAgeSec>=15 抢速门（全腿）及 t0 臂定位受影响。
 * 本脚本量化偏差面，供「已跑对拍是否重跑」裁定。182 跑（红线 #9）。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COLLECTION_ID = '6fd0372f-48eb-494d-890b-5fa652127609';
const CONCURRENCY = 16;

async function main() {
  const c = dbManager.getClient();

  // 1) 成员：真创建时间（迁移后 token_meta.blockTimeIso）
  const { count: mCount } = await c.from('case_collection_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('collection_id', COLLECTION_ID);
  const members = [];
  for (let from = 0; from < mCount; from += 500) {
    const { data: page } = await c.from('case_collection_tokens')
      .select('token_address, token_meta')
      .eq('collection_id', COLLECTION_ID)
      .order('id', { ascending: true })
      .range(from, from + 499);
    if (!page || !page.length) break;
    members.push(...page);
    if (page.length < 500) break;
  }
  console.log(`成员: ${members.length}`);

  // 2) 并发查每票首 tick（case_ticks 按 token 等值 + block_time 升序 limit 1）
  const queue = members.map(m => ({
    addr: m.token_address,
    created: m.token_meta && m.token_meta.blockTimeIso ? new Date(m.token_meta.blockTimeIso).getTime() : null,
  }));
  const diffs = [];
  const noCreated = [];
  const noTick = [];
  async function worker() {
    while (queue.length > 0) {
      const t = queue.shift();
      if (!t) break;
      if (t.created == null) { noCreated.push(t.addr); continue; }
      const { data: page, error } = await c.from('case_ticks')
        .select('block_time')
        .eq('collection_id', COLLECTION_ID)
        .eq('token_address', t.addr)
        .order('block_time', { ascending: true })
        .limit(1);
      if (error) throw new Error(`case_ticks ${t.addr}: ${error.message}`);
      if (!page || !page.length) { noTick.push(t.addr); continue; }
      diffs.push((new Date(page[0].block_time).getTime() - t.created) / 1000);
      if (diffs.length % 500 === 0) console.log(`  …${diffs.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  diffs.sort((a, b) => a - b);
  const q = p => diffs.length ? diffs[Math.min(diffs.length - 1, Math.floor(diffs.length * p))] : null;
  const neg = diffs.filter(d => d < -1).length;
  console.log(`=== 偏差（首tick − 创建）秒，n=${diffs.length} ===`);
  console.log(`min=${diffs[0]} p5=${q(0.05)} p25=${q(0.25)} p50=${q(0.50)} p75=${q(0.75)} p95=${q(0.95)} max=${diffs[diffs.length - 1]}`);
  console.log(`>0s: ${diffs.filter(d => d > 0.5).length}；>15s: ${diffs.filter(d => d > 15).length}；>60s: ${diffs.filter(d => d > 60).length}；<-1s(乱序): ${neg}`);
  console.log(`无创建时间(迁移仍缺): ${noCreated.length}；无 tick: ${noTick.length}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
