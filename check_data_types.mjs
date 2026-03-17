import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: 'config/.env' });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkData() {
  // 检查 raw_api_data 和 human_judges
  const { data: tokens } = await client
    .from('experiment_tokens')
    .select('token_symbol, raw_api_data, human_judges')
    .limit(100);

  console.log('总样本数:', tokens?.length || 0);

  if (tokens) {
    let rawDataNull = 0;
    let rawDataObject = 0;
    let rawDataString = 0;
    let judgesNull = 0;
    let judgesNotNull = 0;
    const judgeSamples = [];

    tokens.forEach(t => {
      // 检查 raw_api_data 类型
      if (t.raw_api_data === null) {
        rawDataNull++;
      } else if (typeof t.raw_api_data === 'object') {
        rawDataObject++;
      } else if (typeof t.raw_api_data === 'string') {
        rawDataString++;
      }

      // 检查 human_judges
      if (t.human_judges === null) {
        judgesNull++;
      } else {
        judgesNotNull++;
        if (judgeSamples.length < 10) {
          judgeSamples.push(t);
        }
      }
    });

    console.log('\n=== raw_api_data 类型统计 ===');
    console.log('null:', rawDataNull);
    console.log('object:', rawDataObject);
    console.log('string:', rawDataString);

    console.log('\n=== human_judges 统计 ===');
    console.log('null:', judgesNull);
    console.log('有值:', judgesNotNull);

    if (judgesNotNull > 0) {
      console.log('\n=== human_judges 示例 ===');
      judgeSamples.forEach(t => {
        console.log(`\n代币: ${t.token_symbol}`);
        console.log('值:', t.human_judges);
      });
    }

    // 显示 raw_api_data 示例（如果是对象）
    if (rawDataObject > 0) {
      const objectSample = tokens.find(t => typeof t.raw_api_data === 'object' && t.raw_api_data !== null);
      if (objectSample) {
        console.log('\n=== raw_api_data 对象示例 ===');
        console.log('代币:', objectSample.token_symbol);
        console.log('字段:', Object.keys(objectSample.raw_api_data).join(', '));

        if (objectSample.raw_api_data.appendix) {
          const appendix = objectSample.raw_api_data.appendix;
          console.log('\nappendix 类型:', typeof appendix);
          console.log('appendix 字段:', Object.keys(appendix).join(', '));
          console.log('appendix 内容:', JSON.stringify(appendix, null, 2).substring(0, 500));
        }
      }
    }
  }
}

checkData().then(() => process.exit(0)).catch(() => process.exit(1));
