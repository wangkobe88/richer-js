const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTwitterCoverage() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取所有有人工标注的代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

  // 获取所有信号
  const tokenAddresses = tokens.map(t => t.token_address);
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, twitter_search_result')
    .eq('experiment_id', experimentId)
    .in('token_address', tokenAddresses);

  const signalMap = new Map((signals || []).map(s => [s.token_address, s.twitter_search_result]));

  // 统计覆盖率
  const coverageStats = {
    total: tokens.length,
    withTwitterData: 0,
    withoutTwitterData: 0,
    withTweets: 0,
    noTweets: 0,

    byQuality: {
      low_quality: { total: 0, withData: 0, withTweets: 0, noTweets: 0, noData: 0 },
      mid_quality: { total: 0, withData: 0, withTweets: 0, noTweets: 0, noData: 0 },
      high_quality: { total: 0, withData: 0, withTweets: 0, noTweets: 0, noData: 0 },
    }
  };

  for (const token of tokens) {
    const quality = token.human_judges?.category || 'unknown';
    const twitterData = signalMap.get(token.token_address);

    if (!twitterData) {
      coverageStats.withoutTwitterData++;
      if (coverageStats.byQuality[quality]) {
        coverageStats.byQuality[quality].noData++;
        coverageStats.byQuality[quality].total++;
      }
      continue;
    }

    coverageStats.withTwitterData++;

    const tweets = (twitterData.analysis_details?.quality_tweets || []).length +
                  (twitterData.analysis_details?.low_quality_tweets || []).length;

    if (tweets > 0) {
      coverageStats.withTweets++;
      if (coverageStats.byQuality[quality]) {
        coverageStats.byQuality[quality].withTweets++;
        coverageStats.byQuality[quality].total++;
      }
    } else {
      coverageStats.noTweets++;
      if (coverageStats.byQuality[quality]) {
        coverageStats.byQuality[quality].noTweets++;
        coverageStats.byQuality[quality].total++;
      }
    }
  }

  // 打印报告
  console.log('='.repeat(120));
  console.log('推特数据覆盖率报告');
  console.log('='.repeat(120));
  console.log(`实验ID: ${experimentId}`);
  console.log(`统计时间: ${new Date().toISOString()}`);
  console.log('');

  // 总体覆盖率
  console.log('总体覆盖率:');
  console.log(`  总代币数: ${coverageStats.total}`);
  console.log(`  有推特数据: ${coverageStats.withTwitterData} (${(coverageStats.withTwitterData/coverageStats.total*100).toFixed(1)}%)`);
  console.log(`  无推特数据: ${coverageStats.withoutTwitterData} (${(coverageStats.withoutTwitterData/coverageStats.total*100).toFixed(1)}%)`);
  console.log('');

  if (coverageStats.withTwitterData > 0) {
    console.log('有推特数据中的推文情况:');
    console.log(`  有推文: ${coverageStats.withTweets} (${(coverageStats.withTweets/coverageStats.withTwitterData*100).toFixed(1)}%)`);
    console.log(`  无推文: ${coverageStats.noTweets} (${(coverageStats.noTweets/coverageStats.withTwitterData*100).toFixed(1)}%)`);
    console.log('');
  }

  // 按质量分组
  console.log('='.repeat(120));
  console.log('按质量分组统计');
  console.log('='.repeat(120));

  for (const [quality, stats] of Object.entries(coverageStats.byQuality)) {
    if (stats.total === 0) continue;

    const dataRate = stats.total > 0 ? (stats.withTweets + stats.noTweets) / stats.total * 100 : 0;
    const tweetsRate = stats.total > 0 ? stats.withTweets / stats.total * 100 : 0;
    const noDataRate = stats.total > 0 ? stats.noData / stats.total * 100 : 0;

    console.log(`\n【${quality}】`);
    console.log(`  总代币数: ${stats.total}`);
    console.log(`  有推特数据: ${stats.withTweets + stats.noTweets} (${dataRate.toFixed(1)}%)`);
    console.log(`    - 有推文: ${stats.withTweets} (${tweetsRate.toFixed(1)}%)`);
    console.log(`    - 无推文: ${stats.noTweets} (${(stats.total > 0 ? stats.noTweets/stats.total*100 : 0).toFixed(1)}%)`);
    console.log(`  无推特数据: ${stats.noData} (${noDataRate.toFixed(1)}%)`);
  }

  // 列出无推特数据的代币
  console.log('\n' + '='.repeat(120));
  console.log('无推特数据的代币列表');
  console.log('='.repeat(120));

  const noDataTokens = tokens.filter(token => {
    const twitterData = signalMap.get(token.token_address);
    return !twitterData;
  });

  if (noDataTokens.length > 0) {
    noDataTokens.forEach(token => {
      const quality = token.human_judges?.category || 'unknown';
      console.log(`  [${quality}] ${token.token_symbol} (${token.token_address.substring(0, 10)}...)`);
    });
  } else {
    console.log('  所有代币都有推特数据');
  }

  // 列出有数据但无推文的代币
  console.log('\n' + '='.repeat(120));
  console.log('有推特数据但无推文的代币列表');
  console.log('='.repeat(120));

  const noTweetsTokens = tokens.filter(token => {
    const twitterData = signalMap.get(token.token_address);
    if (!twitterData) return false;
    const tweets = (twitterData.analysis_details?.quality_tweets || []).length +
                  (twitterData.analysis_details?.low_quality_tweets || []).length;
    return tweets === 0;
  });

  if (noTweetsTokens.length > 0) {
    noTweetsTokens.forEach(token => {
      const quality = token.human_judges?.category || 'unknown';
      console.log(`  [${quality}] ${token.token_symbol} (${token.token_address.substring(0, 10)}...)`);
    });
  } else {
    console.log('  所有有数据的代币都有推文');
  }

  // 总结
  console.log('\n' + '='.repeat(120));
  console.log('总结');
  console.log('='.repeat(120));

  const overallCoverage = coverageStats.withTwitterData / coverageStats.total * 100;
  const tweetCoverage = coverageStats.withTweets / coverageStats.total * 100;

  console.log(`\n1. 数据覆盖率: ${overallCoverage.toFixed(1)}%`);
  console.log(`   (${coverageStats.withTwitterData}/${coverageStats.total} 个代币有推特数据)`);

  console.log(`\n2. 推文覆盖率: ${tweetCoverage.toFixed(1)}%`);
  console.log(`   (${coverageStats.withTweets}/${coverageStats.total} 个代币实际有推文)`);

  if (overallCoverage < 100) {
    console.log(`\n⚠️  有 ${coverageStats.withoutTwitterData} 个代币 (${(coverageStats.withoutTwitterData/coverageStats.total*100).toFixed(1)}%) 缺少推特数据`);
    console.log('   这些代币的推特因子值将为0，可能影响分析准确性');
  }

  if (coverageStats.noTweets > 0) {
    console.log(`\n⚠️  有 ${coverageStats.noTweets} 个代币有推特数据但没有推文`);
    console.log('   这些代币的推特因子值也将为0');
  }
}

checkTwitterCoverage().catch(console.error);
