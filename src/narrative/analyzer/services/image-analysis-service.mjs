/**
 * 推文配图视觉分析服务（2026-10-07 现金猫案 0x56dc26bd…7777 用户裁定开启）
 *
 * 背景：C51 龙虾案 / 现金猫案的共同形状——代币名与语料的指代映射唯一载体是推文
 * 配图（推文文本零关联字样），Jev 按纯文本语料判 name_referent none_related 完全
 * 自洽但事实上漏判。本服务把主推文首图的视觉描述注入 twitterInfo.image_analysis，
 * 经 twitter-section 既有渲染块（【图片内容分析】）进入 Jev state——渲染层零改动。
 *
 * 用户两点约束（2026-10-07）：
 *   1. 同一图片分析结果缓存（external_resource_cache 按图片 URL 键控，90 天；
 *      另有进程内 in-flight 去重——复蹭簇同分钟并发分析同图只打一次 API）；
 *   2. 每个代币只分析主推文的第一张图（多图/第二推文/引用推文的图都不分析，
 *      时间成本考量）。
 *
 * 模型：Qwen/Qwen3-Omni-30B-A3B-Captioner @ SiliconFlow（2026-10-07 用户裁定，
 * 三模型 A/B + 亲眼看图仲裁终选——现金猫案配图（HTeSnpDXAAAMv9P.jpg）真相 =
 * 白猫举金币（黄兜帽/墨镜/金表/蓝天白云，无任何排行榜界面）：Qwen 描述全对
 * 3861ms 且诚实标注「屏幕上没有可读文字」；glm-4.6v 把图「看成」排行榜截图
 * = 纯文字脑补编造（叙事证据不可用）；glm-5.3 是文本模型看不到图。OpenAI
 * 兼容端点 /v1/chat/completions（Authorization Bearer + image_url data URI）。
 * ★压缩输出必须 jpeg（downloader 默认 webp，但 webp 只在智谱端点实测过被静默
 * 丢弃；jpeg 是三模型 A/B 全部实测正常的格式），故 downloadAsBase64 传
 * { format: 'jpeg' }。
 *
 * 失败语义：
 *   - vision 配置节缺失 / enabled=false → 跳过（功能关闭态，非错误）
 *   - enabled=true 但 key 未配置 / 配置残缺 → throw（部署错误要炸出来，不静默降级）
 *   - 下载 / API / 解析失败 → warn + 返回 false + 不写缓存（下次重试语义与无缓存
 *     一致——刻意不走 CachedFetcher.fetchWithCache，其失败 1h 冷却会灭掉宣告竞态
 *     重试窗口，与 account-analysis 同裁定）；叙事分析继续，缺图证据 = 开启前行为
 *
 * 配置（config/narrative-engine.json vision 节）：
 *   { enabled, baseUrl, model, apiKeyEnv, timeoutMs, maxTokens, cacheTtlSec }
 */

import { getConfig } from '../../engine/config.mjs';
import logger from '../../core/logger.mjs';
import { ImageDownloader } from '../../utils/image-downloader.mjs';
import { ExternalResourceCache } from '../../db/ExternalResourceCache.mjs';

/** 缓存 resourceType（external_resource_cache.url + resource_type 联合键） */
const CACHE_RESOURCE_TYPE = 'tweet_image';

/**
 * 图片分析 prompt 版本：prompt 措辞 / 输出形状 / 模型改动时 bump。
 * 缓存行带版本号，版本不符视为 miss 重析（防旧形状毒缓存）。
 * img-v2（2026-10-07）：glm-5.3 → Qwen3-Omni-30B-A3B-Captioner @ SiliconFlow
 * 切换——v1 行全部是 glm-5.3「看不到图」废结果（webp 被智谱端点静默丢弃），
 * 全部需要重析（img-v2 未部署过 182，无需 v3）。
 */
const IMAGE_PROMPT_VERSION = 'img-v2';

const RETRY_BACKOFF_MS = [500, 1500];

/** 进程内 in-flight 去重：同图并发分析共享同一次调用（复蹭簇形状） */
const inflight = new Map();

/** 读取 vision 配置节；options.config 可注入覆盖（单测用） */
function _visionConfig(options = {}) {
  if (options.config) return options.config.vision || null;
  const config = getConfig();
  return config.vision || null;
}

