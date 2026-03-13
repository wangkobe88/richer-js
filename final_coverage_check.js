const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取所有有人工标注的代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

  // 获取所有信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, twitter_search_result')
    .eq('experiment_id', experimentId);

  // 找到每个代币最新的（或任意一个有推文的）信号
  const tokenBestSignal = new Map(); // address -> { tweets: number, signal: any }

  signals.forEach(s => {
    const tweets = s.twitter_search_result &&
                   s.twitter_search_result.analysis_details ?
                   ((s.twitter_search_result.analysis_details.quality_tweets || []).length +
                    (s.twitter_search_result.analysis_details.low_quality_tweets || []).length) : 0;

    const existing = tokenBestSignal.get(s.token_address);
    if (!existing || tweets > existing.tweets) {
      tokenBestSignal.set(s.token_address, { tweets, signal: s });
    }
  });

  // 统计
  let withTweets = 0;
  let withZeroTweets = 0;
  let noData = 0;

  const byQuality = {
    low_quality: { total: 0, withTweets: 0, zeroTweets: 0, noData: 0 },
    mid_quality: { total: 0, withTweets: 0, zeroTweets: 0, noData: 0 },
    high_quality: { total: 0, withTweets: 0, zeroTweets: 0, noData: 0 }
  };

  tokens.forEach(t => {
    const q = t.human_judges?.category;
    if (!byQuality[q]) return;

    byQuality[q].total++;

    const best = tokenBestSignal.get(t.token_address);
    if (!best) {
      noData++;
      byQuality[q].noData++;
    } else if (best.tweets > 0) {
      withTweets++;
      byQuality[q].withTweets++;
    } else {
      withZeroTweets++;
      byQuality[q].zeroTweets++;
    }
  });

  console.log('='.repeat(80));
  console.log('唯一代币的推特推文覆盖率 (修正版)');
  console.log('='.repeat(80));
  console.log('');
  console.log('总代币数 (唯一):', tokens.length);
  console.log('');
  console.log('分类统计:');
  console.log(`  有推文 (>0条): ${withTweets} (${(withTweets/tokens.length*100).toFixed(1)}%)`);
  console.log(`  查询了但无推文 (0条): ${withZeroTweets} (${(withZeroTweets/tokens.length*100).toFixed(1)}%)`);
  console.log(`  无数据 (未查询): ${noData} (${(noData/tokens.length*100).toFixed(1)}%)`);
  console.log('');
  console.log(`有推特搜索结果 (包括0推文): ${withTweets + withZeroTweets} (${((withTweets + withZeroTweets)/tokens.length*100).toFixed(1)}%)`);
  console.log('');
  console.log('='.repeat(80));
  console.log('按质量分组:');
  console.log('='.repeat(80));

  for (const [quality, data] of Object.entries(byQuality)) {
    console.log(`${quality}:`);
    console.log(`  总代币: ${data.total}`);
    console.log(`  有推文: ${data.withTweets} (${(data.withTweets/data.total*100).toFixed(1)}%)`);
    console.log(`  查询无推文: ${data.zeroTweets} (${(data.zeroTweets/data.total*100).toFixed(1)}%)`);
    console.log(`  未查询: ${data.noData} (${(data.noData/data.total*100).toFixed(1)}%)`);
    console.log('');
  }

  // 列出有推文的代币
  console.log('='.repeat(80));
  console.log('有推文的代币列表 (唯一，去重后):');
  console.log('='.repeat(80));

  const tokensWithTweets = [];
  tokens.forEach(t => {
    const best = tokenBestSignal.get(t.token_address);
    if (best && best.tweets > 0) {
      tokensWithTweets.push({
        symbol: t.token_symbol,
        quality: t.human_judges?.category,
        tweets: best.tweets
      });
    }
  });

  tokensWithTweets.sort((a, b) => b.tweets - a.tweets);
  tokensWithTweets.forEach((t, i) => {
    console.log(`${i+1}. [${t.quality}] ${t.symbol} - ${t.tweets}条推文`);
  });
}

check();
