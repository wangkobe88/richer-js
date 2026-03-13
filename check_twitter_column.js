const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTwitterColumn() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 直接查询 twitter_search_result 列
  const { data: signals, error } = await supabase
    .from('strategy_signals')
    .select('id, token_symbol, twitter_search_result, metadata')
    .eq('experiment_id', experimentId)
    .not('twitter_search_result', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  console.log(`找到 twitter_search_result 不为空的信号: ${signals?.length || 0} 条\n`);

  for (const signal of signals || []) {
    console.log(`\n【${signal.token_symbol}】ID: ${signal.id.substring(0, 8)}...`);

    const result = signal.twitter_search_result;
    if (result) {
      console.log(`  类型: ${typeof result}`);
      console.log(`  键: ${Object.keys(result || {}).join(', ')}`);

      // 检查 analysis_details
      if (result.analysis_details) {
        console.log(`  analysis_details 存在!`);
        const details = result.analysis_details;
        console.log(`    quality_tweets: ${details.quality_tweets?.length || 0} 条`);
        console.log(`    low_quality_tweets: ${details.low_quality_tweets?.length || 0} 条`);

        // 显示第一条高质量推文
        if (details.quality_tweets && details.quality_tweets.length > 0) {
          const firstTweet = details.quality_tweets[0];
          console.log(`    第一条质量推文:`);
          console.log(`      text: ${firstTweet.text?.substring(0, 100) || '(无text)'}`);
          console.log(`      user: ${firstTweet.user?.screen_name || '(无user)'}`);
        }

        // 显示第一条低质量推文
        if (details.low_quality_tweets && details.low_quality_tweets.length > 0) {
          const firstTweet = details.low_quality_tweets[0];
          console.log(`    第一条低质量推文:`);
          console.log(`      text: ${firstTweet.text?.substring(0, 100) || '(无text)'}`);
        }
      }

      // 检查 relevant_tweets
      if (result.relevant_tweets && result.relevant_tweets.length > 0) {
        console.log(`  relevant_tweets: ${result.relevant_tweets.length} 条`);
        console.log(`    第一条: ${result.relevant_tweets[0].text?.substring(0, 100) || '(无text)'}`);
      }
    }
  }

  // 检查 preBuyCheckFactors 中的 twitterTotalResults
  console.log('\n\n检查 preBuyCheckFactors.twitterTotalResults > 0 的信号:');
  const { data: signalsWithTwitter } = await supabase
    .from('strategy_signals')
    .select('id, token_symbol, metadata->preBuyCheckFactors->twitterTotalResults')
    .eq('experiment_id', experimentId)
    .not('metadata->preBuyCheckFactors->twitterTotalResults', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);

  let countWithResults = 0;
  for (const signal of signalsWithTwitter || []) {
    const totalCount = signal.metadata?.preBuyCheckFactors?.twitterTotalResults || 0;
    if (totalCount > 0) {
      countWithResults++;
      console.log(`  ${signal.token_symbol}: twitterTotalResults = ${totalCount}`);
    }
  }

  console.log(`\n有推特搜索结果的信号: ${countWithResults} 条`);
}

checkTwitterColumn().catch(console.error);
