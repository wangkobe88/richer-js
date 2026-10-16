/**
 * Corpus Gate Service — 非主语料抓取前置 Jev 预判门（C79，2026-10-16 用户裁定）
 *
 * 用户原话：「不仅仅是抖音的调用，很多外部资源的调用都是类似思路，就是如果
 * 对叙事的理解已经不需要其它信息补充，那就不用去取了」。外部语料抓取（抖音
 * 走 JustOneAPI 实测 2.8-4.4s，是买腿直调关键路径最大单点；偷窥狂案
 * 0x57ef…7777：douyin 4.37s 占直调 5.35s 的 82%）在 data-fetch 编排层真正
 * 发起之前，先用 1 题 Choice 预判「twitter 主语料之外，其余待抓平台语料还
 * 需要吗」——sufficient 且概率 ≥ minSufficientProb 则 justoneapi 串行桶 +
 * github 桶全部待抓段整段跳过（各 results.<x>Info 保持 null = 无该平台 URL、
 * 抓取失败同语义，下游零改动；dataFetchResults.<platform> 落 additive
 * skipped='corpus_gate' 标记供审计）。
 *
 * 方向安全性（对齐 C72 vision gate）：误判 sufficient → 待抓段缺席 → 证据少
 * 载体的最坏结果是评级偏 low → 偏拦（fail-closed，损失是错过票不是买入风险）；
 * 误判 need_fetch / Jev 失败 / 超时 → 照抓 = 原行为（多付一次门调用 ≤2s）。
 *
 * 与 C72 的三点结构差异：
 * ① 挂点在 fetch 编排层而非 analyzer 主链——此时 twitter 桶（叙事主语料）还在
 *   并行跑，由编排处先 await twitterPromise 再调本服务；资格判定要求
 *   twitterInfo 非空（纯非 twitter 票不问门直接抓——主语料缺席无从判「已足够」）。
 * ② 一次门判全部待抓平台（而非 per-platform 门）：JevClient 最坏 3×30s+退避
 *   ≈105s 不可接受，且串行桶 per-platform 门会把 insufficient 票拖成 N 次门
 *   调用——清单进 state 附加段（[UNFETCHED SOURCES]）由 Jev 平台敏感地整体判。
 * ③ 外层 Promise.race 2s 上限（JevClient 超时尾部锁死买腿可承受界；安全界非
 *   校准旋钮，不做配置键）。
 *
 * state 与主 Jev 同语料构造（buildJevState）：twitter 已抓 + 其余待抓平台
 * 缺席（对应 section 不渲染 = 无该语料形状，判据偏 need_fetch 安全方向）；
 * 不带 superIPInfo/preScores 装饰（与 vision gate 同口径）。
 */

import logger from '../../core/logger.mjs';
import { getConfig } from '../../engine/config.mjs';
import { JevClient } from '../llm/JevClient.mjs';
import { buildJevState } from '../llm/jev-state-builder.mjs';
import {
  buildCorpusGateQuestions,
  judgeCorpusGate,
  JEV_CORPUSGATE_QUESTIONS_VERSION,
} from '../llm/jev-corpusgate-questions.mjs';

/** 门调用外层 race 上限（JevClient 内部重试最坏 ~105s，此处锁死买腿可承受界） */
const CORPUS_GATE_TIMEOUT_MS = 2000;

/**
 * 纳入门管的平台清单（classifiedUrls 桶键）：justoneapi 串行桶全部 + github。
 * twitter 刻意不在（判据来源/主语料，不可跳）；websites 刻意不在
 * （websiteFetch.enabled 独立开关显式 opt-in，尊重显式意愿）；telegram/discord
 * 无抓取段不计。
 */
const GATED_PLATFORMS = ['weibo', 'youtube', 'douyin', 'tiktok', 'bilibili',
  'binanceSquare', 'weixin', 'amazon', 'xiaohongshu', 'instagram', 'github'];

/**
 * 计算待抓平台清单（同步，classifiedUrls 同步可得）：门管平台中 URL 桶非空者，
 * 取各桶首 URL（跳过标记与 state 附加段共用）。
 * @returns {Array<{platform: string, url: string}>}
 */
export function pendingCorpusPlatforms(classifiedUrls) {
  if (!classifiedUrls) return [];
  return GATED_PLATFORMS
    .filter(p => Array.isArray(classifiedUrls[p]) && classifiedUrls[p].length > 0)
    .map(p => ({ platform: p, url: classifiedUrls[p][0].url }));
}

