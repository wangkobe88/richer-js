/**
 * Step 3 — 更新 token profile（182）
 *
 * 迁自 pumpfun-wss-trader（2026-09-27）。处理最新 N 个 virtual 实验的 tick 数据离线重分类，
 * 写入 token_profiles（upsert 幂等），供 step4 钱包画像依赖（flash_crash_period/first_tick_time）。
 *
 * 与母版差异（richer-js build-token-profiles.cjs 参数契约不同）：
 *   1. 母版一条命令传 `--experiment-ids a,b,c`（多实验合并进程）；richer-js 脚本只收
 *      `--experiment <id>` 单实验且未知参数 exit(1) → 改 for 循环逐实验 execSync。
 *      代价：跨实验重复 token 的全史 ticks 重复拉/重复 upsert（幂等但费时）；收益见下条。
 *   2. ★实验级断点（超出母版的增强）：每跑完一个实验立即 writeMetrics 增量落盘
 *      （per_experiment 数组，tokens!=null 视为已完）；step3 中途失败重跑时已完实验跳过，
 *      不重复拉其全史 ticks。断点判据与 run-daily 的 step 级断点通过 done 标记衔接：
 *      增量写 done:false（run-daily 见 done!=true 不跳过本 step，进来后按实验续），
 *      全部完成才写 done:true。
 *   3. 删母版的 token-category 缓存 unlink / --write-db / --force-rebuild /
 *      old_experiment_id 断言（richer-js 无此物）。
 *
 * 输出解析在 ../lib/parse.js（协议正则单一真相源，fixture 单测覆盖）。
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const db = require('../lib/db');
const { parseTokenProfileRun } = require('../lib/parse');
const { getScopeExperiments } = require('../lib/experiment-utils');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const NODE = process.execPath;
// 单实验口径 1800s（母版 3600s 是 10 实验合并口径）；输出仅数行汇总（无进度行），16MB 余量足够
const TIMEOUT_MS = 1800000;
const MAX_BUFFER = 16 * 1024 * 1024;

/** 聚合容器：per_experiment 累加 */
function newAgg() {
  return {
    processed: 0,        // Σ token 全集
    ticks: 0,            // Σ ticks
    db_written: 0,       // Σ 写入 token_profiles 行
    category_counts: {}, // 各实验分类分布 Map 合并求和
    classifier_version: null,
    per_experiment: [],  // [{id, name, tokens, tokens_with_ticks, ticks, written, fetch_ms}]
  };
}

/** 单实验结果并入聚合（重跑路径复用：r 换成 per_experiment 断点记录，含 category_counts） */
function mergeInto(agg, exp, r) {
  agg.processed += r.tokens || 0;
  agg.ticks += r.ticks || 0;
  agg.db_written += r.written || 0;
  if (r.classifier_version) agg.classifier_version = r.classifier_version;
  for (const [cat, n] of Object.entries(r.category_counts || {})) {
    agg.category_counts[cat] = (agg.category_counts[cat] || 0) + n;
  }
  agg.per_experiment.push({
    id: exp.id, name: exp.experiment_name,
    tokens: r.tokens, tokens_with_ticks: r.tokens_with_ticks,
    ticks: r.ticks, written: r.written, fetch_ms: r.fetch_ms,
    category_counts: r.category_counts || null, // 断点重跑路径恢复分类合计用
  });
}

async function run(iteration) {
  const stepKey = db.METRIC_KEYS.step3;
  // 取最新 N 个 virtual 实验（getScopeExperiments 按 created_at 不依赖 iteration 链，老→新）
  const experiments = await getScopeExperiments(db.sb);
  if (!experiments.length) throw new Error('step3: scope 内无 virtual 实验');
  console.log(`[step3] scope ${experiments.length} 个实验: ${experiments.map(e => e.id.slice(0, 8)).join(',')}`);

  // 实验级断点：上次中断前已完成的实验（per_experiment 中 tokens!=null）跳过
  const prev = (iteration.metrics && iteration.metrics[stepKey]) || {};
  const prevByExp = new Map((prev.per_experiment || []).map(p => [p.id, p]));

  const agg = newAgg();
  const outputTails = [];
  let skipped = 0;

  for (const exp of experiments) {
    const done = prevByExp.get(exp.id);
    if (done && done.tokens != null) {
      // 已完成实验的结果直接并入聚合（重跑路径），不再拉 ticks
      mergeInto(agg, exp, {
        tokens: done.tokens, tokens_with_ticks: done.tokens_with_ticks,
        ticks: done.ticks, written: done.written, fetch_ms: done.fetch_ms,
        classifier_version: prev.classifier_version || null,
        category_counts: done.category_counts || null,
      });
      skipped++;
      continue;
    }

    console.log(`[step3] 实验 ${exp.id.slice(0, 8)}（${exp.experiment_name || ''}）开始`);
    const cmd = `cd ${REPO_ROOT} && NODE_OPTIONS=--max-old-space-size=12288 ${NODE} scripts/build-token-profiles.cjs --experiment ${exp.id}`;
    const out = execSync(cmd, { encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] });
    const tail = out.split('\n').slice(-15).join('\n');
    console.log(`[step3] 实验 ${exp.id.slice(0, 8)} 完成\n${tail}`);
    outputTails.push(`# ${exp.id.slice(0, 8)}\n${tail}`);

    const r = parseTokenProfileRun(out);
    if (r.tokens == null) {
      // 输出协议漂移（子进程改了文案）：显式报错而非静默 null 落表——分类数字是本步核心产物
      throw new Error(`step3: 实验 ${exp.id.slice(0, 8)} 输出解析失败（tokens=null，build-token-profiles 输出格式漂移？tail:\n${tail.slice(-400)}`);
    }
    mergeInto(agg, exp, r);

    // ★增量落盘断点（done:false）：中途失败重跑时已完实验跳过
    await db.writeMetrics(iteration.id, stepKey, {
      ...agg, done: false,
      experiment_ids: experiments.map(e => e.id),
      skipped_resumed: skipped,
      output_tail: outputTails.join('\n').slice(-1200),
    });
  }

  // 全部完成：正式落盘（done:true，run-daily 据此跳过本 step）
  await db.writeMetrics(iteration.id, stepKey, {
    ...agg, done: true,
    experiment_ids: experiments.map(e => e.id),
    skipped_resumed: skipped,
    output_tail: outputTails.join('\n').slice(-1200),
  });
  console.log(`[step3] 汇总: token=${agg.processed} ticks=${agg.ticks} 落地=${agg.db_written}（重跑跳过 ${skipped} 个已完实验）`);
}

module.exports = { run };
