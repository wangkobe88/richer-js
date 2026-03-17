import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '../../config/.env' });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

/**
 * 从实验代币中提取所有叙事信息（Twitter + description/intro）
 */
async function extractAllNarratives() {
  console.log('=== 提取代币叙事信息 ===\n');

  const experiments = {
    '70fea05f': '70fea05f-2ed5-4b82-86d2-3dcddf27ab11',
    '7855de6d': '7855de6d-5f74-4884-a44e-3c2c2b351259',
    'e3c37811': 'e3c37811-f050-436e-b446-f51f6895bfb8'
  };

  const results = {};

  // 首先加载已有的Twitter推文数据
  const twitterData = JSON.parse(fs.readFileSync('../../narrative_analysis/experiment_tweets_full.json', 'utf-8'));
  const twitterMap = new Map();

  for (const [expId, expData] of Object.entries(twitterData)) {
    for (const token of expData.tokens) {
      const key = `${expId}_${token.address}`;
      twitterMap.set(key, {
        text: token.text,
        user: token.user,
        user_screen_name: token.user_screen_name,
        favorite_count: token.favorite_count,
        retweet_count: token.retweet_count
      });
    }
  }

  console.log(`已有Twitter数据: ${twitterMap.size}条\n`);

  // 获取所有实验代币的详细信息
  for (const [shortId, expId] of Object.entries(experiments)) {
    // 获取成功交易的代币地址
    const { data: trades } = await client
      .from('trades')
      .select('token_address')
      .eq('experiment_id', expId)
      .eq('success', true);

    const tokenAddresses = [...new Set(trades?.map(t => t.token_address) || [])];

    results[shortId] = {
      expId,
      tokens: []
    };

    for (const address of tokenAddresses) {
      const { data: token } = await client
        .from('experiment_tokens')
        .select('token_address, token_symbol, raw_api_data')
        .eq('token_address', address)
        .maybeSingle();

      if (!token) continue;

      const rawData = token.raw_api_data || {};

      // 提取 appendix
      let appendix = rawData.appendix;
      if (typeof appendix === 'string') {
        try { appendix = JSON.parse(appendix); } catch(e) {}
      }
      if (typeof appendix !== 'object' || appendix === null) {
        appendix = {};
      }

      // 收集所有叙事信息
      const narrative = {
        address: token.token_address,
        symbol: token.token_symbol || rawData?.symbol || 'Unknown',
        twitterUrl: appendix.twitter || null,
        twitterText: null,
        introCn: rawData.intro_cn || appendix.intro_cn || null,
        introEn: rawData.intro_en || appendix.intro_en || null,
        description: rawData.description || appendix.description || null,
        website: appendix.website || null,
        tiktok: appendix.tiktok || null
      };

      // 从已有数据中获取 Twitter 文本
      const twitterKey = `${shortId}_${address}`;
      if (twitterMap.has(twitterKey)) {
        narrative.twitterText = twitterMap.get(twitterKey).text;
      }

      results[shortId].tokens.push(narrative);
    }
  }

  // 统计
  console.log('=== 叙事信息覆盖统计 ===\n');
  let totalTokens = 0;
  let withTwitter = 0;
  let withTwitterText = 0;
  let withIntro = 0;
  let withDescription = 0;
  let withAnyNarrative = 0;

  for (const [expId, expData] of Object.entries(results)) {
    console.log(`实验 ${expId}:`);
    console.log(`  代币数: ${expData.tokens.length}`);

    const stats = {
      twitterUrl: 0,
      twitterText: 0,
      intro: 0,
      description: 0,
      any: 0
    };

    expData.tokens.forEach(t => {
      totalTokens++;
      if (t.twitterUrl) stats.twitterUrl++;
      if (t.twitterText) stats.twitterText++;
      if (t.introCn || t.introEn) stats.intro++;
      if (t.description) stats.description++;
      if (t.twitterUrl || t.twitterText || t.introCn || t.introEn || t.description) stats.any++;
    });

    withTwitter += stats.twitterUrl;
    withTwitterText += stats.twitterText;
    withIntro += stats.intro;
    withDescription += stats.description;
    withAnyNarrative += stats.any;

    console.log(`  Twitter URL: ${stats.twitterUrl}`);
    console.log(`  Twitter文本: ${stats.twitterText}`);
    console.log(`  Intro (cn/en): ${stats.intro}`);
    console.log(`  Description: ${stats.description}`);
    console.log(`  有任意叙事: ${stats.any}\n`);
  }

  console.log(`=== 总计 ===`);
  console.log(`总代币数: ${totalTokens}`);
  console.log(`Twitter URL: ${withTwitter} (${(withTwitter/totalTokens*100).toFixed(1)}%)`);
  console.log(`Twitter文本: ${withTwitterText} (${(withTwitterText/totalTokens*100).toFixed(1)}%)`);
  console.log(`Intro字段: ${withIntro} (${(withIntro/totalTokens*100).toFixed(1)}%)`);
  console.log(`Description: ${withDescription} (${(withDescription/totalTokens*100).toFixed(1)}%)`);
  console.log(`有任意叙事: ${withAnyNarrative} (${(withAnyNarrative/totalTokens*100).toFixed(1)}%)`);

  // 显示示例
  console.log('\n=== Intro字段示例 ===');
  for (const [expId, expData] of Object.entries(results)) {
    for (const token of expData.tokens) {
      if (token.introEn || token.introCn) {
        const text = token.introEn || token.introCn;
        console.log(`\n${token.symbol}: ${text.substring(0, 100)}...`);
        if (Object.values(results).reduce((sum, e) => sum + e.tokens.filter(t => t.introEn || t.introCn).length, 0) > 5) break;
      }
    }
    break;
  }

  // 保存结果
  fs.writeFileSync(
    '../../narrative_analysis/all_narratives_combined.json',
    JSON.stringify(results, null, 2)
  );

  console.log('\n已保存到 narrative_analysis/all_narratives_combined.json');

  return results;
}

extractAllNarratives().catch(console.error);
