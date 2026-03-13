const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 推文内容类型分类
function classifyTweetContent(tweet, tokenSymbol) {
  const text = tweet.text || '';

  // 1. 纯地址/符号提及（无实际内容）
  if (/^0x[a-f0-9]{40,}$/i.test(text.trim()) ||
      /^(0x[a-f0-9]+,?\s*)+$/i.test(text.trim())) {
    return { type: 'address_only', desc: '纯地址' };
  }

  // 2. 追踪机器人推文
  if (/tracking.*address|追踪地址|token info/i.test(text)) {
    return { type: 'tracking_bot', desc: '追踪机器人' };
  }

  // 3. 诈骗警告
  if (/⚠️诈骗|诈骗.*工具/i.test(text)) {
    return { type: 'scam_warning', desc: '诈骗警告' };
  }

  // 4. 格式化推广（Quick Swap等）
  if (/Quick Swap|Quick Buy|Check Chart.*Signal|Progress.*Holders/i.test(text)) {
    return { type: 'formatted_promo', desc: '格式化推广' };
  }

  // 5. 代币描述/介绍（包含项目相关信息）
  const descriptionPatterns = [
    /(?:是|为|基于| powered by |driven by|introducing|introduce)/i,
    /(?:项目|project|platform|protocol|agent|ai)/i,
    /(?:功能|功能|可以|无需|只需)/i,
    /(?:turn|convert|transform|allow.*to|enable)/i,
    /(?:官网|官方网站|website|official)/i
  ];

  for (const pattern of descriptionPatterns) {
    if (pattern.test(text) && text.length > 50) {
      return { type: 'token_description', desc: '代币描述/介绍' };
    }
  }

  // 6. 热度讨论（web2情绪、抖音热度等）
  if (/热度|web2|抖音|爆火|火了|发酵|情绪/i.test(text) && text.length > 20) {
    return { type: 'hype_discussion', desc: '热度讨论' };
  }

  // 7. 交易信号/买入逻辑
  if (/买入|买点|买入逻辑|预期|明奶|信号|signal/i.test(text) && text.length > 10) {
    return { type: 'trading_signal', desc: '交易信号' };
  }

  // 8. 短评论/观点
  if (text.length < 50 && !/^0x/i.test(text)) {
    return { type: 'short_comment', desc: '短评论' };
  }

  // 9. 链接分享
  if (/https?:\/\/\S+/.test(text) && text.length < 100) {
    return { type: 'link_share', desc: '链接分享' };
  }

  // 10. 其他长文本
  if (text.length >= 50) {
    return { type: 'long_content', desc: '长文本内容' };
  }

  return { type: 'other', desc: '其他' };
}