/**
 * 分析主推文首图并挂到 twitterInfo.image_analysis
 *
 * @param {Object|null} twitterInfo - 推文语料（主推文；type!=='tweet' 或无图直接跳过）
 * @param {Object} [options] - 单测注入 { config }（覆盖 config/narrative-engine.json）
 * @returns {Promise<boolean>} 是否挂上了 image_analysis（false=跳过/失败，语料原样）
 * @throws 配置残缺（enabled=true 但 key/baseUrl/model 缺失）——部署错误 fail-loud
 */
export async function analyzeTweetImage(twitterInfo, options = {}) {
  const vision = _visionConfig(options);
  if (!vision || !vision.enabled) return false;

  // 只分析主推文的第一张图（用户约束 2：多图只取其一）
  if (!twitterInfo || twitterInfo.type !== 'tweet') return false;
  const firstImage = twitterInfo.media?.images?.[0];
  if (!firstImage?.url) return false;

  // 幂等：已挂分析结果（重跑复用持久化 twitter_info 时）不重复分析
  if (twitterInfo.image_analysis) return true;

  const imageUrl = firstImage.url;
  const apiKeyEnv = vision.apiKeyEnv || 'SILICONFLOW_FALLBACK_KEY';
  const apiKey = process.env[apiKeyEnv];
  if (!vision.baseUrl || !vision.model || !apiKey) {
    throw new Error(`vision 配置残缺：baseUrl=${vision.baseUrl} model=${vision.model} ${apiKeyEnv}=${apiKey ? '已配置' : '缺失'}`);
  }

  // 1) 缓存命中直接挂（用户约束 1：同图不重复分析；版本不符视为 miss）
  const cached = await ExternalResourceCache.get(imageUrl, CACHE_RESOURCE_TYPE, {
    maxAge: vision.cacheTtlSec || 90 * 24 * 60 * 60,
  });
  if (cached && cached.promptVersion === IMAGE_PROMPT_VERSION && cached.analysis) {
    twitterInfo.image_analysis = cached;
    logger.info('ImageAnalysis', `缓存命中，跳过视觉分析: ${imageUrl}`);
    return true;
  }

  // 2) in-flight 去重：并发同图共享一次调用
  let promise = inflight.get(imageUrl);
  if (!promise) {
    promise = _analyzeOnce(imageUrl, twitterInfo, vision, apiKey)
      .finally(() => inflight.delete(imageUrl));
    inflight.set(imageUrl, promise);
  }
  const result = await promise;

  // 失败（null）不写缓存——下次分析自然重试
  if (!result) return false;

  twitterInfo.image_analysis = result;
  await ExternalResourceCache.set(imageUrl, CACHE_RESOURCE_TYPE, result, {
    ttl: vision.cacheTtlSec || 90 * 24 * 60 * 60,
  });
  return true;
}

/**
 * 单次完整分析（下载 → 视觉 API → 解析）；任何一步失败返回 null（不 throw）
 */
