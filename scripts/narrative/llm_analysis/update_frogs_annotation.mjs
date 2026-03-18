import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../config/.env') });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const CACHE_PATH = path.resolve(__dirname, 'data/llm_cache.json');
const targetAddress = '0xc3b1a6229d9017376cf9a5ba7a60782bd8db4444';

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('           更新frogs代币人工标注');
  console.log('═══════════════════════════════════════════════════\n');

  console.log(`查询代币: ${targetAddress}\n`);

  // 从数据库查询
  const { data, error } = await client
    .from('experiment_tokens')
    .select('token_address, token_symbol, human_judges')
    .eq('token_address', targetAddress)
    .single();

  if (error) {
    console.error('❌ 查询失败:', error);
    return;
  }

  if (!data) {
    console.log('❌ 未找到该代币');
    return;
  }

  console.log('数据库中找到:');
  console.log(`  symbol: ${data.token_symbol}`);
  console.log(`  human_judges: ${JSON.stringify(data.human_judges)}`);

  // 检查缓存
  console.log('\n检查缓存...');
  const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));

  let found = false;
  for (const [key, value] of Object.entries(cache)) {
    if (value.address === targetAddress) {
      found = true;
      console.log('找到缓存条目:');
      console.log(`  symbol: ${value.symbol}`);
      console.log(`  当前LLM分类: ${value.llmCategory}`);
      console.log(`  当前LLM分数: ${value.llmTotalScore}`);
      console.log(`  当前humanAnnotation: ${JSON.stringify(value.humanAnnotation)}`);

      // 更新人工标注
      if (data.human_judges && data.human_judges.category) {
        value.humanAnnotation = {
          category: data.human_judges.category,
          judgeAt: data.human_judges.judge_at,
          note: data.human_judges.note
        };

        console.log('\n✅ 已更新人工标注:');
        console.log(`  category: ${data.human_judges.category}`);
      }
      break;
    }
  }

  if (!found) {
    console.log('❌ 缓存中未找到该代币');
    return;
  }

  // 保存
  const backupPath = CACHE_PATH + '.before_frogs_update';
  fs.copyFileSync(CACHE_PATH, backupPath);
  console.log(`\n💾 已备份到: ${backupPath}`);

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  console.log(`💾 已更新缓存: ${CACHE_PATH}`);

  console.log('\n═══════════════════════════════════════════════════');
  console.log('           ✅ 更新完成！');
  console.log('═══════════════════════════════════════════════════');
}

main().catch(console.error);
