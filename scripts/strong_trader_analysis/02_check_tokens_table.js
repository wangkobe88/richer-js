/**
 * 步骤2: 检查 experiment_tokens 表结构
 * 确认是否有 inner_pair 或其他可用于获取交易数据的字段
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 步骤2: 检查 experiment_tokens 表结构 ===\n');

  const expId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取一个代币的完整数据
  const { data: token } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', expId)
    .limit(1)
    .single();

  if (!token) {
    console.log('没有找到代币数据');
    return;
  }

  console.log('代币数据结构:');
  console.log('-'.repeat(60));
  console.log('字段列表:');
  Object.keys(token).forEach(key => {
    const value = token[key];
    if (typeof value === 'object' && value !== null) {
      console.log(`  ${key}: [${typeof value}] - ${JSON.stringify(value).substring(0, 50)}...`);
    } else {
      console.log(`  ${key}: [${typeof value}] - ${value}`);
    }
  });

  // 特别检查是否有 pair 相关字段
  const pairKeys = Object.keys(token).filter(k =>
    k.toLowerCase().includes('pair') ||
    k.toLowerCase().includes('inner') ||
    k.toLowerCase().includes('trade')
  );

  if (pairKeys.length > 0) {
    console.log('\n找到 pair 相关字段:');
    pairKeys.forEach(k => console.log(`  ${k}: ${JSON.stringify(token[k])}`));
  } else {
    console.log('\n❌ 没有找到 pair 相关字段');
  }
}

main().catch(console.error);
