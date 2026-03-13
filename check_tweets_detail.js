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

  const tokenAddresses = tokens.map(t => t.token_address);

  // 获取所有信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, twitter_search_result')
    .eq('experiment_id', experimentId)
    .in('token_address', tokenAddresses);

  const signalMap = new Map((signals || []).map(s => [s.token_address, s.twitter_search_result]));

  // 统计有推文的代币
  let withTweets = 0;
  let withTwitterData = 0;
  const tokensWithTweets = [];

  for (const token of tokens) {
    const twitterData = signalMap.get(token.token_address);

    if (!twitterData) {
      continue;
    }

    withTwitterData++;

    const tweets = (twitterData.analysis_details?.quality_tweets || []).length +
                  (twitterData.analysis_details?.low_quality_tweets || []).length;

    if (tweets > 0) {
      withTweets++;
      tokensWithTweets.push({
        symbol: token.token_symbol,
        quality: token.human_judges?.category,
        tweetCount: tweets
      });
    }
  }

  console.log('='.repeat(80));
  console.log('推特数据覆盖率详细统计');
  console.log('='.repeat(80));
  console.log('');
  console.log('总代币数 (有人工标注):', tokens.length);
  console.log('');
  console.log('有推特数据 (包括查询了但没推文的):', withTwitterData, `(${(withTwitterData/tokens.length*100).toFixed(1)}%)`);
  console.log('有推文 (至少1条):', withTweets, `(${(withTweets/tokens.length*100).toFixed(1)}%)`);
  console.log('无推特数据:', tokens.length - withTwitterData, `(${((tokens.length - withTwitterData)/tokens.length*100).toFixed(1)}%)`);
  console.log('');
  console.log('='.repeat(80));
  console.log('有推文的代币列表:');
  console.log('='.repeat(80));

  tokensWithTweets.sort((a, b) => b.tweetCount - a.tweetCount);

  tokensWithTweets.forEach((t, i) => {
    console.log(`${i+1}. [${t.quality}] ${t.symbol} - ${t.tweetCount}条推文`);
  });

  console.log('');
  console.log('='.repeat(80));
  console.log('按质量分组统计:');
  console.log('='.repeat(80));

  const byQuality = {
    low_quality: { total: 0, withTweets: 0 },
    mid_quality: { total: 0, withTweets: 0 },
    high_quality: { total: 0, withTweets: 0 }
  };

  tokens.forEach(t => {
    const q = t.human_judges?.category;
    if (byQuality[q]) {
      byQuality[q].total++;
    }
  });

  tokensWithTweets.forEach(t => {
    const q = t.quality;
    if (byQuality[q]) {
      byQuality[q].withTweets++;
    }
  });

  for (const [quality, data] of Object.entries(byQuality)) {
    console.log(`${quality}:`);
    console.log(`  总代币: ${data.total}`);
    console.log(`  有推文: ${data.withTweets} (${(data.withTweets/data.total*100).toFixed(1)}%)`);
    console.log('');
  }
}

check();
