/**
 * 从数据库获取所有人工标注数据并保存为正确格式
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 从项目根目录加载环境变量
const projectRoot = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.resolve(projectRoot, 'config/.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('📡 从数据库获取人工标注数据...\n');

// 查询所有有人工标注的代币
async function fetchAndSaveHumanAnnotations() {
  const { data, error } = await supabase
    .from('experiment_tokens')
    .select('*')
    .not('human_judges', 'is', null);

  if (error) {
    console.error('❌ 查询失败:', error);
    throw error;
  }

  console.log(`✅ 找到 ${data.length} 个有人工标注的代币`);
  
  // 转换为标准格式
  const annotations = data.map(token => ({
    token_symbol: token.token_symbol,
    token_address: token.token_address,
    experiment_id: token.experiment_id,
    platform: token.platform,
    blockchain: token.blockchain,
    // 人工标注
    human_judges: token.human_judges,
    // 原始API数据（用于参考）
    raw_data: {
      name: token.raw_api_data?.name,
      symbol: token.raw_api_data?.symbol,
      fdv: token.raw_api_data?.fdv,
      tvl: token.raw_api_data?.tvl,
      intro_cn: token.raw_api_data?.intro_cn,
      intro_en: token.raw_api_data?.intro_en
    }
  }));

  // 按地址建立索引（用于快速查找）
  const byAddress = {};
  for (const ann of annotations) {
    byAddress[ann.token_address.toLowerCase()] = ann;
  }

  // 按symbol建立索引
  const bySymbol = {};
  for (const ann of annotations) {
    if (!bySymbol[ann.token_symbol]) {
      bySymbol[ann.token_symbol] = [];
    }
    bySymbol[ann.token_symbol].push(ann);
  }

  // 保存数据
  const outputPath = path.resolve(projectRoot, 'scripts/narrative/data/human_judged_tokens_from_db.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    total: annotations.length,
    annotations,
    byAddress,
    bySymbol
  }, null, 2));

  console.log(`💾 已保存到: ${outputPath}`);

  // 显示统计
  const byCategory = {};
  for (const ann of annotations) {
    const cat = ann.human_judges?.category || 'unknown';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('                    人工标注统计');
  console.log('═══════════════════════════════════════════════════');
  console.log(`总代币数: ${annotations.length}`);
  console.log('\n分类分布:');
  for (const [cat, count] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${count}个`);
  }

  // 检查特定地址
  const targetAddress = '0x85efc36ddb171261b674d0f979c8066459d34444';
  const found = byAddress[targetAddress.toLowerCase()];
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`检查地址: ${targetAddress}`);
  if (found) {
    console.log(`✅ 找到人工标注!`);
    console.log(`  代币: ${found.token_symbol}`);
    console.log(`  评级: ${found.human_judges?.category}`);
  } else {
    console.log(`❌ 未找到人工标注`);
  }

  console.log('\n✅ 完成！');
}

fetchAndSaveHumanAnnotations().catch(console.error);
