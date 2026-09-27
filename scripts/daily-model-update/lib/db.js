/**
 * model_iteration_metrics 指标表 CRUD + 断点续跑状态机（Daily 流程：画像维护两步）
 *
 * 迁自 pumpfun-wss-trader scripts/daily-model-update/lib/db.js（2026-09-27）。
 * 被 run-daily.js / 各 step 共用。所有核心数字写入 metrics jsonb。
 * 断点续跑：resumeOrStart() 决定续跑(running 行)还是新建；每步 setStep/writeMetrics 推进。
 *
 * 与母版差异：
 *   1. dbManager 化——删 createClient(SUPABASE_SERVICE_KEY) 直连，改
 *      dbManager.getClient()（richer-js 惯例；182 SERVICE_KEY=service_role 过 RLS）。
 *      dbManager 自身 dotenv 是 './config/.env' 相对 CWD → 本模块顶层先以绝对路径
 *      加载同一 .env（dotenv 不覆盖已设值），防 cron/异目录 CWD 漂移取不到 env
 *      （cron wrapper cd $REPO 是双保险）。
 *   2. STEPS 裁两步（step3 token 分类 → step4 离线钱包画像）；step1/2/5/6 不迁
 *      （轮换记录/回测对比/实验轮换/ML——迁移裁定排除）。
 *   3. 删 setExperimentIds / getLastCompleted（step1/2/5 专用，无消费者）。
 *
 * 表字段（DDL：scripts/sql/create-model-iteration-metrics.sql）:
 *   id/iteration_no/trigger_time/old_experiment_id/new_experiment_id/
 *   status/current_step/metrics(jsonb)/error/created_at/updated_at
 *   （母版另有 model_path ML 遗留列，richer-js 建表即无）
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../..', 'config', '.env') });
const { dbManager } = require('../../../src/services/dbManager');

const sb = dbManager.getClient();
const TABLE = 'model_iteration_metrics';

// 步骤顺序（断点续跑据此推进）。step4 须在 step3 后（依赖 token_profiles 的
// flash_crash_period/first_tick_time 算 bad_action 靶向率——build-wallet-profiles 头注纪律）。
const STEPS = ['step3', 'step4'];
// metrics jsonb 的 step 键
const METRIC_KEYS = {
  step3: 'step3_token_profile',
  step4: 'step4_wallet_profiles',
};

function nowIso() { return new Date().toISOString(); }

/** 取下一个 iteration_no（当前最大 + 1）。读改写非原子——并发防线 =
 *  cron wrapper flock + UNIQUE(idx_mim_iteration_no) 索引（双建显式报错）。 */
async function nextIterationNo() {
  const { data, error } = await sb.from(TABLE)
    .select('iteration_no')
    .order('iteration_no', { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw new Error(`nextIterationNo: ${error.message}`);
  return ((data && data[0] && data[0].iteration_no) || 0) + 1;
}

/** 新建一行 iteration（status=running, current_step=step3） */
async function createIteration({ iterationNo, triggerTime }) {
  const { data, error } = await sb.from(TABLE).insert({
    iteration_no: iterationNo,
    trigger_time: triggerTime,
    status: 'running',
    current_step: 'step3',
    metrics: {},
  }).select().single();
  if (error) throw new Error(`createIteration: ${error.message}`);
  return data;
}

/** 取最新 status=running 的行（诊断用） */
async function getRunning() {
  const { data, error } = await sb.from(TABLE)
    .select('*')
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`getRunning: ${error.message}`);
  return (data && data[0]) || null;
}

/**
 * 决定本次触发是续跑还是新建。
 * - 最新一行 status != completed（running/failed/initializing）→ 续跑，从 current_step 开始
 *   （failed 也续：改回 running + 清 error，重试失败步骤）
 * - 否则（completed 或无行）→ 新建
 * 返回 { iteration, resume, startStep }
 */
async function resumeOrStart(triggerTime) {
  const { data, error } = await sb.from(TABLE).select('*')
    .order('iteration_no', { ascending: false, nullsFirst: false }).limit(1);
  if (error) throw new Error(`resumeOrStart: ${error.message}`);
  const latest = data && data[0];
  if (latest && latest.status !== 'completed') {
    if (latest.status === 'failed' || latest.status === 'initializing') {
      // 续前重置为 running（清旧 error）
      await sb.from(TABLE).update({ status: 'running', error: null, updated_at: nowIso() }).eq('id', latest.id);
      latest.status = 'running'; latest.error = null;
    }
    return { iteration: latest, resume: true, startStep: latest.current_step || 'step3' };
  }
  const no = await nextIterationNo();
  const it = await createIteration({ iterationNo: no, triggerTime });
  return { iteration: it, resume: false, startStep: 'step3' };
}

/** 推进 current_step（某步开始时调用） */
async function setStep(id, step) {
  const { error } = await sb.from(TABLE).update({
    current_step: step, updated_at: nowIso(),
  }).eq('id', id);
  if (error) throw new Error(`setStep: ${error.message}`);
}

/** 写入某步的 metrics（merge 进 metrics jsonb，不覆盖其他步）。含重试（supabase fetch 瞬时失败）。
 *  best-effort：指标记录是副作用，4 次重试仍失败只告警不 throw——
 *  避免 supabase fetch 瞬时抖动废掉整轮迭代（母版 iter#1 曾因 writeMetrics fetch failed 在 step4 崩）。 */
async function writeMetrics(id, stepKey, stepMetrics) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { data, error } = await sb.from(TABLE).select('metrics').eq('id', id).single();
      if (error) throw new Error(`writeMetrics read: ${error.message}`);
      const merged = { ...(data.metrics || {}), [stepKey]: stepMetrics };
      const { error: e2 } = await sb.from(TABLE).update({
        metrics: merged, updated_at: nowIso(),
      }).eq('id', id);
      if (e2) throw new Error(`writeMetrics write: ${e2.message}`);
      return merged;
    } catch (e) {
      lastErr = e;
      if (attempt < 4) {
        console.warn(`[writeMetrics] 重试 ${attempt}/4: ${e.message}`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }
  console.warn(`[writeMetrics] ${stepKey} 4次重试仍失败，放弃记录(不中断流程): ${lastErr?.message}`);
  return null;
}

/** 全部完成 */
async function complete(id) {
  const { error } = await sb.from(TABLE).update({
    status: 'completed', current_step: 'done', updated_at: nowIso(),
  }).eq('id', id);
  if (error) throw new Error(`complete: ${error.message}`);
}

/** 失败：记录 error，停止 */
async function fail(id, errMsg) {
  const { error } = await sb.from(TABLE).update({
    status: 'failed', error: String(errMsg).slice(0, 2000), updated_at: nowIso(),
  }).eq('id', id);
  if (error) throw new Error(`fail: ${error.message}`);
}

module.exports = {
  sb, TABLE, STEPS, METRIC_KEYS,
  nextIterationNo, createIteration, getRunning, resumeOrStart,
  setStep, writeMetrics, complete, fail,
};
