import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '../../config/.env' });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkNarrativeFields() {
  console.log('=== 检查代币叙事相关字段 ===\n');

  // 检查实验代币中的叙事字段
  const { data: tokens, error } = await client
    .from('experiment_tokens')
    .select('token_address, token_symbol, raw_api_data')
    .limit(20);

  if (error) {
    console.log('ERROR:', error);
    return;
  }

  const stats = {
    total: tokens.length,
    withDescription: 0,
    withIntroCn: 0,
    withIntroEn: 0,
    withAnyNarrative: 0
  };

  const examples = {
    description: null,
    introCn: null,
    introEn: null
  };

  console.log('样本分析：\n');

  tokens.forEach(token => {
    const rawData = token.raw_api_data || {};

    // 检查 appendix
    let appendix = rawData.appendix;
    if (typeof appendix === 'string') {
      try { appendix = JSON.parse(appendix); } catch(e) { appendix = rawData.appendix; }
    }

    let hasNarrative = false;
    const narrative = {
      description: null,
      introCn: null,
      introEn: null
    };

    // 从 appendix 提取
    if (typeof appendix === 'object' && appendix !== null) {
      if (appendix.description) {
        narrative.description = appendix.description;
        stats.withDescription++;
        if (!examples.description) examples.description = { symbol: token.token_symbol, text: appendix.description };
      }
      if (appendix.intro_cn) {
        narrative.introCn = appendix.intro_cn;
        stats.withIntroCn++;
        if (!examples.introCn) examples.introCn = { symbol: token.token_symbol, text: appendix.intro_cn };
      }
      if (appendix.intro_en) {
        narrative.introEn = appendix.intro_en;
        stats.withIntroEn++;
        if (!examples.introEn) examples.introEn = { symbol: token.token_symbol, text: appendix.intro_en };
      }
    }

    // 直接从 raw_api_data 提取
    if (!narrative.description && rawData.description) {
      narrative.description = rawData.description;
      stats.withDescription++;
    }
    if (!narrative.introCn && rawData.intro_cn) {
      narrative.introCn = rawData.intro_cn;
      stats.withIntroCn++;
    }
    if (!narrative.introEn && rawData.intro_en) {
      narrative.introEn = rawData.intro_en;
      stats.withIntroEn++;
    }

    if (narrative.description || narrative.introCn || narrative.introEn) {
      stats.withAnyNarrative++;
    }
  });

  console.log(`总样本数: ${stats.total}`);
  console.log(`有 description: ${stats.withDescription} (${(stats.withDescription/stats.total*100).toFixed(1)}%)`);
  console.log(`有 intro_cn: ${stats.withIntroCn} (${(stats.withIntroCn/stats.total*100).toFixed(1)}%)`);
  console.log(`有 intro_en: ${stats.withIntroEn} (${(stats.withIntroEn/stats.total*100).toFixed(1)}%)`);
  console.log(`有任意叙事字段: ${stats.withAnyNarrative} (${(stats.withAnyNarrative/stats.total*100).toFixed(1)}%)`);

  console.log('\n=== 示例 ===\n');

  if (examples.description) {
    console.log(`description (${examples.description.symbol}):`);
    console.log(`  ${examples.description.text.substring(0, 150)}...\n`);
  }
  if (examples.introCn) {
    console.log(`intro_cn (${examples.introCn.symbol}):`);
    console.log(`  ${examples.introCn.text.substring(0, 150)}...\n`);
  }
  if (examples.introEn) {
    console.log(`intro_en (${examples.introEn.symbol}):`);
    console.log(`  ${examples.introEn.text.substring(0, 150)}...\n`);
  }

  return stats;
}

checkNarrativeFields().catch(console.error);
