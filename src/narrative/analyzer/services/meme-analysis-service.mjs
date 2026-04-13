/**
 * Meme Analysis Service - Meme代币分析服务
 * 处理meme币的两阶段分析和图片分析
 */

import logger from '../../core/logger.mjs';
import { LLMClient } from '../llm/llm-api-client.mjs';
import { PromptBuilder } from '../prompt-builder.mjs';
import { parseEventResponse } from '../parsers/response-parser.mjs';
import { ImageDownloader } from '../../utils/image-downloader.mjs';
import { safeSubstring } from '../utils/data-cleaner.mjs';

/**
 * 执行meme币两阶段分析（用于账号/社区分析判断为meme币后的分流）
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的数据结果（包含accountSummary）
 * @param {Object} stage1Info - 第一阶段信息（账号分析，不保存）
 * @returns {Promise<Object>} 分析结果
 */
export async function analyzeMemeTokenTwoStage(tokenData, fetchResults, stage1Info) {
  logger.info('MemeTokenAnalysis', '开始meme币两阶段分析');

  // 事件分析（对应代币的第一阶段）
  logger.debug('MemeTokenAnalysis', '开始事件分析');
  const eventPrompt = PromptBuilder.buildEventAnalysis(tokenData, fetchResults);
  const eventPromptType = PromptBuilder.getPromptTypeDesc(fetchResults, 1);

  const eventCallResult = await LLMClient.analyzeWithMetadata(eventPrompt);

  if (!eventCallResult.success) {
    throw new Error(`事件分析LLM调用失败: ${eventCallResult.error}`);
  }

  const eventData = parseEventResponse(eventCallResult.raw.raw);

  if (!eventData.pass) {
    // 事件分析未通过，直接返回
    logger.info('MemeTokenAnalysis', '事件分析未通过', {
      reason: eventData.reason
    });

    return {
      category: 'low',
      reasoning: eventData.reason,
      scores: null,
      total_score: null,
      // 添加规则验证结果
      addressVerified: stage1Info.rulesResult?.addressVerified,
      nameMatch: stage1Info.rulesResult?.nameMatch,
      // 只保存事件分析到stage1，不保存账号分析
      stage1Data: {
        category: 'low', // 事件分析未通过
        prompt: eventPrompt,
        raw_output: eventCallResult.raw.raw,
        parsed_output: {
          ...eventData,
          // 添加规则验证结果到parsed_output
          addressVerified: stage1Info.rulesResult?.addressVerified,
          nameMatch: stage1Info.rulesResult?.nameMatch,
          details: stage1Info.rulesResult?.details
        },
        model: eventCallResult.model,
        started_at: eventCallResult.startedAt,
        finished_at: eventCallResult.finishedAt,
        success: eventCallResult.success,
        error: eventCallResult.error
      },
      // 事件分析未通过，没有stage2
      stage2Data: null
    };
  }

  // 事件分析通过，进入代币分析（对应代币的第二阶段）
  logger.info('MemeTokenAnalysis', '事件分析通过，进入代币分析');

  // 先准备Stage1数据（即使Stage2失败也要保存Stage1）
  const stage1Data = {
    category: 'pass', // 事件分析通过，标记为pass
    prompt: eventPrompt,
    raw_output: eventCallResult.raw.raw,
    parsed_output: {
      ...eventData,
      // 添加规则验证结果到parsed_output
      addressVerified: stage1Info.rulesResult?.addressVerified,
      nameMatch: stage1Info.rulesResult?.nameMatch,
      details: stage1Info.rulesResult?.details
    },
    model: eventCallResult.model,
    started_at: eventCallResult.startedAt,
    finished_at: eventCallResult.finishedAt,
    success: eventCallResult.success,
    error: eventCallResult.error
  };

  const tokenPrompt = PromptBuilder.buildTokenAnalysis(tokenData, fetchResults, eventData.eventAnalysis);
  const tokenPromptType = PromptBuilder.getPromptTypeDesc(fetchResults, 2);

  const tokenCallResult = await LLMClient.analyzeWithMetadata(tokenPrompt);

  // 准备Stage2数据（无论成功还是失败）
  const stage2Data = {
    category: tokenCallResult.parsed?.category || null,
    prompt: tokenPrompt,
    raw_output: tokenCallResult.raw?.raw || tokenCallResult.raw || null,
    parsed_output: tokenCallResult.parsed,
    model: tokenCallResult.model,
    started_at: tokenCallResult.startedAt,
    finished_at: tokenCallResult.finishedAt,
    success: tokenCallResult.success,
    error: tokenCallResult.error
  };

  if (!tokenCallResult.success) {
    // Stage2失败，返回Stage1的结果
    logger.warn('MemeTokenAnalysis', `代币分析失败，仅返回Stage1结果: ${tokenCallResult.error}`);
    return {
      category: 'unrated',
      reasoning: `事件分析通过，但代币分析失败: ${tokenCallResult.error}`,
      scores: null,
      total_score: null,
      analysis_stage: 1,
      // 添加规则验证结果
      addressVerified: stage1Info.rulesResult?.addressVerified,
      nameMatch: stage1Info.rulesResult?.nameMatch,
      // 保存事件分析到stage1
      stage1Data: stage1Data,
      // Stage2失败，记录失败信息
      stage2Data: stage2Data
    };
  }

  // 返回最终结果
  return {
    ...tokenCallResult.parsed,
    // 添加规则验证结果
    addressVerified: stage1Info.rulesResult?.addressVerified,
    nameMatch: stage1Info.rulesResult?.nameMatch,
    // 保存事件分析到stage1，代币分析到stage2
    // 账号分析不保存（stage1Info中的数据不使用）
    stage1Data: stage1Data,
    stage2Data: stage2Data
  };
}