async function _analyzeOnce(imageUrl, twitterInfo, vision, apiKey) {
  const startedAt = Date.now();
  try {
    // format:'jpeg'——压缩输出必须是 jpeg（webp 被智谱端点静默丢弃，见头注释）
    const imageData = await ImageDownloader.downloadAsBase64(imageUrl, { format: 'jpeg' });
    if (!imageData) {
      logger.warn('ImageAnalysis', `图片下载失败，跳过（语料不含图片证据）: ${imageUrl}`);
      return null;
    }

    const prompt = _buildPrompt(twitterInfo);
    const rawText = await _callVision(vision, apiKey, imageData, prompt);

    const analysis = _parseAnalysis(rawText);
    logger.info('ImageAnalysis', `视觉分析完成 ${Date.now() - startedAt}ms model=${vision.model} 压缩=${imageData.compressed ? '是' : '否'}: ${imageUrl}`);
    return {
      url: imageUrl,
      analysis,
      model: vision.model,
      promptVersion: IMAGE_PROMPT_VERSION,
      analyzedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.warn('ImageAnalysis', `视觉分析失败，语料不含图片证据（下次重试）: ${error.message}`);
    return null;
  }
}

/**
 * 视觉分析 prompt：推文文字 + 配图，产出与 twitter-section 渲染块同构的结构化字段
 * （description/key_elements/meme_type/meme_meaning）。
 *
 * ★刻意不含 token 名（跨 token 缓存健全性）：缓存按图片 URL 键控，复蹭簇里多个
 * token 共享同一张图——分析一旦掺入 token 名，token B 会拿到为 token A 算的关联
 * 结论（毒缓存）。视觉层只做 token 无关的图像感知，指代判定留给 Jev 的
 * name_referent 题（[TOKEN] 头 + 图片描述天然在那儿对上）。token_relevance 字段
 * 因此恒空（渲染块判 truthy 跳过）。
 */
function _buildPrompt(twitterInfo) {
  const author = twitterInfo?.author_screen_name || '';
  const tweetText = (twitterInfo?.text || '').slice(0, 500);
  return `你是meme币叙事分析助手。请分析这条推文的配图。

推文作者：@${author}
推文文字：${tweetText}

要求：严格以图中实际可见内容为准——读不清的文字就明说读不清，绝不允许编造（这是叙事判定的证据，编造会导致误判）。

只输出如下 JSON（不要输出其他内容，不要markdown代码块）：
{
  "description": "图片内容一段话描述",
  "key_elements": ["图中的关键元素/形象/可读文字，逐项列出"],
  "meme_type": "梗图类型（POV/对比图/排行榜截图/表情包等，非梗图写'非梗图'）",
  "meme_meaning": "这张图在传播的情绪或含义"
}`;
}

/**
 * 调用 SiliconFlow OpenAI 兼容端点；429/5xx/网络错误短退避重试
 * @returns {Promise<string>} 模型文本输出
 */
async function _callVision(vision, apiKey, imageData, prompt) {
  const maxRetries = vision.retryCount ?? 2;
  const timeoutMs = vision.timeoutMs || 30000;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];
      await new Promise(r => setTimeout(r, backoff));
      logger.warn('ImageAnalysis', `第 ${attempt} 次重试: ${lastError.message}`);
    }

    const result = await _singleVisionCall(vision.baseUrl, vision.model, apiKey, imageData, prompt, timeoutMs, vision.maxTokens || 1500);
    if (result.ok) return result.text;

    lastError = result.error;
    logger.warn('ImageAnalysis', `调用失败 attempt=${attempt} retryable=${result.retryable}: ${lastError.message}`);
    if (!result.retryable) throw lastError;
  }
  throw lastError;
}

/**
 * 单次视觉调用（不发日志、不重试）。OpenAI 兼容格式：
 * POST {baseUrl}/chat/completions，Authorization Bearer，content 数组
 * image_url（data URI）+ text；响应取 choices[0].message.content。
 * @returns {Promise<{ok:true, text:string} | {ok:false, error:Error, retryable:boolean}>}
 */
async function _singleVisionCall(baseUrl, model, apiKey, imageData, prompt, timeoutMs, maxTokens) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${imageData.mimeType};base64,${imageData.base64}` } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`HTTP ${response.status}: ${errorText.substring(0, 300)}`);
      // 429 限速与 5xx 服务端错误可重试；其余 4xx 是请求本身错误（与 JevClient 同语义）
      return { ok: false, error, retryable: response.status === 429 || response.status >= 500 };
    }

    const body = await response.json();
    // 实测 SiliconFlow content 为字符串（A/B 脚本 tmp_ab_qwen_captioner.mjs）；
    // 形状漂移走 fail-loud（不写缓存下次重试），不做数组形状兜底
    const text = (typeof body.choices?.[0]?.message?.content === 'string'
      ? body.choices[0].message.content : '').trim();
    if (!text) {
      return { ok: false, error: new Error('响应无文本（choices[0].message.content 空）'), retryable: false };
    }
    return { ok: true, text };
  } catch (e) {
    clearTimeout(timeoutId);
    const error = e.name === 'AbortError' ? new Error(`请求超时（${timeoutMs / 1000}秒）`) : e;
    // 网络抖动（fetch 异常）与超时可重试
    return { ok: false, error, retryable: true };
  }
}

/**
 * 解析模型输出为渲染器同构形状；解析失败降级为 { description: 原文 }（原文保留进
 * state，不丢证据不掩盖），key_elements/meme_type 等字段缺省为空
 */
function _parseAnalysis(rawText) {
  // 容错剥掉可能的 ```json 围栏
  const stripped = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(stripped);
    return {
      description: typeof parsed.description === 'string' ? parsed.description : '',
      key_elements: Array.isArray(parsed.key_elements) ? parsed.key_elements.map(String) : [],
      meme_type: typeof parsed.meme_type === 'string' ? parsed.meme_type : '',
      meme_meaning: typeof parsed.meme_meaning === 'string' ? parsed.meme_meaning : '',
    };
  } catch {
    logger.warn('ImageAnalysis', `JSON 解析失败，整段原文进 description: ${stripped.slice(0, 100)}`);
    return { description: stripped, key_elements: [], meme_type: '', meme_meaning: '' };
  }
}