/** 读取门配置节；options.config 可注入覆盖（单测用，与 vision-gate-service 同模式） */
function _gateConfig(options = {}) {
  if (options.config) return options.config.corpusGate || null;
  return getConfig()?.corpusGate || null;
}

/** 门开关（供编排处决定是否等 twitter——门关 = 零等待零行为变化） */
export function isCorpusGateOn(options = {}) {
  const gate = _gateConfig(options);
  return gate?.enabled === true;
}

/**
 * 门是否发起（同步资格判定）：门开 + 存在待抓平台 + twitter 主语料已抓到
 * （account 型也算——账号时间线非空可判）。纯非 twitter 票 twitter 缺席无从
 * 判「语料已足够」→ 不问门照抓。
 */
export function shouldAskCorpusGate(twitterInfo, pending, options = {}) {
  return isCorpusGateOn(options) && !!twitterInfo
    && Array.isArray(pending) && pending.length > 0;
}

/**
 * 1 题 Choice 预判。永不 throw：Jev 失败/超时 → {skipped:false} fail-safe 照抓
 * （门的意义是省时间，失败时多付一次门调用即回到原路径）。
 *
 * @param {Object} tokenData
 * @param {Object} partialResults data-fetch 层构造的语料包（twitter 已填、待抓
 *   平台 Info 全为 null——正是要判定的形态）
 * @param {Object} [options] { pending（待抓平台清单，进 state 附加段）,
 *   now（token 创建时间 ms，缺省自取与主 Jev 同基准）, gateTimeoutMs（race
 *   上限，单测用）, config（单测注入） }
 * @returns {Promise<{skipped: boolean, choice: string|null, prob: number|null, ms: number, error?: string}>}
 */
export async function runCorpusGate(tokenData, partialResults, options = {}) {
  const gate = _gateConfig(options);
  if (!gate || gate.enabled !== true) return { skipped: false, choice: null, prob: null, ms: 0 };
  const startedAt = Date.now();
  try {
    const createdSec = tokenData?.tokenCreatedAtSec || tokenData?.raw_api_data?.created_at;
    const now = options.now ?? (createdSec ? createdSec * 1000 : undefined);
    const { state } = buildJevState(tokenData, partialResults, { now });
    // 待抓平台清单附加段（state 末尾）：门判「其余语料还需要吗」的平台语境
    const pending = Array.isArray(options.pending) ? options.pending : [];
    const annex = pending.length > 0
      ? '\n\n[UNFETCHED SOURCES]\n' + pending.map(p => `- ${p.platform}: ${p.url} (content NOT fetched yet)`).join('\n')
      : '';
    const questions = buildCorpusGateQuestions();
    const gateTimeoutMs = options.gateTimeoutMs ?? CORPUS_GATE_TIMEOUT_MS;
    // 败者续飞自然作废（单 POST 无副作用），先挂 catch 防 unhandled rejection
    const gateP = JevClient.ask(state + annex, questions, { label: `jev-corpusgate:${tokenData.symbol || ''}` })
      .then(v => ({ ok: true, v }))
      .catch(e => ({ ok: false, e }));
    let timer;
    const raced = await Promise.race([
      gateP,
      new Promise(r => { timer = setTimeout(() => r({ ok: false, timeout: true }), gateTimeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    if (!raced.ok) {
      const error = raced.timeout ? `gate timeout ${gateTimeoutMs}ms` : (raced.e?.message || String(raced.e));
      logger.warn('CorpusGate', `预判失败（${error}）fail-safe 照抓待抓语料`);
      return { skipped: false, choice: null, prob: null, ms: Date.now() - startedAt, error };
    }
    const verdict = judgeCorpusGate(raced.v.answers, { minSufficientProb: gate.minSufficientProb });
    const pendingNames = pending.map(p => p.platform).join(',');
    logger.info('CorpusGate', `门判定=${verdict.choice} p=${verdict.prob} ${Date.now() - startedAt}ms → ${verdict.skipped ? `跳过待抓语料[${pendingNames}]` : '照抓待抓语料'} v=${JEV_CORPUSGATE_QUESTIONS_VERSION}`);
    return { ...verdict, ms: Date.now() - startedAt };
  } catch (e) {
    logger.warn('CorpusGate', `预判失败 fail-safe 照抓待抓语料: ${e.message}`);
    return { skipped: false, choice: null, prob: null, ms: Date.now() - startedAt, error: e.message };
  }
}