/**
 * 为高影响力账号的推文图片进行分析
 * @param {Array} images - 图片列表 [{url, width, height, media_key}]
 * @param {Object} tokenData - 代币数据
 * @returns {Promise<Object|null>} 图片分析结果
 */
export async function analyzeImagesForHighInfluenceAccount(images, tokenData) {
  const tokenSymbol = tokenData.symbol || '';
  const tokenName = tokenData.raw_api_data?.name || tokenData.name || '';
  const tokenIntro = tokenData.raw_api_data?.intro_en || tokenData.raw_api_data?.intro_cn || '';
  const tokenAddress = tokenData.address || '';

  // 最多分析3张图片
  const maxImages = Math.min(images.length, 3);
  const analysisResults = [];
  const startTime = Date.now();

  console.log(`[NarrativeAnalyzer] 开始分析 ${maxImages}/${images.length} 张图片（代币: ${tokenSymbol}）`);

  for (let i = 0; i < maxImages; i++) {
    const imageUrl = images[i].url;
    const imageStartTime = Date.now();

    console.log(`[NarrativeAnalyzer] [${i + 1}/${maxImages}] 下载图片: ${imageUrl}`);

    try {
      // 下载图片
      const imageData = await ImageDownloader.downloadAsBase64(imageUrl, {
        maxSize: 5 * 1024 * 1024,  // 5MB
        timeout: 15000  // 15秒下载超时
      });

      if (!imageData) {
        console.warn(`[NarrativeAnalyzer] [${i + 1}/${maxImages}] 图片下载失败: ${imageUrl}`);
        continue;
      }

      const downloadTime = Date.now() - imageStartTime;
      console.log(`[NarrativeAnalyzer] [${i + 1}/${maxImages}] 下载完成 (${downloadTime}ms, ${imageData.size}字节)`);

      // 构建分析 prompt
      const prompt = `你是代币叙事分析专家。请分析这张图片与代币"${tokenSymbol}"的关系。

【代币信息】
- Symbol: ${tokenSymbol}
${tokenName ? `- Name: ${tokenName}` : ''}
${tokenIntro ? `- 简介: ${tokenIntro}` : ''}
- 地址: ${tokenAddress.substring(0, 8)}...

【分析任务】
1. **图片内容描述**：详细描述图片中的主体、人物、动物、文字、符号等
2. **代币关联度评估**：图片内容与代币名称/Symbol是否有关联？说明关联方式
3. **meme/梗图识别**：是否是流行meme图？指出名称和含义
4. **营销信号**：图片是否呈现明显的营销设计风格？

【输出格式】（JSON）
{
  "description": "图片内容详细描述",
  "token_relevance": {
    "is_related": true/false,
    "reason": "关联/无关联的原因",
    "match_type": "symbol|name|concept|visual|none"
  },
  "meme_info": {
    "is_meme": true/false,
    "name": "meme名称（如果是）"
  },
  "marketing_signals": ["信号1", "信号2"]
}`;

      // 调用视觉模型分析图片
      const analysisStartTime = Date.now();
      const result = await LLMClient.analyzeImage(imageData.dataUrl, prompt, {
        model: 'Qwen/Qwen3-Omni-30B-A3B-Captioner',  // 使用快速模型 (约5秒)
        timeout: 20000,  // 20秒超时
        maxTokens: 2000
      });

      const analysisTime = Date.now() - analysisStartTime;

      // 解析结果
      let jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          analysisResults.push({
            image_url: imageUrl,
            analysis: parsed,
            timing: {
              download: downloadTime,
              analysis: analysisTime,
              total: downloadTime + analysisTime
            }
          });
          console.log(`[NarrativeAnalyzer] [${i + 1}/${maxImages}] 分析成功 (${analysisTime}ms): ${parsed.description?.substring(0, 40)}...`);
        } catch (e) {
          console.warn(`[NarrativeAnalyzer] [${i + 1}/${maxImages}] JSON解析失败: ${e.message}`);
          // 尝试使用原始内容
          analysisResults.push({
            image_url: imageUrl,
            analysis: {
              description: safeSubstring(result.content, 200),
              token_relevance: { is_related: false, reason: '解析失败' }
            },
            timing: {
              download: downloadTime,
              analysis: analysisTime,
              total: downloadTime + analysisTime
            }
          });
        }
      }

    } catch (error) {
      const errorTime = Date.now() - imageStartTime;
      console.error(`[NarrativeAnalyzer] [${i + 1}/${maxImages}] 分析失败 (${errorTime}ms): ${error.message}`);
    }
  }

  const totalTime = Date.now() - startTime;

  if (analysisResults.length === 0) {
    console.log(`[NarrativeAnalyzer] 所有图片分析失败（总耗时: ${totalTime}ms）`);
    return null;
  }

  console.log(`[NarrativeAnalyzer] 图片分析完成: 成功 ${analysisResults.length}/${maxImages}张，总耗时 ${totalTime}ms`);

  return {
    images_analyzed: analysisResults.length,
    total_time_ms: totalTime,
    results: analysisResults
  };
}
