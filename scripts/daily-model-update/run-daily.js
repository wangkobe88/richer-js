#!/usr/bin/env node
/**
 * Daily 流程主编排（断点续跑）— 画像维护两步
 *
 * 迁自 pumpfun-wss-trader（2026-09-27）。跑在 182（crontab 6:30/22:00 触发，flock 防并发）。
 * 流程：gitSync → resumeOrStart（running/failed→续 / completed或无→新建）→ 顺序跑 step3-4 → complete。
 *   step3 token 分类（逐实验，实验级断点）→ step4 离线钱包画像（依赖 step3 的
 *   flash_crash_period/first_tick_time——不可调换顺序）
 *
 * ★断点判据与母版不同（必须）：母版「metrics[stepKey] 存在即跳过」在 richer-js 会误跳——
 *   step3 每实验增量 writeMetrics（done:false）让键在中途就已存在；此处判据是
 *   metrics[stepKey].done === true（step3 全部实验完成 / step4 单命令完成才写 done）。
 *   实验级断点续跑在 step3 内部（per_experiment 中 tokens!=null 跳过）。
 *
 * 僵尸清理：running 行 >24h（跨天，上次进程死了没 fail）→ fail + 新建。
 *
 * 与母版差异：STEPS 裁两步（step1/2/5/6 不迁——轮换记录/回测对比/实验轮换/ML 均迁移裁定
 * 排除）；删 PVP_TRAIN_STEP 门控（step6 专用）；僵尸新建分支 startStep='step3'。
 */
'use strict';

const path = require('path');
const { execSync } = require('child_process');
const db = require('./lib/db');

const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * 启动前 git sync：pull --rebase origin main。
 * 让上游（人工推送的 bug 修复等）自动到 182，避免跑 stale 代码。
 * best-effort：失败（脏树等）只 warn，不阻塞本次迭代（用本地现有代码继续）——母版语义原样。
 */
function gitSync() {
  try {
    const out = execSync(`cd ${REPO_ROOT} && git pull --rebase origin main 2>&1`, { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] });
    const tail = out.trim().split('\n').slice(-2).join(' | ');
    console.log(`[run-daily] git sync: ${tail}`);
  } catch (e) {
    console.warn(`[run-daily] git sync 失败(用本地代码继续): ${(e.stdout || e.stderr || e.message || '').toString().trim().slice(0, 180)}`);
  }
}

const STEP_MODULES = {
  step3: require('./steps/step3-update-token-profile'),
  step4: require('./steps/step4-build-wallet-profiles'),
};
const STEP_KEY = db.METRIC_KEYS; // { step3:'step3_token_profile', step4:'step4_wallet_profiles' }
const ZOMBIE_HOURS = 24;

async function reload(id) {
  const { data, error } = await db.sb.from(db.TABLE).select('*').eq('id', id).single();
  if (error) throw new Error(`reload ${id}: ${error.message}`);
  return data;
}

async function main() {
  gitSync();
  const triggerTime = new Date().toISOString();
  let { iteration, resume, startStep } = await db.resumeOrStart(triggerTime);

  // 僵尸清理：running 太老（跨天）→ fail + 新建
  if (resume) {
    const ageH = (Date.now() - new Date(iteration.created_at).getTime()) / 3600000;
    if (ageH > ZOMBIE_HOURS) {
      console.error(`[run-daily] running ${iteration.id} 已 ${ageH.toFixed(1)}h（僵尸），fail 并新建`);
      await db.fail(iteration.id, `zombie: running > ${ageH.toFixed(1)}h`);
      const no = await db.nextIterationNo();
      iteration = await db.createIteration({ iterationNo: no, triggerTime });
      resume = false; startStep = 'step3';
    }
  }

  const itId = iteration.id;
  console.log(`\n========== DAILY iter#${iteration.iteration_no} ${resume ? 'RESUME' : 'NEW'} from ${startStep} ==========`);

  const startIdx = db.STEPS.indexOf(startStep);
  if (startIdx < 0) { await db.fail(itId, `bad startStep ${startStep}`); throw new Error(`bad startStep ${startStep}`); }

  for (let i = startIdx; i < db.STEPS.length; i++) {
    const stepName = db.STEPS[i];
    const stepKey = STEP_KEY[stepName];

    // ★断点：该 step done=true 才算完成（step3 增量写 done:false 期间键已存在，见头注）
    const cur = await reload(itId);
    if (cur.metrics && cur.metrics[stepKey] && cur.metrics[stepKey].done) {
      console.log(`[${stepName}] 已完成（done=true），跳过`);
      continue;
    }

    await db.setStep(itId, stepName);
    console.log(`\n>>> [${stepName}] 开始`);
    const stepStart = Date.now();
    try {
      const fresh = await reload(itId);
      await STEP_MODULES[stepName].run(fresh);
      console.log(`<<< [${stepName}] 完成`);
      // 记录耗时（best-effort，不阻塞流程）
      const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
      try {
        const cur2 = await reload(itId);
        const existing = (cur2.metrics && cur2.metrics[stepKey]) || {};
        if (typeof existing.elapsed_sec === 'undefined') {
          existing.elapsed_sec = parseFloat(elapsed);
          await db.writeMetrics(itId, stepKey, existing);
        }
      } catch (e2) {
        console.warn(`[run-daily] 记录 ${stepName} 耗时(${elapsed}s)失败: ${e2.message}`);
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.error(`!!! [${stepName}] 失败: ${msg}`);
      await db.fail(itId, `[${stepName}] ${msg}`);
      console.error(`\n========== DAILY iter#${iteration.iteration_no} FAILED at ${stepName} ==========`);
      process.exit(1);
    }
  }

  await db.complete(itId);
  console.log(`\n========== DAILY iter#${iteration.iteration_no} COMPLETED ==========`);
}

main().catch(e => { console.error('[run-daily] FATAL:', (e && e.message) || e); process.exit(1); });
