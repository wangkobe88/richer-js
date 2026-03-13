const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function findRawTweets() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取有推特数据的信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .not('metadata', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  console.log(`检查 ${signals?.length || 0} 条信号的原始推特数据\n`);

  for (const signal of signals || []) {
    const meta = signal.metadata || {};
    const symbol = signal.token_symbol || signal.token_address?.substring(0, 10);

    // 检查各种可能的位置
    console.log(`\n【${symbol}】`);

    // 1. metadata 顶层
    if (meta.twitter_search_result) {
      console.log('  ✓ 找到: metadata.twitter_search_result');
      const result = meta.twitter_search_result;
      if (result.data && result.data.length > 0) {
        console.log(`    数据类型: ${typeof result}, 数据条数: ${result.data.length}`);
        console.log(`    第一条预览: ${JSON.stringify(result.data[0]).substring(0, 150)}`);
      } else {
        console.log(`    结构: ${JSON.stringify(result).substring(0, 200)}`);
      }
    }

    // 2. metadata._twitterRawResult (购买时保存的)
    if (meta._twitterRawResult) {
      console.log('  ✓ 找到: metadata._twitterRawResult');
      const result = meta._twitterRawResult;
      if (result.data && result.data.length > 0) {
        console.log(`    数据条数: ${result.data.length}`);
        console.log(`    第一条预览: ${JSON.stringify(result.data[0]).substring(0, 150)}`);
      }
    }

    // 3. preBuyCheckFactors._twitterRawResult
    const preBuy = meta.preBuyCheckFactors || {};
    if (preBuy._twitterRawResult) {
      console.log('  ✓ 找到: preBuyCheckFactors._twitterRawResult');
      const result = preBuy._twitterRawResult;
      if (result.data && result.data.length > 0) {
        console.log(`    数据条数: ${result.data.length}`);
        console.log(`    第一条预览: ${JSON.stringify(result.data[0]).substring(0, 150)}`);
      }
    }

    // 4. 直接检查所有包含 'data' 字段
    const hasData = [];
    function findDataFields(obj, path = '') {
      if (!obj || typeof obj !== 'object') return;

      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;

        if (key === 'data' && Array.isArray(value) && value.length > 0) {
          if (value[0].text || value[0].tweet_text) {
            hasData.push({ path: currentPath, count: value.length, sample: value[0] });
          }
        }

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          findDataFields(value, currentPath);
        }
      }
    }

    findDataFields(meta, 'metadata');

    if (hasData.length > 0) {
      console.log('  ✓ 找到 data 字段:');
      hasData.forEach(item => {
        console.log(`    ${item.path}: ${item.count} 条`);
        console.log(`    样本: ${JSON.stringify(item.sample).substring(0, 150)}`);
      });
    }

    // 如果还没找到，显示 twitterTotalResults > 0 的信号
    if (preBuy.twitterTotalResults > 0) {
      console.log(`  → 有推特数据 (totalResults=${preBuy.twitterTotalResults})`);
      console.log(`    但未找到原始推文数组`);
    }
  }
}

findRawTweets().catch(console.error);
