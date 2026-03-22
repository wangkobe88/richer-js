/**
 * 查询指定代币的数据
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

const address = '0x31046988857871473dba37f53dd78c9fe4f14444';

async function getTokenData() {
  const { data, error } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('token_address', address.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error('查询失败:', error.message);
    return;
  }

  if (!data) {
    console.log('未找到代币数据');
    return;
  }

  console.log('=== 代币信息 ===');
  console.log(`符号: ${data.token_symbol}`);
  console.log(`地址: ${data.token_address}`);
  console.log(`平台: ${data.platform}`);

  const rawData = data.raw_api_data || {};
  console.log(`\n名称: ${rawData.name || '无'}`);
  console.log(`英文介绍: ${rawData.intro_en || '无'}`);
  console.log(`中文介绍: ${rawData.intro_cn || '无'}`);
  console.log(`Website: ${rawData.website || '无'}`);
  console.log(`Twitter: ${rawData.twitterUrl || rawData.webUrl || '无'}`);

  let appendix = {};
  if (rawData.appendix) {
    if (typeof rawData.appendix === 'string') {
      try { appendix = JSON.parse(rawData.appendix); } catch(e) {
        console.log('Appendix解析失败:', e.message);
      }
    } else {
      appendix = rawData.appendix;
    }
  }

  if (Object.keys(appendix).length > 0) {
    console.log('\n=== Appendix ===');
    console.log(JSON.stringify(appendix, null, 2));
  }
}

getTokenData().catch(console.error);
