#!/usr/bin/env node
/**
 * 测试豆包模型叙事分析速度
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: resolve(__dirname, 'config/.env') });

// 导入所需模块
const { NarrativeAnalyzer } = await import('./src/narrative/analyzer/NarrativeAnalyzer.mjs');
const { PromptBuilder } = await import('./src/narrative/analyzer/prompt-builder.mjs');
const { TwitterFetcher } = await import('./src/narrative/utils/twitter-fetcher.mjs');
const { fetchWebsiteContent } = await import('./src/narrative/utils/web-fetcher.mjs');

const TEST_ADDRESS = '0x21f747229fce07e4545732d881ee7bb5d9e24444'; // pfp代币

// 豆包模型配置
const DOUBAO_MODELS = [
  { name: 'Doubao Pro', model: 'doubao-seed-2-0-pro-260215' },
  { name: 'Doubao Lite', model: 'doubao-seed-2-0-lite-260215' }
];

const DOUBAO_CONFIG = {
  apiUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  apiKey: '9517d21e-5fe6-46ad-b737-ce4fc0e88ffa'
};

function formatDuration(seconds) {
  return typeof seconds === 'number' ? seconds.toFixed(1) : '0.0';
}

/**
 * 获取叙事分析数据
 */
async function fetchNarrativeData(address) {
  console.log('\n获取代币数据...');

  const tokenData = await NarrativeAnalyzer.fetchTokenData(address);
  if (!tokenData) {
    throw new Error('代币不存在');
  }

  console.log(`代币符号: ${tokenData.symbol}`);
  console.log(`代币名: ${tokenData.raw_api_data?.name || 'N/A'}`);

  const rawData = tokenData.raw_api_data || {};
  const appendix = rawData.appendix ? JSON.parse(rawData.appendix) : {};

  console.log(`Twitter URL: ${appendix.twitter || 'N/A'}`);
  console.log(`Website URL: ${appendix.website || 'N/A'}`);

  // 获取各种数据源
  const fetchResults = {};

  // Twitter
  if (appendix.twitter) {
    try {
      console.log('\n获取 Twitter 数据...');
      const twitterInfo = await TwitterFetcher.fetchFromUrls(appendix.twitter, null);
      if (twitterInfo) {
        fetchResults.twitterInfo = twitterInfo;
        console.log(`Twitter: ${twitterInfo.type || 'N/A'} - ${twitterInfo.text?.substring(0, 50)}...`);
      }
    } catch (e) { console.log('Twitter: 失败 -', e.message); }
  }

  // Website
  if (appendix.website && appendix.website !== appendix.twitter) {
    try {
      console.log('\n获取 Website 数据...');
      const websiteInfo = await fetchWebsiteContent(appendix.website);
      if (websiteInfo) {
        fetchResults.websiteInfo = websiteInfo;
        console.log(`Website: OK - ${websiteInfo.title?.substring(0, 50)}...`);
      }
    } catch (e) { console.log('Website: 失败 -', e.message); }
  }

  return { tokenData, fetchResults };
}

/**
 * 调用豆包API
 */
