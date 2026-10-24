#!/usr/bin/env node
// ============================================================================
// token_narrative 投影列回填（2026-10-24 B2 配套；★只在 182 跑——本地 VPN 必超时）
//
// 历史行新投影列恒 null（默认不回填，`WHERE final_rating IS NOT NULL` 分代）。
// 本脚本可选回填：id 键集分页拉各信封列 → 复用 NarrativeRepository.projectColumns
// （与 save 落库同一纯函数，单一真相源）→ 批量 UPDATE，`WHERE final_rating IS NULL`
// 幂等（重跑只补新行/漏行）。
//
// 用法（182）：node scripts/narrative/backfill-projection-columns.mjs [--commit]
//   默认 dry-run 只打印统计；--commit 才落库。
// 注意：RENAME DDL 执行后才可跑（列名=新名）；索引在回填之后建最优。
// ============================================================================

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../config/.env') });

// dbManager 自身的 dotenv 按 CWD 解析不可依赖——必须先于 import 后的 getSupabase()
const { dbManager } = await import(resolve(__dirname, '../../src/services/dbManager.js'));
const { projectColumns } = await import(resolve(__dirname, '../../src/narrative/db/NarrativeRepository.mjs'));

const COMMIT = process.argv.includes('--commit');
const PAGE = 500;

// 信封列集（projectColumns 输入所需；不拉肥 IO 列）
const ENVELOPE_COLS = [
  'id', 'token_address',
  'pre_check_result', 'prestage_result',
  'event_result', 'event_score_result', 'relation_result', 'final_result',
].join(',');

const PROJ_COLS = ['final_rating', 'block_reason', 'block_stage', 'analysis_path',
  'total_score', 'event_score', 'relevance_score', 'quality_score', 'event_category',
  'jev_version', 'prestage_version'];

async function main() {
  const client = dbManager.getSupabase();
  let lastId = null;
  let scanned = 0, pending = 0, updated = 0;
  const updates = [];

  while (true) {
    let q = client.from('token_narrative')
      .select('id,final_rating,' + ENVELOPE_COLS)
      .is('final_rating', null)  // 幂等：只补未投影行
      .order('id', { ascending: true })
      .limit(PAGE);
    if (lastId != null) q = q.gt('id', lastId);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    scanned += data.length;
    lastId = data[data.length - 1].id;

    for (const row of data) {
      pending++;
      const proj = projectColumns(row);
      const patch = {};
      for (const c of PROJ_COLS) patch[c] = proj[c];
      updates.push({ id: row.id, patch });
    }
    if (data.length < PAGE) break;
  }

  console.log(`扫描未投影行：${pending}（页计 ${scanned}）`);

  if (!COMMIT) {
    const sample = updates.slice(0, 3).map(u => `  id=${u.id} → ${JSON.stringify(u.patch)}`).join('\n');
    console.log(`[dry-run] 样例：\n${sample}\n加 --commit 落库`);
    return;
  }

  // 批量 UPDATE（id 等值逐行——日级量 4 万，批量 PATCH .in 走 PostgREST 更快但
  // 更新语义须逐行 patch 不同值，in() 不适用；500 行/事务窗口足够）
  for (const u of updates) {
    const { error } = await client.from('token_narrative').update(u.patch).eq('id', u.id);
    if (error) throw error;
    updated++;
    if (updated % 2000 === 0) console.log(`  ...${updated}/${updates.length}`);
  }
  console.log(`回填完成：${updated} 行`);
}

main().catch((e) => { console.error('回填失败:', e); process.exit(1); });
