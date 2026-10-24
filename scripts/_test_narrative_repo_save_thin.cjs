#!/usr/bin/env node
/**
 * _test_narrative_repo_save_thin — 3b（2026-10-13 叙事提速第二批）dbSave.final 瘦身
 * + 2026-10-24 叙事 DB 适配（列名重构 + B2 投影列）
 *
 * 零 DB 零网络：NarrativeRepository.getSupabase 静态覆写为假客户端（链式打桩），
 * 断言 save 的查询形状与合并语义：
 *   A 段：{existing} 非 null 跳过 pre-select；无参/null 仍现查（x-0 并发新插行
 *         防线——null 假设会把并发写入的 gmgn_info/未产阶段列清掉）
 *   B 段：upsert 回读瘦列清单（SAVE_RETURN_COLS 闭集=新列名；肥列与投影列一律不回读）
 *   C 段：existing 快照合并语义（gmgn_info ?? existing / 未产阶段带旧值 / __clear——
 *         event clear 联动清 jev IO、event_score clear 只清 result 不碰 IO）
 *   P 段：B2 投影列（projectColumns 挂 save 信封合并后 sanitize 前）：终态精确值 /
 *         precheck 终态清残留分 / mapper 拦截不落 category / intermediate 幂等 /
 *         版本三键三态合并 / 域外 category 宁缺勿炸
 *   D 段：源码口径——save 签名/跳查分支/瘦列常量/投影挂点/dbManager 切换/final 调用点
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
    analyzed_at: '2026-10-24T00:00:00Z',
    is_valid: true,
    prompt_version: 'J1.121',
    event_result: { rating: 'pass', pass: true, score: 60 },
    // gmgn_info 刻意不携带（undefined → 合并保旧行）
  };
  const existingRow = {
    token_address: '0xabcdef0000000000000000000000000000001234',
    gmgn_info: { risk: { issuerTokenCount: 3 } },
    event_score_result: { rating: 'pass', pass: true, score: 55 },
    relation_result: null,
    is_valid: false,
    jev_prompt: 'PROMPT-EXISTING',
    jev_raw_output: { answers: [] },
  };
  const thinRow = { id: 7, token_address: 'x', final_result: { rating: 'high' } };

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

  // ── B1：upsert 回读瘦列清单闭集（锁 SAVE_RETURN_COLS 防漂移；2026-10-24 新列名）──
  console.log('[B1] upsert 回读瘦列清单');
  {
    const expectedCols = [
      'id', 'token_address', 'token_symbol', 'raw_api_data', 'analyzed_at',
      'is_valid', 'prompt_version', 'pre_check_result', 'prestage_result',
      'event_result', 'event_score_result', 'relation_result', 'final_result',
    ].join(',');
    const { client, calls } = makeFakeSupabase({ existingRow, thinRow });
    NarrativeRepository.getSupabase = () => client;
    await NarrativeRepository.save({ ...baseResult }, { existing: existingRow });
    NarrativeRepository.getSupabase = realGetSupabase;
    const cols = calls[0].returnCols;
    assert(cols === expectedCols, `回读列 = 瘦列清单（实际 ${cols}）`);
    const fatCols = ['jev_prompt', 'jev_raw_output', 'legacy_stage2_prompt', 'legacy_stage3_raw_output',
      'prestage_prompt', 'twitter_info', 'classified_urls', 'extracted_info',
      'url_extraction_result', 'data_fetch_results', 'gmgn_info', 'token_category',
      'analysis_stage', 'prompt_type', 'platform', 'blockchain'];
    const leaked = fatCols.filter(c => cols.split(',').includes(c));
    assert(leaked.length === 0, `肥列零回读（泄漏：${leaked.join(',') || '无'}）`);
    // 投影列刻意不扩进回读闭集（新列无回读消费点）
    const projCols = ['final_rating', 'block_reason', 'block_stage', 'analysis_path',
      'total_score', 'relevance_score', 'quality_score', 'event_category',
      'jev_version', 'prestage_version'];
    const projLeak = projCols.filter(c => cols.split(',').includes(c));
    assert(projLeak.length === 0, `投影列零回读（泄漏：${projLeak.join(',') || '无'}）`);
  }

  // ── C1：existing 快照合并语义 ──
  console.log('[C1] 快照合并语义');
  {
    const { client, calls } = makeFakeSupabase({ existingRow, thinRow });
    NarrativeRepository.getSupabase = () => client;
    await NarrativeRepository.save({ ...baseResult }, { existing: existingRow });
    NarrativeRepository.getSupabase = realGetSupabase;
    const rec = calls[0].record;
    assert(rec.event_result === baseResult.event_result, '本次产物直写（event_result）');
    assert(rec.event_score_result === existingRow.event_score_result, '未产阶段带 existing 旧值（event_score_result）');
    assert(rec.gmgn_info === existingRow.gmgn_info, 'gmgn_info undefined → 保旧行（x-0）');
    assert(rec.is_valid === true, 'is_valid 用新值 true');
    assert(calls[0].onConflict === 'token_address', 'onConflict token_address');
    // legacy_* 新行停写：record 不携带任何 legacy_ 键
    const legacyKeys = Object.keys(rec).filter(k => k.startsWith('legacy_'));
    assert(legacyKeys.length === 0, `legacy_* 新行恒停写（泄漏：${legacyKeys.join(',') || '无'}）`);
  }

  // ── C2：__clear 标记两形态（穿透清库路径）在 existing 快照下仍生效 ──
  console.log('[C2] __clear 语义保持');
  {
    // 1) event_result clear → 联动清 jev IO（对齐旧 stage1 三列全 null 语义）
    const run = makeFakeSupabase({ existingRow, thinRow });
    NarrativeRepository.getSupabase = () => run.client;
    await NarrativeRepository.save({
      token_address: baseResult.token_address,
      event_result: { __clear: true },
    }, { existing: existingRow });
    NarrativeRepository.getSupabase = realGetSupabase;
    const rec = run.calls[0].record;
    assert(rec.event_result === null && rec.jev_prompt === null && rec.jev_raw_output === null,
      'event clear → result+jev IO 整组 null');
    assert(rec.relation_result === null, '既有 null 阶段保持 null');

    // 2) event_score_result clear → 只清 result 列（该段无 IO 宿主；jev IO 不受牵连）
    const run2 = makeFakeSupabase({ existingRow, thinRow });
    NarrativeRepository.getSupabase = () => run2.client;
    await NarrativeRepository.save({
      token_address: baseResult.token_address,
      event_score_result: { __clear: true },
    }, { existing: existingRow });
    NarrativeRepository.getSupabase = realGetSupabase;
    const rec2 = run2.calls[0].record;
    assert(rec2.event_score_result === null, 'event_score clear → 仅 result 列 null');
    assert(rec2.jev_prompt === existingRow.jev_prompt && rec2.jev_raw_output === existingRow.jev_raw_output,
      'event_score clear 不牵连 jev IO（undefined 合并保旧值）');
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

  // ── P1：投影终态精确值（非拦截票全键落）──
  console.log('[P1] 投影终态精确值');
  {
    const finEnvelope = {
      rating: 'high', pass: true, reason: null, category: 'high', score: 76.5,
      details: { eventCompositeScore: 40.2, relevanceScore: 18.3, qualityScore: 12.0, blockReason: null },
    };
    const evEnvelope = { rating: 'pass', pass: true, category: 'E', details: {} };
    const { client, calls } = makeFakeSupabase({ existingRow: null, thinRow });
    NarrativeRepository.getSupabase = () => client;
    await NarrativeRepository.save({
      token_address: baseResult.token_address,
      event_result: evEnvelope,
      final_result: finEnvelope,
    });
    NarrativeRepository.getSupabase = realGetSupabase;
    const rec = calls[1].record; // 0=preselect, 1=upsert
    assert(rec.final_rating === 'high', `final_rating='high'（实际 ${rec.final_rating}）`);
    assert(rec.total_score === 76.5, `total_score=fin.score（实际 ${rec.total_score}）`);
    assert(rec.event_score === 40.2, `event_score=details.eventCompositeScore（实际 ${rec.event_score}）`);
    assert(rec.relevance_score === 18.3 && rec.quality_score === 12.0, 'relevance/quality 精确值');
    assert(rec.block_reason === null && rec.block_stage === null, '非拦截票 block 两键 null');
    assert(rec.event_category === 'E', `event_category='E'（实际 ${rec.event_category}）`);
    assert(rec.analysis_path === null && rec.jev_version === null && rec.prestage_version === null,
      '未传版本三键 → null（新行）');
  }

  // ── P2：precheck 终态清残留分（旧 high fin 残留不得污染投影）──
  console.log('[P2] precheck 终态清残留分');
  {
    const staleExisting = {
      token_address: baseResult.token_address.toLowerCase(),
      final_result: { rating: 'high', pass: true, score: 76.99, details: { eventCompositeScore: 50 } },
      event_result: { rating: 'pass', pass: true, category: 'W' },
    };
    const { client, calls } = makeFakeSupabase({ existingRow: staleExisting, thinRow });
    NarrativeRepository.getSupabase = () => client;
    await NarrativeRepository.save({
      token_address: baseResult.token_address,
      pre_check_result: { rating: 'low', pass: false, reason: 'expired_tweet' },
      event_result: { __clear: true },
      final_result: { __clear: true },
    }, { existing: staleExisting });
    NarrativeRepository.getSupabase = realGetSupabase;
    const rec = calls[0].record;
    assert(rec.final_rating === 'low', `precheck fail → final_rating='low'（实际 ${rec.final_rating}）`);
    assert(rec.block_stage === 'precheck' && rec.block_reason === 'expired_tweet',
      `block_stage='precheck'+reason（实际 ${rec.block_stage}/${rec.block_reason}）`);
    assert(rec.total_score === null && rec.event_score === null
      && rec.relevance_score === null && rec.quality_score === null,
      '残留分数四列强制 null（不被旧 high fin 污染）');
    assert(rec.event_category === null, 'precheck 终态 event_category 强制 null');
  }

  // ── P3：mapper 拦截票（blockReason 命中）不落 event_category ──
  console.log('[P3] mapper 拦截票');
  {
    const blockedFin = {
      rating: 'low', pass: false, category: 'low', score: 20,
      details: { eventCompositeScore: 15, blockReason: 'bluechip_duplicate' },
    };
    const { client, calls } = makeFakeSupabase({ existingRow: null, thinRow });
    NarrativeRepository.getSupabase = () => client;
    await NarrativeRepository.save({
      token_address: baseResult.token_address,
      event_result: { rating: 'pass', pass: true, category: 'E', details: {} },
      final_result: blockedFin,
    });
    NarrativeRepository.getSupabase = realGetSupabase;
    const rec = calls[1].record;
    assert(rec.block_reason === 'bluechip_duplicate' && rec.block_stage === 'mapper',
      `block_stage='mapper'+blockReason（实际 ${rec.block_stage}/${rec.block_reason}）`);
    assert(rec.event_category === null,
      `拦截票 category 被掷骰改写不可信 → 不落（实际 ${rec.event_category}）`);
    assert(rec.total_score === 20, '拦截票分数照落（拦截≠无分数）');
  }

  // ── P4：intermediate 轮幂等（无信封字段 → 取 existing 合并值重投影同值）──
  console.log('[P4] intermediate 轮投影幂等 + 版本三键三态合并');
  {
    const richExisting = {
      token_address: baseResult.token_address.toLowerCase(),
      event_result: { rating: 'pass', pass: true, category: 'E', details: {} },
      event_score_result: { rating: 'pass', pass: true, score: 55 },
      relation_result: { rating: 'pass', pass: true, score: 70 },
      final_result: {
        rating: 'high', pass: true, score: 76.5,
        details: { eventCompositeScore: 40.2, relevanceScore: 18.3, qualityScore: 12.0 },
      },
      pre_check_result: { pass: true },
      analysis_path: 'prestage',
      jev_version: 'jev-121',
      prestage_version: 'jev-prestage-12',
    };
    const { client, calls } = makeFakeSupabase({ existingRow: richExisting, thinRow });
    NarrativeRepository.getSupabase = () => client;
    await NarrativeRepository.save({ ...baseResult, event_result: undefined },
      { existing: richExisting });
    NarrativeRepository.getSupabase = realGetSupabase;
    const rec = calls[0].record;
    assert(rec.final_rating === 'high' && rec.total_score === 76.5 && rec.event_category === 'E',
      'intermediate 轮投影=existing 信封重投影同值（幂等）');
    assert(rec.analysis_path === 'prestage' && rec.jev_version === 'jev-121'
      && rec.prestage_version === 'jev-prestage-12',
      '版本三键 undefined → 保 existing 旧值（三态合并）');
  }

  // ── P5：prestage 定档=评级非拦截 + 域外 category 宁缺勿炸 CHECK ──
  console.log('[P5] prestage 定档不落 block_stage + 域外 category 不落');
  {
    const { client, calls } = makeFakeSupabase({ existingRow: null, thinRow });
    NarrativeRepository.getSupabase = () => client;
    await NarrativeRepository.save({
      token_address: baseResult.token_address,
      prestage_result: { rating: 'low', pass: false, reason: 'community_low' },
      event_result: { rating: 'pass', pass: true, category: 'X', details: {} },
    });
    NarrativeRepository.getSupabase = realGetSupabase;
    const rec = calls[1].record;
    assert(rec.final_rating === 'low', `prestage low → final_rating='low'（实际 ${rec.final_rating}）`);
    assert(rec.block_stage === null && rec.block_reason === null,
      'prestage 定档是评级非拦截 → block 两键 null');
    assert(rec.event_category === null, `域外 category='X' 不落（实际 ${rec.event_category}）`);
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
    // 瘦列常量源码逐列锁定（与 B1 运行时断言双保险；新列名）
    const constBlock = repoSrc.split('const SAVE_RETURN_COLS = [')[1]?.split('];')[0] || '';
    for (const col of ['id', 'token_address', 'token_symbol', 'raw_api_data', 'analyzed_at',
      'is_valid', 'prompt_version', 'pre_check_result', 'prestage_result',
      'event_result', 'event_score_result', 'relation_result', 'final_result']) {
      if (!constBlock.includes(`'${col}'`)) { assert(false, `SAVE_RETURN_COLS 含 '${col}'`); }
    }
    assert(true, 'SAVE_RETURN_COLS 源码 13 列齐（新列名）');
    // dbManager 切换（Phase D：service key 优先修 anon 优先坑）
    assert(repoSrc.includes("import { dbManager } from '../../services/dbManager.js'"),
      '头部切 dbManager（service key 优先）');
    assert(repoSrc.includes('const supabase = dbManager.getSupabase();'),
      '模块级客户端 = dbManager.getSupabase()');
    // 投影挂点（B2 挂点 1：信封合并后、sanitize 前）
    assert(repoSrc.includes('Object.assign(record, projectColumns(record));'),
      '投影挂点：save 内 Object.assign(record, projectColumns(record))');
    const projFnBlock = repoSrc.split('export function projectColumns(')[1]?.split('\n}') [0] || '';
    assert(projFnBlock.includes('resolveFinalRating(record)'),
      'projectColumns 复用 resolveFinalRating（单一真相源）');
    assert(projFnBlock.includes("EVENT_CATEGORY_DOMAIN.includes(category)"),
      'event_category 域白名单防撞 CHECK');

    const anaSrc = fs.readFileSync(
      path.join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
    const finalBlock = anaSrc.split("timing.wrap('dbSave.final'")[1] || '';
    assert(finalBlock.includes('existing: cached'),
      'dbSave.final 调用点传 {existing: cached}');
    assert(finalBlock.includes('clearTokenCategory: !tokenCategory'),
      'C146：dbSave.final 无分类时传 clearTokenCategory（重跑覆盖旧分类）');
    assert(finalBlock.includes('analysis_path: analysisPath')
      && finalBlock.includes('jev_version: jevVersion')
      && finalBlock.includes('prestage_version: prestageVersion'),
      'B2：dbSave.final 携带投影直传三键');
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
