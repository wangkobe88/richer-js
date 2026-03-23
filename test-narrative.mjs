#!/usr/bin/env node
/**
 * 测试叙事分析
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: join(__dirname, 'config/.env') });

import { NarrativeRepository } from './src/narrative/db/NarrativeRepository.mjs';
import { NarrativeAnalyzer } from './src/narrative/analyzer/NarrativeAnalyzer.mjs';

const address = '0xcdce5c436c77fb5bf085a0157528d892e5d64444';

async function main() {
  try {
    // 先查看现有记录
    const cached = await NarrativeRepository.findByAddress(address);
    if (cached) {
      console.log('=== 现有记录 ===');
      console.log('prompt_version:', cached.prompt_version);
      console.log('prompt_type:', cached.prompt_type);
      console.log('llm_category:', cached.llm_category);
      console.log('llm_summary:', JSON.stringify(cached.llm_summary, null, 2));
      console.log('twitter_info type:', cached.twitter_info?.type);
      console.log('twitter_info media:', JSON.stringify(cached.twitter_info?.media, null, 2));
    } else {
      console.log('未找到现有记录');
    }

    // 使用 ignoreCache=true 强制重新分析
    console.log('\n=== 重新分析（新Prompt V6.0）===');
    const result = await NarrativeAnalyzer.analyze(address, { ignoreCache: true });
    console.log('promptType:', result.meta?.promptType);
    console.log('promptVersion:', result.meta?.promptVersion);
    console.log('category:', result.llmAnalysis?.category);
    console.log('total_score:', result.llmAnalysis?.summary?.total_score);
    console.log('reasoning:', result.llmAnalysis?.summary?.reasoning);
    console.log('scores:', result.llmAnalysis?.raw?.scores);
  } catch (error) {
    console.error('错误:', error.message);
    console.error(error.stack);
  }
}

main();
