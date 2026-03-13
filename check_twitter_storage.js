const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取有推特数据的信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .not('metadata', 'is', null)
    .limit(10);

  console.log(`信号数量: ${signals?.length || 0}\n`);

  for (const signal of signals || []) {
    console.log(`信号: ${signal.token_symbol || signal.token_address?.substring(0, 8)}...`);

    // 检查各种可能的字段
    const meta = signal.metadata || {};

    console.log('  metadata 顶层字段:', Object.keys(meta).join(', '));

    // 检查 preBuyCheckFactors
    const preBuy = meta.preBuyCheckFactors || {};
    console.log('  preBuyCheckFactors 字段:', Object.keys(preBuy).join(', '));

    // 查找 twitter 相关字段
    const twitterFields = Object.keys(preBuy).filter(k => k.toLowerCase().includes('twitter'));
    if (twitterFields.length > 0) {
      console.log('  Twitter相关字段:');
      for (const field of twitterFields) {
        const val = preBuy[field];
        const display = typeof val === 'object' ? JSON.stringify(val).substring(0, 100) : String(val).substring(0, 100);
        console.log(`    ${field}: ${display}`);
      }
    }

    // 检查是否有直接存储在 metadata 的 twitter_search_result
    if (meta.twitter_search_result) {
      console.log('  metadata.twitter_search_result 存在!');
      const result = meta.twitter_search_result;
      console.log('    类型:', typeof result);
      console.log('    键:', Object.keys(result || {}).join(', '));
      if (result.data && Array.isArray(result.data)) {
        console.log('    data数组长度:', result.data.length);
        if (result.data.length > 0) {
          console.log('    第一条:', JSON.stringify(result.data[0]).substring(0, 200));
        }
      }
    }

    console.log('');
  }
}

check().catch(console.error);
