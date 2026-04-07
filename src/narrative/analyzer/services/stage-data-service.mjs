/**
 * Stage Data Service - Stage数据保存服务
 * 处理 Stage 1 和 Stage 2 数据的保存
 */

import { NarrativeRepository } from '../../db/NarrativeRepository.mjs';

/**
 * 保存 Stage 1 数据到数据库
 * @param {string} normalizedAddress - 代币地址
 * @param {Object} tokenData - 代币数据
 * @param {Object} extractedInfo - 提取的信息
 * @param {Object} twitterInfo - Twitter信息
 * @param {Object} classifiedUrls - 分类后的URL
 * @param {string} experimentId - 实验ID
 * @param {Object} stage1Result - Stage 1 结果
 * @param {Object} urlExtractionResult - URL提取结果
 * @param {Object} dataFetchResults - 数据获取结果
 * @param {Object} stage1DataToSave - Stage 1 完整数据（可选）
 * @param {Object} preCheckDataToSave - 预检查数据（可选）
 * @returns {Promise<void>}
 */
export async function saveStage1Data(normalizedAddress, tokenData, extractedInfo, twitterInfo, classifiedUrls, experimentId, stage1Result, urlExtractionResult, dataFetchResults, stage1DataToSave = null, preCheckDataToSave = null) {
  // 需要从原始类导入 _cleanDataForDB 方法
  // 由于我们已经创建了 data-cleaner.mjs，我们需要导入它
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

    // === 预检查字段（3个）===
    pre_check_category: preCheckDataToSave?.category || null,
    pre_check_reason: preCheckDataToSave?.reason || null,
    pre_check_result: preCheckDataToSave?.result || null
  };

  // 如果提供了完整的 Stage 1 数据，保存所有字段
  if (stage1DataToSave) {
    saveData.llm_stage1_category = stage1DataToSave.category;
    saveData.llm_stage1_model = stage1DataToSave.model;
    saveData.llm_stage1_prompt = stage1DataToSave.prompt;
    saveData.llm_stage1_raw_output = stage1DataToSave.raw_output;
    saveData.llm_stage1_parsed_output = stage1DataToSave.parsed_output;
    saveData.llm_stage1_started_at = stage1DataToSave.started_at;
    saveData.llm_stage1_finished_at = stage1DataToSave.finished_at;
    saveData.llm_stage1_success = stage1DataToSave.success;
    saveData.llm_stage1_error = stage1DataToSave.error;
  } else {
    // 兼容旧逻辑：只保存 stage1Result 中的字段
    saveData.llm_stage1_category = stage1Result.category;
    saveData.llm_stage1_started_at = stage1Result.started_at;
    saveData.llm_stage1_finished_at = stage1Result.finished_at;
    saveData.llm_stage1_success = stage1Result.success;
    saveData.llm_stage1_error = stage1Result.error;
  }

  await NarrativeRepository.save(saveData);
}

/**
 * 保存 Stage 2 数据到数据库
 * @param {string} normalizedAddress - 代币地址
 * @param {string} experimentId - 实验ID
 * @param {Object} stage2Result - Stage 2 结果（简化版，用于返回）
 * @param {Object} stage2DataToSave - Stage 2 完整数据（包含 model, raw_output 等）
 * @returns {Promise<void>}
 */
export async function saveStage2Data(normalizedAddress, experimentId, stage2Result, stage2DataToSave = null) {
  const saveData = {
    token_address: normalizedAddress,
    experiment_id: experimentId,
    analyzed_at: new Date().toISOString()
  };

  // 如果提供了完整的 Stage 2 数据，保存所有字段
  if (stage2DataToSave) {
    saveData.llm_stage2_category = stage2DataToSave.category;
    saveData.llm_stage2_model = stage2DataToSave.model;
    saveData.llm_stage2_prompt = stage2DataToSave.prompt;
    saveData.llm_stage2_raw_output = stage2DataToSave.raw_output;
    saveData.llm_stage2_parsed_output = stage2DataToSave.parsed_output;
    saveData.llm_stage2_started_at = stage2DataToSave.started_at;
    saveData.llm_stage2_finished_at = stage2DataToSave.finished_at;
    saveData.llm_stage2_success = stage2DataToSave.success;
    saveData.llm_stage2_error = stage2DataToSave.error;
  } else {
    // 兼容旧逻辑：只保存 stage2Result 中的字段
    saveData.llm_stage2_category = stage2Result.category;
    saveData.llm_stage2_started_at = stage2Result.started_at;
    saveData.llm_stage2_finished_at = stage2Result.finished_at;
    saveData.llm_stage2_success = stage2Result.success;
    saveData.llm_stage2_error = stage2Result.error;
  }

  await NarrativeRepository.save(saveData);
}
