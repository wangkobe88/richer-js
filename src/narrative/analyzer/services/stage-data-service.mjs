/**
 * Stage Data Service - Stage数据保存服务
 * 处理 Stage 1 和 Stage 2 数据的保存
 * 使用统一 result JSONB 格式：{ rating, pass, reason, category, score, model, startedAt, finishedAt, success, error, details }
 */

import { NarrativeRepository } from '../../db/NarrativeRepository.mjs';

/**
 * 将旧的 stage 数据格式转换为新统一 result 格式
 * 旧格式: { category, model, prompt, raw_output, parsed_output, started_at, finished_at, success, error }
 * 新格式: stage1_result / stage1_prompt / stage1_raw_output
 */
function buildStageSaveData(stageName, stageData, overrides = {}) {
  if (!stageData || stageData.__clear) {
    return { [`${stageName}_result`]: { __clear: true } };
  }

  const result = {
    rating: overrides.rating ?? null,
    pass: overrides.pass ?? null,
    reason: overrides.reason ?? stageData.parsed_output?.reason ?? stageData.parsed_output?.blockReason ?? null,
    category: overrides.category ?? stageData.category ?? null,
    score: overrides.score ?? null,
    model: stageData.model || null,
    startedAt: stageData.started_at || null,
    finishedAt: stageData.finished_at || null,
    success: stageData.success ?? null,
    error: stageData.error || null,
    details: overrides.details ?? stageData.parsed_output ?? null,
  };

  return {
    [`${stageName}_result`]: result,
    [`${stageName}_prompt`]: stageData.prompt || null,
    [`${stageName}_raw_output`]: stageData.raw_output || null,
  };
}

/**
 * 保存 Stage 1 数据到数据库
 * @param {string} normalizedAddress - 代币地址
 * @param {Object} tokenData - 代币数据
 * @param {Object} extractedInfo - 提取的信息
 * @param {Object} twitterInfo - Twitter信息
 * @param {Object} classifiedUrls - 分类后的URL
 * @param {string} experimentId - 实验ID
 * @param {Object} stage1Result - Stage 1 结果（已不使用，保留参数签名兼容）
 * @param {Object} urlExtractionResult - URL提取结果
 * @param {Object} dataFetchResults - 数据获取结果
 * @param {Object} stage1DataToSave - Stage 1 完整数据（可选）
 * @param {Object} preCheckDataToSave - 预检查数据（可选）
 * @returns {Promise<void>}
 */
export async function saveStage1Data(normalizedAddress, tokenData, extractedInfo, twitterInfo, classifiedUrls, experimentId, stage1Result, urlExtractionResult, dataFetchResults, stage1DataToSave = null, preCheckDataToSave = null) {
  const { cleanDataForDB } = await import('../utils/data-cleaner.mjs');

  const cleanedTwitterInfo = cleanDataForDB(twitterInfo);

  const saveData = {
    token_address: normalizedAddress,
    token_symbol: tokenData.symbol,
    raw_api_data: tokenData.raw_api_data,
    extracted_info: extractedInfo,
    twitter_info: cleanedTwitterInfo,
    classified_urls: classifiedUrls,
    analyzed_at: new Date().toISOString(),
    experiment_id: experimentId,
    url_extraction_result: urlExtractionResult,
    data_fetch_results: dataFetchResults,

    // === 预检查字段 ===
    pre_check_result: preCheckDataToSave || null,

    // === Stage 1 字段（统一 result 格式）===
    ...buildStageSaveData('stage1', stage1DataToSave),
  };

  await NarrativeRepository.save(saveData);
}

/**
 * 保存 Stage 2 数据到数据库
 * @param {string} normalizedAddress - 代币地址
 * @param {string} experimentId - 实验ID
 * @param {Object} stage2Result - Stage 2 结果（已不使用，保留参数签名兼容）
 * @param {Object} stage2DataToSave - Stage 2 完整数据（包含 model, raw_output 等）
 * @returns {Promise<void>}
 */
export async function saveStage2Data(normalizedAddress, experimentId, stage2Result, stage2DataToSave = null) {
  const saveData = {
    token_address: normalizedAddress,
    experiment_id: experimentId,
    analyzed_at: new Date().toISOString(),

    // === Stage 2 字段（统一 result 格式）===
    ...buildStageSaveData('stage2', stage2DataToSave),
  };

  await NarrativeRepository.save(saveData);
}
