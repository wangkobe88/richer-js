#!/usr/bin/env node
/**
 * _test_narrative_repo_save_thin — 3b（2026-10-13 叙事提速第二批）dbSave.final 瘦身
 *
 * 零 DB 零网络：NarrativeRepository.getSupabase 静态覆写为假客户端（链式打桩），
 * 断言 save 的查询形状与合并语义：
 *   A 段：{existing} 非 null 跳过 pre-select；无参/null 仍现查（x-0 并发新插行
 *         防线——null 假设会把并发写入的 gmgn_info/未产阶段列清掉）
 *   B 段：upsert 回读瘦列清单（SAVE_RETURN_COLS 闭集，肥列一律不回读）
 *   C 段：existing 快照合并语义（gmgn_info ?? existing / 未产阶段带旧值 / __clear）
 *   D 段：源码口径——save 签名/跳查分支/瘦列常量/回读接线/NarrativeAnalyzer 终存调用点
 */

const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

// ── 假 supabase 客户端（链式打桩，记录调用序）──
function makeFakeSupabase({ existingRow = null, thinRow = null } = {}) {
  const calls = [];
  const client = {
    from(table) {
      return {
        // pre-select 路径：select('*').eq().maybeSingle()
        select(arg) {
          const entry = { kind: 'preselect', table, selectArg: arg ?? null };
          calls.push(entry);
          return {
            eq(col, val) {
              entry.eq = { col, val };
              return {
                maybeSingle: async () => ({ data: existingRow, error: null }),
              };
            },
          };
        },
        // upsert 路径：upsert(record, opts).select(cols).single()
        upsert(record, opts) {
          const entry = { kind: 'upsert', table, record, onConflict: opts?.onConflict };
          calls.push(entry);
          return {
            select(arg) {
              entry.returnCols = arg ?? null;
              return {
                single: async () => ({ data: thinRow, error: null }),
              };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

async function main() {
  const { NarrativeRepository } = await import(
    path.join(__dirname, '../src/narrative/db/NarrativeRepository.mjs')
  );
  const realGetSupabase = NarrativeRepository.getSupabase;

  const baseResult = {
    token_address: '0xABCdef0000000000000000000000000000001234',
    token_symbol: 'TEST',
    analyzed_at: '2026-10-13T00:00:00Z',
    is_valid: true,
    prompt_version: 'J1.29',
    stage1_result: { rating: 'pass', pass: true, score: 60 },
    // gmgn_info 刻意不携带（undefined → 合并保旧行）
  };
  const existingRow = {
    token_address: '0xabcdef0000000000000000000000000000001234',
    gmgn_info: { risk: { issuerTokenCount: 3 } },
    stage2_result: { rating: 'pass', pass: true, score: 55 },
    stage3_result: null,
    is_valid: false,
  };
  const thinRow = { id: 7, token_address: 'x', stage_final_result: { rating: 'high' } };

  // ── A1：existing 非 null → 零 pre-select，首查询即 upsert ──
  console.log('[A1] existing 非 null 跳过 pre-select');
  {
    const { client, calls } = makeFakeSupabase({ existingRow, thinRow });
    NarrativeRepository.getSupabase = () => client;
    const ret = await NarrativeRepository.save({ ...baseResult }, { existing: existingRow });
    NarrativeRepository.getSupabase = realGetSupabase;
    assert(calls.length === 1, `恰 1 次查询（实际 ${calls.length}）`);
    assert(calls[0].kind === 'upsert', '首查询即 upsert（无 pre-select）');
    assert(ret === thinRow, '返回值 = 瘦行透传');
  }

  // ── A2：不传 options → pre-select 照旧（select('*') 先行）──
  console.log('[A2] 无 options 时 pre-select 照旧');
  {
    const { client, calls } = makeFakeSupabase({ existingRow, thinRow });
    NarrativeRepository.getSupabase = () => client;
    await NarrativeRepository.save({ ...baseResult });
    NarrativeRepository.getSupabase = realGetSupabase;
    assert(calls.length === 2, `恰 2 次查询（实际 ${calls.length}）`);
    assert(calls[0].kind === 'preselect' && calls[0].selectArg === '*', "pre-select 仍为 select('*')");
    assert(calls[0].eq && calls[0].eq.col === 'token_address', 'pre-select eq token_address');
    assert(calls[1].kind === 'upsert', '第二次为 upsert');
  }

  // ── A3：existing 显式 null → 仍现查（x-0 并发新插行防线）──
  console.log('[A3] existing=null 仍现查');
  {
    const { client, calls } = makeFakeSupabase({ existingRow: null, thinRow });
    NarrativeRepository.getSupabase = () => client;
    await NarrativeRepository.save({ ...baseResult }, { existing: null });
    NarrativeRepository.getSupabase = realGetSupabase;
    assert(calls.length === 2 && calls[0].kind === 'preselect',
      `null 快照不跳查（实际 ${calls.map(c => c.kind).join('→')}）`);
  }

  // ── B1：upsert 回读瘦列清单闭集（锁 SAVE_RETURN_COLS 防漂移）──
  console.log('[B1] upsert 回读瘦列清单');
  {
    const expectedCols = [
      'id', 'token_address', 'token_symbol', 'raw_api_data', 'analyzed_at',
      'is_valid', 'prompt_version', 'pre_check_result', 'prestage_result',
      'stage1_result', 'stage2_result', 'stage3_result', 'stage_final_result',
    ].join(',');
    const { client, calls } = makeFakeSupabase({ existingRow, thinRow });
    NarrativeRepository.getSupabase = () => client;
    await NarrativeRepository.save({ ...baseResult }, { existing: existingRow });
    NarrativeRepository.getSupabase = realGetSupabase;
    const cols = calls[0].returnCols;
    assert(cols === expectedCols, `回读列 = 瘦列清单（实际 ${cols}）`);
    const fatCols = ['stage1_prompt', 'stage1_raw_output', 'stage2_prompt', 'stage3_raw_output',
      'prestage_prompt', 'twitter_info', 'classified_urls', 'extracted_info',
      'url_extraction_result', 'data_fetch_results', 'gmgn_info', 'token_category',
      'analysis_stage', 'prompt_type', 'platform', 'blockchain'];
    const leaked = fatCols.filter(c => cols.split(',').includes(c));
    assert(leaked.length === 0, `肥列零回读（泄漏：${leaked.join(',') || '无'}）`);
  }

  // ── C1：existing 快照合并语义 ──
  console.log('[C1] 快照合并语义');
  {
    const { client, calls } = makeFakeSupabase({ existingRow, thinRow });
    NarrativeRepository.getSupabase = () => client;
    await NarrativeRepository.save({ ...baseResult }, { existing: existingRow });
    NarrativeRepository.getSupabase = realGetSupabase;
    const rec = calls[0].record;
    assert(rec.stage1_result === baseResult.stage1_result, '本次产物直写');
    assert(rec.stage2_result === existingRow.stage2_result, '未产阶段带 existing 旧值');
    assert(rec.gmgn_info === existingRow.gmgn_info, 'gmgn_info undefined → 保旧行（x-0）');
    assert(rec.is_valid === true, 'is_valid 用新值 true');
    assert(rec.onConflict !== undefined || calls[0].onConflict === 'token_address', 'onConflict token_address');
  }

  // ── C2：__clear 标记（穿透清库路径）在 existing 快照下仍生效 ──
  console.log('[C2] __clear 语义保持');
  {
    const { client, calls } = makeFakeSupabase({ existingRow, thinRow });
    NarrativeRepository.getSupabase = () => client;
    await NarrativeRepository.save({
      token_address: baseResult.token_address,
      stage2_result: { __clear: true },
    }, { existing: existingRow });
    NarrativeRepository.getSupabase = realGetSupabase;
    const rec = calls[0].record;
    assert(rec.stage2_result === null && rec.stage2_prompt === null && rec.stage2_raw_output === null,
      '__clear 三字段全 null');
    assert(rec.stage3_result === null, '既有 null 阶段保持 null');
  }

  // ── C3：C146 token_category 终态清空语义（重跑数据必须反映本次判定）──
  console.log('[C3] token_category 终态清空/保留');
  {
    // 1) 终态无分类 + clearTokenCategory → 显式 null（覆盖旧值）
    const clearRun = makeFakeSupabase({ existingRow, thinRow });
    NarrativeRepository.getSupabase = () => clearRun.client;
    await NarrativeRepository.save({ ...baseResult }, { existing: existingRow, clearTokenCategory: true });
    NarrativeRepository.getSupabase = realGetSupabase;
    assert(clearRun.calls[0].record.token_category === null,
      '终态无分类 → token_category=null（重跑覆盖旧分类）');

    // 2) 无分类 + 无标记（中间 save）→ 不写键，保留旧值
    const keepRun = makeFakeSupabase({ existingRow, thinRow });
    NarrativeRepository.getSupabase = () => keepRun.client;
    await NarrativeRepository.save({ ...baseResult }, { existing: existingRow });
    NarrativeRepository.getSupabase = realGetSupabase;
    assert(!('token_category' in keepRun.calls[0].record),
      '中间 save 无标记 → 不触碰 token_category（保旧值）');

    // 3) 有新分类 → 直写新值（clear 标记不遮蔽非空分类）
    const setRun = makeFakeSupabase({ existingRow, thinRow });
    NarrativeRepository.getSupabase = () => setRun.client;
    await NarrativeRepository.save({ ...baseResult, token_category: 'event:E' },
      { existing: existingRow, clearTokenCategory: true });
    NarrativeRepository.getSupabase = realGetSupabase;
    assert(setRun.calls[0].record.token_category === 'event:E',
      '本次有分类 → 直写新分类（不被 clear 标记覆盖）');
  }

  // ── D 段：源码口径（防线锁定）──
  console.log('[D] 源码口径');
  {
    const repoSrc = fs.readFileSync(
      path.join(__dirname, '../src/narrative/db/NarrativeRepository.mjs'), 'utf8');
    assert(repoSrc.includes('static async save(result, { existing: existingHint, clearTokenCategory = false } = {})'),
      'save 签名带第二参 { existing, clearTokenCategory }');
    assert(repoSrc.includes('else if (clearTokenCategory)'),
      'C146：终态无分类显式清空分支存在');
    assert(repoSrc.includes('let existing = existingHint || null;'),
      '非 null 快照才复用（|| null 归一）');
    assert(repoSrc.includes('const { data, error: existError } = await this.getSupabase()'),
      'pre-select 走 this.getSupabase()（可打桩）');
    assert(repoSrc.includes('.select(SAVE_RETURN_COLS)'),
      'upsert 回读接 SAVE_RETURN_COLS 常量');
    assert(repoSrc.includes("const SAVE_RETURN_COLS = ["),
      'SAVE_RETURN_COLS 常量定义存在');
    // 瘦列常量源码逐列锁定（与 B1 运行时断言双保险）
    const constBlock = repoSrc.split('const SAVE_RETURN_COLS = [')[1]?.split('];')[0] || '';
    for (const col of ['id', 'token_address', 'token_symbol', 'raw_api_data', 'analyzed_at',
      'is_valid', 'prompt_version', 'pre_check_result', 'prestage_result',
      'stage1_result', 'stage2_result', 'stage3_result', 'stage_final_result']) {
      if (!constBlock.includes(`'${col}'`)) { assert(false, `SAVE_RETURN_COLS 含 '${col}'`); }
    }
    assert(true, 'SAVE_RETURN_COLS 源码 13 列齐');

    const anaSrc = fs.readFileSync(
      path.join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
    const finalBlock = anaSrc.split("timing.wrap('dbSave.final'")[1] || '';
    assert(finalBlock.includes('existing: cached'),
      'dbSave.final 调用点传 {existing: cached}');
    assert(finalBlock.includes('clearTokenCategory: !tokenCategory'),
      'C146：dbSave.final 无分类时传 clearTokenCategory（重跑覆盖旧分类）');
    // 中段 save 不传 existing（worker 语境保持现查，本批不动）
    const interBlocks = anaSrc.split("timing.wrap('dbSave.intermediate'").slice(1);
    assert(interBlocks.every(b => !b.split('}));')[0].includes('existing:')),
      'dbSave.intermediate 调用点不传 existing（刻意不动）');
    assert(interBlocks.every(b => !b.split('}));')[0].includes('clearTokenCategory')),
      'dbSave.intermediate 调用点不传 clearTokenCategory（中间保存保旧值）');
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试运行失败:', e);
  process.exit(1);
});