async function analyzeContentTypes() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取有人工标注的代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

  const tokenMap = new Map(tokens.map(t => [t.token_address, t]));
  const tokenAddresses = tokens.map(t => t.token_address);

  // 获取信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, twitter_search_result')
    .eq('experiment_id', experimentId)
    .in('token_address', tokenAddresses);

  // 收集所有推文并分类
  const allTweets = [];
  const tweetsByType = {};
  const tweetsByToken = {};

  for (const signal of signals || []) {
    const twitterData = signal.twitter_search_result;
    if (!twitterData || !twitterData.analysis_details) continue;

    const token = tokenMap.get(signal.token_address);
    if (!token) continue;

    const category = token.human_judges?.category || 'unknown';

    const qualityTweets = twitterData.analysis_details.quality_tweets || [];
    const lowQualityTweets = twitterData.analysis_details.low_quality_tweets || [];
    const tweets = [...qualityTweets, ...lowQualityTweets];

    for (const tweet of tweets) {
      const classification = classifyTweetContent(tweet, signal.token_symbol);

      const tweetInfo = {
        tokenSymbol: signal.token_symbol,
        quality: category,
        text: tweet.text,
        user: tweet.user?.screen_name || '',
        followers: tweet.user?.followers_count || 0,
        verified: tweet.user?.verified || false,
        type: classification.type,
        typeDesc: classification.desc,
        length: tweet.text?.length || 0
      };

      allTweets.push(tweetInfo);

      // 按类型分组
      if (!tweetsByType[classification.type]) {
        tweetsByType[classification.type] = [];
      }
      tweetsByType[classification.type].push(tweetInfo);

      // 按代币分组
      if (!tweetsByToken[signal.token_symbol]) {
        tweetsByToken[signal.token_symbol] = [];
      }
      tweetsByToken[signal.token_symbol].push(tweetInfo);
    }
  }

  console.log('='.repeat(120));
  console.log('推文内容类型分析');
  console.log('='.repeat(120));
  console.log(`总推文数: ${allTweets.length}`);
  console.log(`涉及代币: ${Object.keys(tweetsByToken).length}\n`);

  // 按类型统计
  console.log('推文类型分布:');
  console.log('-'.repeat(120));

  const sortedTypes = Object.entries(tweetsByType)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [type, tweets] of sortedTypes) {
    const pct = (tweets.length / allTweets.length * 100).toFixed(1);
    console.log(`  ${tweets[0].typeDesc.padEnd(20)} (${type}): ${tweets.length} 条 (${pct}%)`);
  }

  // 重点：代币描述/介绍
  const descriptions = tweetsByType['token_description'] || [];
  if (descriptions.length > 0) {
    console.log('\n' + '='.repeat(120));
    console.log('【代币描述/介绍】类推文');
    console.log('='.repeat(120));

    descriptions.forEach((tweet, i) => {
      const qualityTag = tweet.quality === 'low_quality' ? '[低]' :
                        tweet.quality === 'mid_quality' ? '[中]' :
                        tweet.quality === 'high_quality' ? '[高]' : '[?]';
      const verified = tweet.verified ? '[✓]' : '[ ]';
      console.log(`\n${i + 1}. ${qualityTag} ${tweet.tokenSymbol} ${verified}`);
      console.log(`   [@${tweet.user}] (${tweet.followers} 粉丝)`);
      console.log(`   ${tweet.text}`);
      console.log(`   长度: ${tweet.length} 字符`);
    });
  } else {
    console.log('\n' + '='.repeat(120));
    console.log('【代币描述/介绍】类推文');
    console.log('='.repeat(120));
    console.log('未找到任何代币描述/介绍类推文');
  }

  // 长文本内容（可能包含描述）
  const longContent = tweetsByType['long_content'] || [];
  if (longContent.length > 0) {
    console.log('\n' + '='.repeat(120));
    console.log('【长文本内容】（可能包含描述）');
    console.log('='.repeat(120));

    longContent.forEach((tweet, i) => {
      const qualityTag = tweet.quality === 'low_quality' ? '[低]' :
                        tweet.quality === 'mid_quality' ? '[中]' :
                        tweet.quality === 'high_quality' ? '[高]' : '[?]';
      console.log(`\n${i + 1}. ${qualityTag} ${tweet.tokenSymbol}`);
      console.log(`   [@${tweet.user}] (${tweet.followers} 粉丝)`);
      console.log(`   ${tweet.text.substring(0, 200)}${tweet.text.length > 200 ? '...' : ''}`);
    });
  }

  // 按代币查看内容类型
  console.log('\n' + '='.repeat(120));
  console.log('按代币查看推文内容类型');
  console.log('='.repeat(120));

  const tokenSummary = [];
  for (const [symbol, tweets] of Object.entries(tweetsByToken)) {
    const types = {};
    for (const t of tweets) {
      types[t.typeDesc] = (types[t.typeDesc] || 0) + 1;
    }

    const hasDescription = Object.keys(types).some(k =>
      k.includes('描述') || k.includes('介绍') || k.includes('长文本')
    );

    tokenSummary.push({
      symbol,
      totalTweets: tweets.length,
      types,
      hasDescription,
      quality: tweets[0]?.quality || '?'
    });
  }

  // 排序：有描述的在前
  tokenSummary.sort((a, b) => {
    if (a.hasDescription && !b.hasDescription) return -1;
    if (!a.hasDescription && b.hasDescription) return 1;
    return b.totalTweets - a.totalTweets;
  });

  console.log('\n有描述性内容的代币:');
  let foundWithDescription = 0;
  for (const token of tokenSummary) {
    if (token.hasDescription) {
      foundWithDescription++;
      const qualityTag = token.quality === 'low_quality' ? '[低]' :
                        token.quality === 'mid_quality' ? '[中]' :
                        token.quality === 'high_quality' ? '[高]' : '[?]';
      console.log(`\n${foundWithDescription}. ${qualityTag} ${token.symbol} (${token.totalTweets} 条推文)`);
      console.log('   内容类型:');
      for (const [type, count] of Object.entries(token.types)) {
        console.log(`     - ${type}: ${count} 条`);
      }

      // 显示具体推文
      const tokenTweets = tweetsByToken[token.symbol];
      const descriptiveTweets = tokenTweets.filter(t =>
        t.type === 'token_description' || t.type === 'long_content'
      );

      for (const tweet of descriptiveTweets) {
        console.log(`\n   [@${tweet.user}]: ${tweet.text.substring(0, 150)}${tweet.text.length > 150 ? '...' : ''}`);
      }
    }
  }

  if (foundWithDescription === 0) {
    console.log('  没有找到任何包含描述性内容的推文');
  }

  console.log('\n' + '='.repeat(120));
  console.log('结论');
  console.log('='.repeat(120));
  console.log(`总推文数: ${allTweets.length}`);
  console.log(`包含代币描述的推文: ${descriptions.length} 条 (${(descriptions.length/allTweets.length*100).toFixed(1)}%)`);
  console.log(`长文本内容: ${longContent.length} 条 (${(longContent.length/allTweets.length*100).toFixed(1)}%)`);
  console.log(`有描述性内容的代币: ${foundWithDescription} 个`);

  if (descriptions.length === 0 && longContent.length === 0) {
    console.log('\n⚠️ 几乎没有推文真正介绍代币的描述/功能');
    console.log('   大部分推文只是提及地址或简单评论');
  }
}

analyzeContentTypes().catch(console.error);