async function callDoubao(prompt, stage, modelName) {
  const startTime = Date.now();

  console.log(`\n--- ${modelName} Stage ${stage} 开始 ---`);

  try {
    const response = await fetch(`${DOUBAO_CONFIG.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DOUBAO_CONFIG.apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0,
        max_tokens: 2000
      })
    });

    const duration = (Date.now() - startTime) / 1000;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('返回内容为空');
    }

    console.log(`${modelName} Stage ${stage} 完成: ${formatDuration(duration)}秒`);
    console.log(`Token使用: ${data.usage?.total_tokens || 'N/A'}`);

    return {
      success: true,
      content,
      duration,
      raw: data
    };

  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    console.error(`${modelName} Stage ${stage} 失败: ${error.message}`);
    return {
      success: false,
      error: error.message,
      duration
    };
  }
}

/**
 * 解析JSON响应
 */
function parseJsonResponse(content) {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    return null;
  }
}

/**
 * 测试单个豆包模型
 */
async function testDoubao(modelConfig, tokenData, fetchResults) {
  const startTime = Date.now();

  console.log(`开始时间: ${new Date().toLocaleString('zh-CN')}`);

  // 构建 Stage 1 prompt
  const stage1Prompt = PromptBuilder.buildStage1(tokenData, fetchResults);
  console.log(`Stage 1 Prompt 长度: ${stage1Prompt.length} 字符`);

  // 执行 Stage 1
  const stage1Result = await callDoubao(stage1Prompt, 1, modelConfig.model);

  if (!stage1Result.success) {
    return {
      model: modelConfig.name,
      stage1Duration: stage1Result.duration,
      stage2Duration: 0,
      totalDuration: (Date.now() - startTime) / 1000,
      stage1Passed: false,
      success: false,
      error: stage1Result.error
    };
  }

  // 解析 Stage 1 结果
  const stage1Data = parseJsonResponse(stage1Result.content);
  const stage1Passed = stage1Data?.pass === true;

  console.log(`\nStage 1 响应解析:`);
  console.log(`  - Pass: ${stage1Passed ? '是' : '否'}`);
  if (stage1Data) {
    console.log(`  - Category: ${stage1Data.category || 'N/A'}`);
    console.log(`  - Reason: ${(stage1Data.reason || '').substring(0, 100)}...`);
  }

  let stage2Duration = 0;
  let stage2Category = 'N/A';
  let stage2Scores = null;

  if (stage1Passed) {
    // 构建 Stage 2 prompt
    const stage2Prompt = PromptBuilder.buildStage2(tokenData, fetchResults);
    console.log(`\nStage 2 Prompt 长度: ${stage2Prompt.length} 字符`);

    // 执行 Stage 2
    const stage2Result = await callDoubao(stage2Prompt, 2, modelConfig.model);

    if (stage2Result.success) {
      stage2Duration = stage2Result.duration;

      const stage2Data = parseJsonResponse(stage2Result.content);
      if (stage2Data) {
        stage2Category = stage2Data.category || 'N/A';
        stage2Scores = stage2Data.scores || {};
        console.log(`\nStage 2 响应解析:`);
        console.log(`  - Category: ${stage2Category}`);
        console.log(`  - Total Score: ${stage2Data.total_score || 'N/A'}`);
      }
    }
  }

  const totalDuration = (Date.now() - startTime) / 1000;

  return {
    model: modelConfig.name,
    stage1Duration: formatDuration(stage1Result.duration),
    stage2Duration: formatDuration(stage2Duration),
    totalDuration: formatDuration(totalDuration),
    stage1Passed,
    stage2Category,
    stage2Scores,
    success: true
  };
}

async function main() {
  // 先获取一次数据（所有模型共用）
  const { tokenData, fetchResults } = await fetchNarrativeData(TEST_ADDRESS);

  console.log('\n\n' + '='.repeat(80));
  console.log('开始测试所有豆包模型');
  console.log('='.repeat(80));

  const results = [];

  for (const modelConfig of DOUBAO_MODELS) {
    console.log(`\n\n${'='.repeat(80)}`);
    console.log(`测试模型: ${modelConfig.name}`);
    console.log('='.repeat(80));

    const result = await testDoubao(modelConfig, tokenData, fetchResults);
    results.push(result);

    // 等待一下避免API限流
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // 打印汇总
  console.log('\n\n' + '='.repeat(100));
  console.log('测试结果汇总');
  console.log('='.repeat(100));
  console.log(`模型${' '.repeat(25)} | Stage 1 | Stage 2 | 总计   | S1结果 | S2评级`);
  console.log('-'.repeat(100));

  for (const r of results) {
    const model = r.model.padEnd(28);
    const s1 = String(r.stage1Duration).padStart(7) + 's';
    const s2 = String(r.stage2Duration).padStart(7) + 's';
    const total = String(r.totalDuration).padStart(6) + 's';
    const s1Result = r.stage1Passed ? '通过' : '未通过';
    const s2Category = r.stage2Category || 'N/A';
    console.log(`${model} | ${s1} | ${s2} | ${total} | ${s1Result.padEnd(6)} | ${s2Category}`);
  }

  console.log('='.repeat(100));
}

main().catch(console.error);
