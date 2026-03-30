#!/usr/bin/env node
/**
 * 测试不同LLM模型的叙事分析耗时
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: resolve(__dirname, 'config/.env') });

// 导入 NarrativeAnalyzer
const { NarrativeAnalyzer } = await import('./src/narrative/analyzer/NarrativeAnalyzer.mjs');

const TEST_ADDRESS = '0x21f747229fce07e4545732d881ee7bb5d9e24444'; // pfp代币

const MODELS = [
  // DeepSeek V3 - 深度思考 vs 非深度思考
  'Pro/deepseek-ai/DeepSeek-V3',      // 深度思考版本
  'deepseek-ai/DeepSeek-V3',          // 非深度思考版本
  // DeepSeek V3.2 - 深度思考 vs 非深度思考
  'Pro/deepseek-ai/DeepSeek-V3.2',    // 深度思考版本
  'deepseek-ai/DeepSeek-V3.2',        // 非深度思考版本
  // 其他模型
  'Pro/zai-org/GLM-5',
  'Pro/MiniMaxAI/MiniMax-M2.5'
];

function formatDuration(seconds) {
  return typeof seconds === 'number' ? seconds.toFixed(1) : '0.0';
}

async function testModel(model) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`测试模型: ${model}`);
  console.log(`代币地址: ${TEST_ADDRESS}`);
  console.log('开始时间:', new Date().toLocaleString('zh-CN'));

  // 设置环境变量
  process.env.LLM_MODEL = model;

  const startTime = Date.now();
  let stage1Duration = 0;
  let stage2Duration = 0;
  let stage1Passed = false;
  let stage2Category = 'N/A';
  let success = true;
  let error = null;

  try {
    // 先测试 Stage 1
    console.log('\n--- Stage 1 测试 ---');
    const stage1Start = Date.now();
    const stage1Result = await NarrativeAnalyzer.analyzeStage1(TEST_ADDRESS, {
      ignoreCache: true,
      experimentId: null
    });
    stage1Duration = (Date.now() - stage1Start) / 1000;

    console.log(`Stage 1 完成:`);
    console.log(`  - 耗时: ${formatDuration(stage1Duration)}秒`);
    console.log(`  - 通过: ${stage1Result.pass ? '是' : '否'}`);

    stage1Passed = stage1Result.pass;

    // 如果 Stage 1 通过，测试 Stage 2
    if (stage1Result.pass) {
      console.log('\n--- Stage 2 测试 ---');
      const stage2Start = Date.now();
      const stage2Result = await NarrativeAnalyzer.analyzeStage2(TEST_ADDRESS, {
        experimentId: null
      });
      stage2Duration = (Date.now() - stage2Start) / 1000;

      console.log(`Stage 2 完成:`);
      console.log(`  - 耗时: ${formatDuration(stage2Duration)}秒`);
      console.log(`  - 评级: ${stage2Result.category}`);

      stage2Category = stage2Result?.category || 'N/A';
    }

  } catch (e) {
    success = false;
    error = e.message;
    console.error(`\n❌ 错误: ${e.message}`);
    stage1Duration = (Date.now() - startTime) / 1000;
  }

  const totalDuration = (Date.now() - startTime) / 1000;

  return {
    model,
    stage1Duration: formatDuration(stage1Duration),
    stage2Duration: formatDuration(stage2Duration),
    totalDuration: formatDuration(totalDuration),
    stage1Passed,
    stage2Category,
    success,
    error
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('LLM模型叙事分析耗时测试');
  console.log('测试地址:', TEST_ADDRESS);
  console.log('开始时间:', new Date().toLocaleString('zh-CN'));

  const results = [];

  for (const model of MODELS) {
    const result = await testModel(model);
    results.push(result);

    // 等待一下避免API限流
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  console.log('\n\n' + '='.repeat(90));
  console.log('测试结果汇总');
  console.log('='.repeat(90));
  console.log(`模型${' '.repeat(38)} | Stage 1 | Stage 2 | 总计   | 结果`);
  console.log('-'.repeat(90));

  for (const r of results) {
    const model = r.model.padEnd(40);
    const s1 = String(r.stage1Duration).padStart(7) + 's';
    const s2 = String(r.stage2Duration).padStart(7) + 's';
    const total = String(r.totalDuration).padStart(6) + 's';
    const result = r.success ?
      (r.stage1Passed ? `通过 - 评级: ${r.stage2Category}` : 'S1未通过') :
      `错误: ${r.error?.substring(0, 30) || 'Unknown'}`;
    console.log(`${model} | ${s1} | ${s2} | ${total} | ${result}`);
  }

  console.log('\n完成时间:', new Date().toLocaleString('zh-CN'));
}

main().catch(console.error);
