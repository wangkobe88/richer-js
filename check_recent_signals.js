const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkRecentSignals() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取最近的信号，按创建时间倒序
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .not('metadata', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  console.log(`检查最近 ${signals?.length || 0} 条信号\n`);

  let foundRawData = 0;
  let totalWithTwitter = 0;

  for (const signal of signals || []) {
    const meta = signal.metadata || {};
    const preBuy = meta.preBuyCheckFactors || {};

    // 检查是否有推特搜索结果
    if (preBuy.twitterTotalResults > 0) {
      totalWithTwitter++;

      // 检查 metadata 顶层
      const twitterResult = meta.twitter_search_result;
      const internalResult = meta._twitterRawResult;

      console.log(`\n【${signal.token_symbol}】创建于: ${signal.created_at}`);
      console.log(`  twitterTotalResults: ${preBuy.twitterTotalResults}`);

      if (twitterResult && twitterResult.data && twitterResult.data.length > 0) {
        console.log(`  ✓ metadata.twitter_search_result.data: ${twitterResult.data.length} 条推文`);
        foundRawData++;
        console.log(`  第一条: ${twitterResult.data[0].text?.substring(0, 100) || '(无text)'}`);
      } else {
        console.log(`  ✗ metadata.twitter_search_result: 无数据或结构不同`);
        if (twitterResult) {
          console.log(`    实际结构: ${JSON.stringify(twitterResult).substring(0, 200)}`);
        }
      }

      if (internalResult && internalResult.data && internalResult.data.length > 0) {
        console.log(`  ✓ metadata._twitterRawResult.data: ${internalResult.data.length} 条推文`);
        foundRawData++;
        console.log(`  第一条: ${internalResult.data[0].text?.substring(0, 100) || '(无text)'}`);
      }
    }
  }

  console.log(`\n总结:`);
  console.log(`  有推特数据的信号: ${totalWithTwitter}`);
  console.log(`  有原始推文数组的信号: ${foundRawData}`);

  if (foundRawData === 0) {
    console.log(`\n⚠️  原始推文数据没有被保存到数据库`);
    console.log(`  需要在保存信号时添加 twitter_search_result 到 metadata`);
  }
}

checkRecentSignals().catch(console.error);
