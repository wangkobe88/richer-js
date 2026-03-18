/**
 * 单独分析30000代币
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import LLMClient from '../../../src/utils/llm-client/index.mjs';
import { NARRATIVE_ANALYSIS_PROMPT_V4 } from './prompt-template-v4.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../config/.env') });

// 加载数据
const narrativeDataPath = path.resolve(__dirname, '../data/all_narratives_combined.json');
const tweetsDataPath = path.resolve(__dirname, '../data/tweets_with_content.json');
const ruleScoresPath = path.resolve(__dirname, '../data/combined_narrative_scores.json');

const data = JSON.parse(fs.readFileSync(narrativeDataPath, 'utf-8'));
const tweetsData = JSON.parse(fs.readFileSync(tweetsDataPath, 'utf-8'));
const ruleScoresData = JSON.parse(fs.readFileSync(ruleScoresPath, 'utf-8'));

// 构建推文映射
const tweetsMap = new Map();
for (const tweet of tweetsData) {
  if (!tweetsMap.has(tweet.token)) {
    tweetsMap.set(tweet.token, []);
  }
  tweetsMap.get(tweet.token).push(tweet);
}

// 构建规则评分映射
const ruleScoresMap = new Map();
for (const [expId, expData] of Object.entries(ruleScoresData)) {
  for (const t of expData.tokens) {
    ruleScoresMap.set(t.address, {
      scores: t.scores,
      narrative_category: t.narrative_category,
      narrative_score: t.narrative_score
    });
  }
}

// 查找30000代币
let token30000 = null;
for (const [expId, expData] of Object.entries(data)) {
  for (const t of expData.tokens) {
    if (t.symbol === '30000') {
      const tokenTweets = tweetsMap.get(t.symbol) || [];
      const mainTweet = tokenTweets.length > 0 ? tokenTweets[0] : null;
      const tweetText = mainTweet?.text || t.twitterText || '';
      const ruleScores = ruleScoresMap.get(t.address);

      token30000 = {
        symbol: t.symbol,
        address: t.address,
        expId,
        twitter: {
          text: tweetText,
          tweetId: mainTweet?.tweet_id || null
        },
        intro: {
          en: t.introEn || '',
          cn: t.introCn || ''
        },
        ruleScores: ruleScores?.scores || null,
        ruleTotalScore: ruleScores?.narrative_score || null,
        ruleCategory: ruleScores?.narrative_category || null
      };
      break;
    }
  }
}

if (!token30000) {
  console.log('❌ 未找到30000代币');
  process.exit(1);
}

console.log('═══════════════════════════════════════════════════');
console.log('           单独分析 30000 代币');
console.log('═══════════════════════════════════════════════════\n');

console.log('代币:', token30000.symbol);
console.log('地址:', token30000.address);
console.log('推文:', token30000.twitter.text?.substring(0, 100) || '(无)');
console.log('Intro EN:', token30000.intro.en?.substring(0, 100) || '(无)');
console.log('');

// 创建LLM客户端
const llmClient = new LLMClient('siliconflow', {
  baseUrl: process.env.LLM_BASE_URL || 'https://api.siliconflow.cn/v1',
  model: process.env.LLM_MODEL || 'deepseek-ai/DeepSeek-R1',
  maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 16000,
  timeout: parseInt(process.env.LLM_TIMEOUT) || 300000,
  apiKey: process.env.API_KEY || process.env.SILICONFLOW_API_KEY,
  delay: 300
});

async function analyzeToken(llmClient, token) {
  const requestStartTime = Date.now();
  try {
    const prompt = NARRATIVE_ANALYSIS_PROMPT_V4(token);
    const response = await llmClient.analyze(prompt);
    const requestEndTime = Date.now();

    // 提取JSON
    let jsonStr = response;
    const thinkEndTag = '';
    const thinkEndIndex = response.indexOf(thinkEndTag);
    if (thinkEndIndex !== -1) {
      jsonStr = response.substring(thinkEndIndex + thinkEndTag.length).trim();
    }

    const jsonMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
                      jsonStr.match(/(\{[\s\S]*?\})/);

    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch (e) {
      // 尝试修复
      const categoryMatch = jsonStr.match(/"category":\s*"([^"]*)"/);
      if (categoryMatch && categoryMatch[1] === 'unrated') {
        result = {
          category: 'unrated',
          reasoning: jsonStr.match(/"reasoning":\s*"([^"]*)"/)?.[1] || ''
        };
      } else {
        throw e;
      }
    }

    const responseTime = requestEndTime - requestStartTime;
    return {
      success: true,
      data: {
        ...token,
        llmReasoning: result.reasoning,
        llmScores: result.scores,
        llmTotalScore: result.total_score,
        llmCategory: result.category,
        ruleScores: token.ruleScores,
        ruleTotalScore: token.ruleTotalScore,
        ruleCategory: token.ruleCategory,
        responseTime
      }
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function main() {
  const result = await analyzeToken(llmClient, token30000);

  if (result.success) {
    console.log('✅ LLM评分:', result.data.llmCategory);
    if (result.data.llmTotalScore !== undefined) {
      console.log('   分数:', result.data.llmTotalScore);
    }
    console.log('   规则评分:', result.data.ruleCategory, '(' + result.data.ruleTotalScore + '分)');
    console.log('   响应时间:', result.data.responseTime + 'ms');
    console.log('');
    console.log('   理由:', result.data.llmReasoning);
  } else {
    console.log('❌ 失败:', result.error);
  }

  console.log('\n═══════════════════════════════════════════════════');
}

main().catch(console.error);
