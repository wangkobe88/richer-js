/**
 * 查询指定代币的叙事分析
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取 .env 文件
const envPath = resolve(__dirname, '../../../config/.env');
const envContent = readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
    process.env[key.trim()] = valueParts.join('=').trim();
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const address = '0xc85d67cc0dab53df1dd52e5209d9fcbae9a14444';

async function getNarrative() {
  // 先获取叙事分析
  const { data: narrative, error: narrError } = await supabase
    .from('token_narrative')
    .select('*')
    .eq('token_address', address.toLowerCase())
    .maybeSingle();

  if (narrError) {
    console.error('查询叙事失败:', narrError.message);
    return;
  }

  if (!narrative) {
    console.log('未找到叙事分析数据，尝试获取原始数据...');
  }

  // 获取原始代币数据
  const { data: tokenData, error: tokenError } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('token_address', address.toLowerCase())
    .maybeSingle();

  if (tokenError) {
    console.error('查询代币数据失败:', tokenError.message);
    return;
  }

  if (!tokenData) {
    console.log('未找到代币数据');
    return;
  }

  console.log('=== 代币信息 ===');
  console.log(`符号: ${tokenData.token_symbol}`);
  console.log(`地址: ${tokenData.token_address}`);
  console.log(`平台: ${tokenData.platform}`);

  const rawData = tokenData.raw_api_data || {};
  console.log(`\n名称: ${rawData.name || '无'}`);
  console.log(`英文介绍: ${rawData.intro_en || '无'}`);
  console.log(`中文介绍: ${rawData.intro_cn || '无'}`);
  console.log(`Website: ${rawData.website || '无'}`);
  console.log(`Twitter: ${rawData.twitterUrl || rawData.webUrl || '无'}`);

  let appendix = {};
  if (rawData.appendix) {
    if (typeof rawData.appendix === 'string') {
      try { appendix = JSON.parse(rawData.appendix); } catch(e) {}
    } else {
      appendix = rawData.appendix;
    }
  }

  if (Object.keys(appendix).length > 0) {
    console.log(`\nAppendix:`);
    console.log(JSON.stringify(appendix, null, 2));
  }

  if (narrative) {
    console.log('\n=== 叙事分析结果 ===');
    console.log(`评级: ${narrative.llm_category}`);
    console.log(`版本: ${narrative.prompt_version}`);

    const summary = narrative.llm_summary || {};
    console.log(`总分: ${summary.total_score || 'N/A'}`);

    console.log(`\n理由:\n${summary.reasoning || '无'}`);

    // 检查twitter_info
    if (narrative.twitter_info) {
      console.log('\n=== Twitter信息 ===');
      console.log(JSON.stringify(narrative.twitter_info, null, 2));
    }

    // 检查extracted_info
    if (narrative.extracted_info) {
      console.log('\n=== 提取信息 ===');
      console.log(JSON.stringify(narrative.extracted_info, null, 2));
    }

    // 检查prompt_used中是否有网站内容
    if (narrative.prompt_used) {
      const hasWebsiteContent = narrative.prompt_used.includes('【网页内容】');
      const hasWeiboContent = narrative.prompt_used.includes('【背景信息】');
      console.log('\n=== Prompt内容检查 ===');
      console.log(`包含网页内容: ${hasWebsiteContent}`);
      console.log(`包含背景信息: ${hasWeiboContent}`);

      // 显示prompt中的内容部分
      const contentMatch = narrative.prompt_used.match(/【代币信息】[\s\S]*?\n\n/);
      if (contentMatch) {
        console.log('\n=== Prompt中的内容部分 ===');
        console.log(contentMatch[0]);
      }
    }
  }
}

getNarrative().catch(console.error);
