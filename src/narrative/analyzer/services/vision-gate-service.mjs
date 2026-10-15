/**
 * Vision Gate Service - vision 前置 Jev 预判门（C72，2026-10-15 用户裁定）
 *
 * 主推文首图 vision 分析（单图实测 11.2s）是买腿直调延迟最大单点。本服务在
 * analyzer 主链真正 await vision 之前，先用 1 题 Choice 预判「文字语料是否已
 * 足够确认叙事」——sufficient 且概率 ≥ minSufficientProb 则整段跳过 vision
 * （本票无图语义：state 不渲染图块 / J1.30 不问 / C59/J1.30 豁免不触发，
 * 与无配图票、vision 失败降级票完全同语义，下游零改动）。
 *
 * 方向安全性（用户裁定依据）：误判 sufficient → 无图 = 豁免不触发 = 偏拦
 * （fail-closed，损失是错过票不是买入风险）；误判 need_image / Jev 失败 →
 * 跑 vision = 原行为（多付 ~0.5s）。预取链（dataPrefetch/visionPrefetch）
 * 完全不动——门只挡 analyzer 主链这一次 await，预取照常跑照常写缓存。
 *
 * state 与主 Jev 同语料（buildJevState 无图形态）：判「文字够不够」只有看与
 * 主调用同样的语料才成立；不带 superIPInfo/preScores 装饰（预评分是代码端
 * 元数据不是语料；通道分流在门下游才发生，门判的与通道无关）。
 */

import logger from '../../core/logger.mjs';
import { getConfig } from '../../engine/config.mjs';
import { JevClient } from '../llm/JevClient.mjs';
import { buildJevState } from '../llm/jev-state-builder.mjs';
import {
  buildVisionGateQuestions,
  judgeVisionGate,
  JEV_VISIONGATE_QUESTIONS_VERSION,
} from '../llm/jev-visiongate-questions.mjs';

/** 读取门配置节；options.config 可注入覆盖（单测用，与 image-analysis-service 同模式） */
function _gateConfig(options = {}) {
  if (options.config) return options.config.vision?.gate || null;
  return getConfig()?.vision?.gate || null;
}

/**
 * 门是否发起（同步资格判定，镜像 analyzer 泳道 0 预启动条件 + 决策①）：
 * 门开 + 主推文有首图 + 未挂 image_analysis（已挂 = 缓存命中/预取完成零耗时，
 * 直接用图不问门；无图票/账号型语料本来就不跑 vision，问了浪费配额）
 */
export function shouldAskVisionGate(twitterInfo, options = {}) {
  const gate = _gateConfig(options);
  if (!gate || gate.enabled !== true) return false;
  return twitterInfo?.type === 'tweet'
    && !!twitterInfo.media?.images?.[0]?.url
    && !twitterInfo.image_analysis;
}

/**
 * 1 题 Choice 预判。永不 throw：Jev 失败 → {skipped:false} fail-safe 跑
 * vision（门的意义是省时间，失败时多付一次门调用即回到原路径）。
 *
 * @param {Object} tokenData
 * @param {Object} fetchResults analyzer 正常流程分支构造的语料包（此时必无 image_analysis）
 * @param {Object} [options] { now（token 创建时间 ms，与主 Jev 同基准）, config（单测注入） }
 * @returns {Promise<{skipped: boolean, choice: string|null, prob: number|null, ms: number, error?: string}>}
 */
export async function runVisionGate(tokenData, fetchResults, options = {}) {
  const gate = _gateConfig(options);
  if (!gate || gate.enabled !== true) return { skipped: false, choice: null, prob: null, ms: 0 };
  const startedAt = Date.now();
  try {
    const { state } = buildJevState(tokenData, fetchResults, { now: options.now });
    const questions = buildVisionGateQuestions();
    const result = await JevClient.ask(state, questions, { label: `jev-visiongate:${tokenData.symbol || ''}` });
    const verdict = judgeVisionGate(result.answers, { minSufficientProb: gate.minSufficientProb });
    logger.info('VisionGate', `门判定=${verdict.choice} p=${verdict.prob} ${Date.now() - startedAt}ms → ${verdict.skipped ? '跳过vision' : '跑vision'} v=${JEV_VISIONGATE_QUESTIONS_VERSION}`);
    return { ...verdict, ms: Date.now() - startedAt };
  } catch (e) {
    logger.warn('VisionGate', `预判失败 fail-safe 跑 vision: ${e.message}`);
    return { skipped: false, choice: null, prob: null, ms: Date.now() - startedAt, error: e.message };
  }
}
