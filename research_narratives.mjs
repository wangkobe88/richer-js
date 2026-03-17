import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: 'config/.env' });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function research() {
  // 1. 检查代币数据分布
  const { data: allTokens } = await client
    .from('experiment_tokens')
    .select('token_address, token_name, token_symbol, raw_api_data, human_judges')
    .limit(500);

  console.log('总检查代币数:', allTokens?.length || 0);

  let withRawData = 0;
  let withJudges = 0;
  const sampleRawData = [];
  const sampleJudges = [];

  if (allTokens) {
    for (const t of allTokens) {
      if (t.raw_api_data && t.raw_api_data !== 'null' && t.raw_api_data !== '') {
        withRawData++;
        if (sampleRawData.length < 5) {
          sampleRawData.push(t);
        }
      }
      if (t.human_judges && t.human_judges !== 'null' && t.human_judges !== '') {
        withJudges++;
        if (sampleJudges.length < 5) {
          sampleJudges.push(t);
        }
      }
    }
  }

  console.log('\n有 raw_api_data:', withRawData);
  console.log('有 human_judges:', withJudges);

  if (sampleRawData.length > 0) {
    console.log('\n=== raw_api_data 示例 ===');
    sampleRawData.forEach(t => {
      console.log(`\n${t.token_name || t.token_symbol}:`);
      console.log('  raw_api_data 类型:', typeof t.raw_api_data);
      console.log('  raw_api_data 长度:', t.raw_api_data?.length || 0);

      try {
        const parsed = JSON.parse(t.raw_api_data);
        console.log('  解析后的字段:', Object.keys(parsed).join(', '));
        if (parsed.appendix) {
          console.log('  appendix:', JSON.stringify(parsed.appendix).substring(0, 300));
        }
      } catch (e) {
        console.log('  解析失败:', e.message);
      }
    });
  }

  if (sampleJudges.length > 0) {
    console.log('\n=== human_judges 示例 ===');
    sampleJudges.forEach(t => {
      console.log(`\n${t.token_name || t.token_symbol}:`);
      console.log('  human_judges:', t.human_judges);
    });
  }

  // 2. 检查 twitter-validation 工具
  console.log('\n=== twitter-validation 工具检查 ===');
  const twitterPath = 'src/utils/twitter-validation';
  try {
    const files = fs.readdirSync(twitterPath);
    console.log('文件列表:', files.join(', '));

    // 检查是否有 API 相关文件
    for (const file of files) {
      if (file.includes('twitter') || file.includes('api')) {
        const filePath = `${twitterPath}/${file}`;
        const content = fs.readFileSync(filePath, 'utf-8');
        console.log(`\n${file}:`);
        console.log('  导出:', content.match(/export\s+\w+/g)?.join(', ') || '无');
        console.log('  函数:', content.match(/function\s+\w+/g)?.join(', ') || '无');
      }
    }
  } catch (e) {
    console.log('错误:', e.message);
  }
}

research().then(() => {
  console.log('\n调研完成');
  process.exit(0);
}).catch(err => {
  console.error('错误:', err);
  process.exit(1);
});
