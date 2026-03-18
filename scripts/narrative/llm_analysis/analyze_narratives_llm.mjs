/**
 * 使用LLM分析代币叙事质量
 * 与规则评分并行对比
 * 顺序调用LLM，避免并发问题
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import LLMClient from '../../../src/utils/llm-client/index.mjs';
import { NARRATIVE_ANALYSIS_PROMPT_V4, getPromptSummary } from './prompt-template-v4.mjs';
import { checkBlacklist } from './twitter_blacklist.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../../../config/.env') });

// 配置
const CONFIG = {
  // LLM配置
  llmType: 'siliconflow',
  model: process.env.LLM_MODEL || 'deepseek-ai/DeepSeek-R1',
  baseUrl: process.env.LLM_BASE_URL || 'https://api.siliconflow.cn/v1',
  maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 16000,
  timeout: parseInt(process.env.LLM_TIMEOUT) || 300000,  // 增加到5分钟，适应DeepSeek-R1
  apiKey: process.env.API_KEY || process.env.SILICONFLOW_API_KEY,

  // 数据路径
  narrativeDataPath: path.resolve(__dirname, '../data/all_narratives_combined.json'),
  ruleScoresPath: path.resolve(__dirname, '../data/combined_narrative_scores.json'),
  tweetsDataPath: path.resolve(__dirname, '../data/tweets_with_content.json'),
  humanAnnotationPath: path.resolve(__dirname, '../data/human_judged_tokens.json'),
  cachePath: path.resolve(__dirname, 'data/llm_cache.json'),
  ruleCachePath: path.resolve(__dirname, 'data/rule_cache.json'),
  outputPath: path.resolve(__dirname, '../data/llm_narrative_scores.json'),

  // 测试模式：只处理前N个代币（设为1表示只测试一个）
  testLimit: process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT) : null
};

/**
 * 加载代币叙事数据（包含规则评分和完整元数据）
 */
function loadTokenData(humanAnnotations = new Map()) {
  const data = JSON.parse(fs.readFileSync(CONFIG.narrativeDataPath, 'utf-8'));
  const ruleScoresData = JSON.parse(fs.readFileSync(CONFIG.ruleScoresPath, 'utf-8'));
  const tweetsData = JSON.parse(fs.readFileSync(CONFIG.tweetsDataPath, 'utf-8'));

  // 构建推文数据映射 (按symbol)
  const tweetsMap = new Map();
  for (const tweet of tweetsData) {
    if (!tweetsMap.has(tweet.token)) {
      tweetsMap.set(tweet.token, []);
    }
    tweetsMap.get(tweet.token).push(tweet);
  }

  // 构建规则评分映射 (按address)
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

  const tokens = [];

  for (const [expId, expData] of Object.entries(data)) {
    for (const t of expData.tokens) {
      // 补丁：修复字段错放问题
      // 如果twitterUrl不是推文链接（没有/status/），但website是推文链接，交换它们
      let twitterUrl = t.twitterUrl || null;
      let website = t.website || null;

      if (twitterUrl && !twitterUrl.includes('/status/')) {
        // twitterUrl是账号链接，检查website是否是推文链接
        if (website && website.includes('/status/')) {
          // website是真正的推文链接，交换
          console.log(`  🔄 字段修复 [${t.symbol}]: twitterUrl和website字段互换`);
          const temp = twitterUrl;
          twitterUrl = website;
          website = temp;
        } else {
          // 都不是推文链接，清空twitterUrl避免误判
          twitterUrl = null;
        }
      }

      // 获取对应的推文数据
      const tokenTweets = tweetsMap.get(t.symbol) || [];
      const mainTweet = tokenTweets.length > 0 ? tokenTweets[0] : null;

      // 优先使用tweets_with_content.json中的text，其次使用原始数据
      const tweetText = mainTweet?.text || t.twitterText || '';

      // 从twitterUrl中提取tweet_id
      let tweetId = null;
      if (twitterUrl) {
        const match = twitterUrl.match(/status\/(\d+)/);
        if (match) tweetId = match[1];
      }

      // 获取规则评分
      const ruleScores = ruleScoresMap.get(t.address);

      // 获取人工标注
      const humanAnnotation = humanAnnotations.get(t.symbol);

      tokens.push({
        expId,
        symbol: t.symbol,
        address: t.address,

        // 推文信息子对象
        twitter: {
          url: twitterUrl,
          text: tweetText,
          // 从URL提取的tweet_id
          tweetId: tweetId || (mainTweet?.tweet_id || null),
          // 推文交互数据（来自tweets_with_content.json）
          metadata: mainTweet ? {
            tweetId: mainTweet.tweet_id,
            twitterUrl: mainTweet.twitter_url,
            createdAt: mainTweet.created_at,
            user: {
              name: mainTweet.user,
              screenName: mainTweet.user_screen_name
            },
            metrics: {
              favoriteCount: mainTweet.favorite_count,
              retweetCount: mainTweet.retweet_count
            }
          } : null
        },

        // 介绍数据
        intro: {
          en: t.introEn || '',
          cn: t.introCn || '',
          description: t.description || null
        },

        // 其他元数据
        metadata: {
          website: website,
          tiktok: t.tiktok || null
        },

        // 规则评分（从combined_narrative_scores.json获取）
        ruleScores: ruleScores?.scores || null,
        ruleCategory: ruleScores?.narrative_category || null,
        ruleTotalScore: ruleScores?.narrative_score || null,

        // 人工标注
        humanAnnotation: humanAnnotation || null
      });
    }
  }

  return tokens;
}

/**
 * 加载缓存
 */
function loadCache() {
  try {
    if (fs.existsSync(CONFIG.cachePath)) {
      return JSON.parse(fs.readFileSync(CONFIG.cachePath, 'utf-8'));
    }
  } catch (error) {
    console.warn('⚠️  加载缓存失败，将重新分析');
  }
  return {};
}

/**
 * 保存缓存
 */
function saveCache(cache) {
  fs.writeFileSync(CONFIG.cachePath, JSON.stringify(cache, null, 2));
}

/**
 * 加载人工标注数据
 * human_judged_tokens.json 是一个数组，每个元素包含:
 * - token_symbol: 代币符号
 * - human_judges.category: 人工标注分类 (high_quality, mid_quality, low_quality, fake_pump)
 */
function loadHumanAnnotations() {
  try {
    if (fs.existsSync(CONFIG.humanAnnotationPath)) {
      const humanData = JSON.parse(fs.readFileSync(CONFIG.humanAnnotationPath, 'utf-8'));
      const annotations = new Map();

      // human_judged_tokens.json 是一个数组
      if (Array.isArray(humanData)) {
        for (const item of humanData) {
          if (item.human_judges && item.human_judges.category) {
            annotations.set(item.token_symbol, {
              category: item.human_judges.category,
              judgeAt: item.human_judges.judge_at,
              note: item.human_judges.note
            });
          }
        }
      }

      console.log(`   已加载 ${annotations.size} 个代币的人工标注\n`);

      // 统计分布
      const byCategory = { high_quality: 0, mid_quality: 0, low_quality: 0, fake_pump: 0 };
      for (const ann of annotations.values()) {
        if (ann.category && byCategory[ann.category] !== undefined) {
          byCategory[ann.category]++;
        }
      }
      console.log('   人工标注分布:');
      console.log(`     high_quality: ${byCategory.high_quality}个`);
      console.log(`     mid_quality: ${byCategory.mid_quality}个`);
      console.log(`     low_quality: ${byCategory.low_quality}个`);
      if (byCategory.fake_pump > 0) {
        console.log(`     fake_pump: ${byCategory.fake_pump}个`);
      }
      console.log();

      return annotations;
    }
  } catch (error) {
    console.warn('⚠️  加载人工标注失败:', error.message);
  }
  return new Map();
}

/**
 * 使用LLM分析单个代币
 * V3: 移除预处理skip逻辑，让LLM判断内容是否可理解
 * 黑名单检查: 如果推文发布者在黑名单中，直接返回low
 */
async function analyzeToken(llmClient, token) {
  // 黑名单检查：检查推文发布者是否在黑名单中
  const twitterUser = token.twitter?.metadata?.user?.screenName;
  if (twitterUser) {
    const blacklistEntry = checkBlacklist(twitterUser);
    if (blacklistEntry) {
      console.log(`  🚫 黑名单用户: @${twitterUser} (${blacklistEntry.reason})`);
      return {
        success: true,
        data: {
          // 完整输入数据
          symbol: token.symbol,
          address: token.address,
          expId: token.expId,
          twitter: token.twitter,
          intro: token.intro,
          metadata: token.metadata,
          // 黑名单直接判定为low
          llmCategory: 'low',
          llmTotalScore: 0,
          llmReasoning: `推文发布者@${twitterUser}在黑名单中: ${blacklistEntry.reason}`,
          llmScores: null,
          // 规则评分（用于对比）
          ruleScores: token.ruleScores,
          ruleTotalScore: token.ruleTotalScore,
          ruleCategory: token.ruleCategory,
          // 人工标注
          humanAnnotation: token.humanAnnotation,
          // 黑名单标记
          blacklistHit: {
            screenName: twitterUser,
            reason: blacklistEntry.reason,
            addedAt: blacklistEntry.addedAt
          },
          // 方法标识
          method: 'blacklist',
          promptVersion: 'V4',
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  const requestStartTime = Date.now();
  try {
    // V4: 使用严格版Prompt，增加代币实质判断和伪叙事检测
    const prompt = NARRATIVE_ANALYSIS_PROMPT_V4(token);
    const promptSummary = getPromptSummary(token);
    const response = await llmClient.analyze(prompt);
    const requestEndTime = Date.now();
    const responseTime = requestEndTime - requestStartTime;

    // DeepSeek-R1 可能返回<think></think>标签，提取其后的JSON
    let jsonStr = response;
    const thinkEndTag = '</think>';
    const thinkEndIndex = response.indexOf(thinkEndTag);
    if (thinkEndIndex !== -1) {
      jsonStr = response.substring(thinkEndIndex + thinkEndTag.length).trim();
    }

    // 查找JSON代码块
    const jsonMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
                      jsonStr.match(/(\{[\s\S]*?\})/);

    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    // 调试：显示原始响应
    console.log(`  📄 LLM原始响应长度: ${response.length}`);
    console.log(`  📄 提取的JSON长度: ${jsonStr.length}`);
    console.log(`  📄 完整JSON:\n${jsonStr}`);

    // 尝试解析JSON，如果失败则尝试修复
    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch (e) {
      console.log(`  ⚠️  JSON解析失败，尝试修复...`);
      // 尝试修复不完整的JSON
      // 优先检查是否已经包含category（特别是unrated）
      const categoryMatch = jsonStr.match(/"category":\s*"([^"]*)"/);
      const reasoningMatch = jsonStr.match(/"reasoning":\s*"([^"]*)"/);
      const reasoning = reasoningMatch ? reasoningMatch[1] : 'LLM分析';

      // 如果只有category（特别是unrated）但没有scores，构造最小结果
      if (categoryMatch && categoryMatch[1] === 'unrated') {
        result = {
          reasoning,
          scores: { credibility: 0, substance: 0, virality: 0, completeness: 0 },
          total_score: 0,
          category: 'unrated'
        };
        console.log(`  ✅ 修复unrated结果`);
      }
      // 如果有scores但缺少total_score和category，自动计算 (V4)
      else if (jsonStr.includes('"scores"') && (jsonStr.includes('"substance"') || jsonStr.includes('"credibility"'))) {
        try {
          // 尝试提取scores部分
          const scoresMatch = jsonStr.match(/"scores":\s*\{[^}]*\}/);
          if (scoresMatch) {
            const scoresStr = scoresMatch[0];
            const scores = JSON.parse(scoresStr.replace('"scores":', ''));
            const reasoningMatch = jsonStr.match(/"reasoning":\s*"([^"]*)"/);
            const reasoning = reasoningMatch ? reasoningMatch[1] : 'LLM分析';

            // 如果LLM已经返回了category（特别是unrated），优先使用
            let category = categoryMatch ? categoryMatch[1] : null;

            // 如果没有category，计算total_score和category
            if (!category || category === 'null') {
              // V4: 计算total_score和category
              // 分数范围: credibility(40) + substance(35) + virality(15) + completeness(10) = 100
              const totalScore = (scores.credibility || 0) + (scores.substance || 0) +
                                (scores.virality || 0) + (scores.completeness || 0);
              // V4阈值: high≥75, mid≥55, low<55
              if (totalScore >= 75) category = 'high';
              else if (totalScore >= 55) category = 'mid';
              else category = 'low';

              result = {
                reasoning,
                scores,
                total_score: totalScore,
                category
              };
              console.log(`  ✅ 自动修复成功: total_score=${totalScore}, category=${category}`);
            } else {
              // LLM已经返回category（如unrated），计算total_score
              const totalScore = (scores.credibility || 0) + (scores.substance || 0) +
                                (scores.virality || 0) + (scores.completeness || 0);
              result = {
                reasoning,
                scores,
                total_score: totalScore,
                category
              };
              console.log(`  ✅ 使用LLM返回的category: ${category}, total_score=${totalScore}`);
            }
          } else {
            throw new Error('无法提取scores');
          }
        } catch (fixError) {
          throw new Error(`JSON修复失败: ${fixError.message}`);
        }
      } else {
        throw e;
      }
    }

    // 验证结果格式
    // unrated可以没有scores
    if (result.category !== 'unrated' && (!result.scores || typeof result.total_score !== 'number')) {
      throw new Error('LLM返回格式不正确');
    }
    if (!['high', 'mid', 'low', 'unrated'].includes(result.category)) {
      throw new Error('LLM返回格式不正确');
    }

    // 验证分数范围 (V4)
    // unrated没有scores，跳过验证
    if (result.category !== 'unrated' && result.scores) {
      const { scores } = result;
      if (scores.credibility > 40 || scores.substance > 35 ||
          scores.virality > 15 || scores.completeness > 10) {
        throw new Error('分数超出范围');
      }
    }

    return {
      success: true,
      data: {
        // 完整输入数据（新结构）
        symbol: token.symbol,
        address: token.address,
        expId: token.expId,
        // 推文信息子对象
        twitter: token.twitter,
        // 介绍数据子对象
        intro: token.intro,
        // 其他元数据
        metadata: token.metadata,
        // LLM评分结果
        llmReasoning: result.reasoning,
        llmScores: result.scores,
        llmTotalScore: result.total_score,
        llmCategory: result.category,
        // 规则评分（用于对比）
        ruleScores: token.ruleScores,
        ruleTotalScore: token.ruleTotalScore,
        ruleCategory: token.ruleCategory,
        // 人工标注
        humanAnnotation: token.humanAnnotation,
        // 性能数据
        responseTime: responseTime,
        promptLength: prompt.length,
        responseLength: response.length,
        // Prompt数据
        promptSummary: promptSummary,
        fullPrompt: prompt,
        // 方法标识
        method: 'llm',
        promptVersion: 'V4',
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    console.error(`❌ 分析代币 ${token.symbol} 失败:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 顺序分析代币（一个接一个）
 */
async function analyzeSequential(llmClient, tokens, cache) {
  const results = [];
  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;
  let cachedCount = 0;

  // 响应时间统计
  const responseTimes = [];

  console.log(`\n🚀 开始LLM叙事分析 (${tokens.length}个代币)`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const cacheKey = `${token.expId}_${token.address}`;

    console.log(`[${i + 1}/${tokens.length}] 分析 ${token.symbol}...`);

    // 检查缓存
    if (cache[cacheKey]) {
      console.log(`  ✅ 使用缓存: ${cache[cacheKey].llmCategory} (${cache[cacheKey].llmTotalScore}分)\n`);
      results.push({ token, result: cache[cacheKey], cached: true });
      cachedCount++;
      continue;
    }

    // 调用LLM分析
    const analysisResult = await analyzeToken(llmClient, token);

    if (analysisResult.success) {
      console.log(`  ✅ LLM评分: ${analysisResult.data.llmCategory} (${analysisResult.data.llmTotalScore}分)`);
      console.log(`     规则评分: ${token.ruleCategory} (${token.ruleTotalScore}分)`);
      console.log(`     响应时间: ${analysisResult.data.responseTime}ms`);
      console.log(`     理由: ${analysisResult.data.llmReasoning.substring(0, 50)}...\n`);

      // 更新缓存
      cache[cacheKey] = analysisResult.data;
      saveCache(cache);

      results.push({ token, result: analysisResult.data, cached: false });
      successCount++;
      // 记录响应时间
      responseTimes.push(analysisResult.data.responseTime);
    } else {
      console.log(`  ❌ 失败: ${analysisResult.error}\n`);
      results.push({ token, result: null, error: analysisResult.error, cached: false });
      failCount++;
    }

    // 每10个代币保存一次进度
    if ((i + 1) % 10 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const avgTime = (elapsed / (i + 1)).toFixed(1);
      console.log(`📊 进度: ${i + 1}/${tokens.length} (${((i + 1) / tokens.length * 100).toFixed(1)}%) | 已耗时: ${elapsed}s | 平均: ${avgTime}s/个\n`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ 分析完成！耗时 ${elapsed} 秒`);
  console.log(`   成功: ${successCount} | 缓存: ${cachedCount} | 失败: ${failCount}`);

  // 显示响应时间统计
  if (responseTimes.length > 0) {
    const avgTime = Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
    const minTime = Math.min(...responseTimes);
    const maxTime = Math.max(...responseTimes);
    console.log(`\n📊 响应时间统计:`);
    console.log(`   平均: ${avgTime}ms | 最快: ${minTime}ms | 最慢: ${maxTime}ms`);
  }

  return results;
}

/**
 * 整理结果并按实验分组
 */
function organizeResults(analysisResults) {
  const organized = {};

  for (const { token, result } of analysisResults) {
    if (!result) continue;

    if (!organized[token.expId]) {
      organized[token.expId] = { tokens: [] };
    }

    organized[token.expId].tokens.push({
      symbol: token.symbol,
      address: token.address,
      twitterText: token.twitterText,
      introEn: token.introEn,
      introCn: token.introCn,

      // 规则评分
      ruleScores: token.ruleScores,
      ruleCategory: token.ruleCategory,
      ruleTotalScore: token.ruleTotalScore,

      // LLM评分
      llmReasoning: result.llmReasoning,
      llmScores: result.llmScores,
      llmCategory: result.llmCategory,
      llmTotalScore: result.llmTotalScore,
      // 跳过原因（用于unrated代币）
      skipReason: result.skipReason,
      // 人工标注
      humanAnnotation: result.humanAnnotation,
      // 新增：响应时间数据
      responseTime: result.responseTime,
      promptLength: result.promptLength,
      responseLength: result.responseLength,
      // V2新增：完整prompt和摘要
      fullPrompt: result.fullPrompt || '',
      promptSummary: result.promptSummary || {}
    });
  }

  return organized;
}

/**
 * 对比规则评分和LLM评分
 */
function compareScores(organized) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    规则评分 vs LLM评分对比');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let totalTokens = 0;
  let agreement = 0;
  let disagreement = 0;
  const comparison = { high: {}, mid: {}, low: {} };

  for (const [expId, expData] of Object.entries(organized)) {
    for (const t of expData.tokens) {
      totalTokens++;

      const rule = t.ruleCategory;
      const llm = t.llmCategory;

      if (rule === llm) {
        agreement++;
      } else {
        disagreement++;
        if (!comparison[rule][llm]) comparison[rule][llm] = 0;
        comparison[rule][llm]++;
      }
    }
  }

  console.log(`总代币数: ${totalTokens}`);
  console.log(`评级一致: ${agreement} (${(agreement/totalTokens*100).toFixed(1)}%)`);
  console.log(`评级不一致: ${disagreement} (${(disagreement/totalTokens*100).toFixed(1)}%)`);

  console.log('\n不一致详情 (规则 -> LLM):');
  console.log('─────────────────────────────────────────────────────────────');

  const transitions = [
    { from: 'high', to: 'mid', label: '高→中' },
    { from: 'high', to: 'low', label: '高→低' },
    { from: 'mid', to: 'high', label: '中→高' },
    { from: 'mid', to: 'low', label: '中→低' },
    { from: 'low', to: 'mid', label: '低→中' },
    { from: 'low', to: 'high', label: '低→高' }
  ];

  for (const { from, to, label } of transitions) {
    const count = comparison[from][to] || 0;
    if (count > 0) {
      console.log(`  ${label}: ${count}个`);
    }
  }
}

/**
 * 统计LLM评分分布
 */
function showLLMStats(organized) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    LLM评分分布统计');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let highCount = 0, midCount = 0, lowCount = 0;
  const allTokens = [];

  for (const [expId, expData] of Object.entries(organized)) {
    for (const t of expData.tokens) {
      allTokens.push({ expId, ...t });
      if (t.llmCategory === 'high') highCount++;
      else if (t.llmCategory === 'mid') midCount++;
      else lowCount++;
    }
  }

  console.log(`🟢 高质量 (≥60分): ${highCount} (${(highCount/allTokens.length*100).toFixed(1)}%)`);
  console.log(`🟡 中质量 (40-59分): ${midCount} (${(midCount/allTokens.length*100).toFixed(1)}%)`);
  console.log(`🔴 低质量 (<40分): ${lowCount} (${(lowCount/allTokens.length*100).toFixed(1)}%)`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    LLM评分 TOP 10');
  console.log('═══════════════════════════════════════════════════════════════\n');

  allTokens.sort((a, b) => b.llmTotalScore - a.llmTotalScore);

  console.log('排名  代币          实验      LLM评分  LLM评级  规则评分  规则评级  分析理由');
  console.log('────  ───────────  ────────  ───────  ───────  ───────  ───────  ───────────────────────────────────────');

  allTokens.slice(0, 10).forEach((t, i) => {
    const levelMap = { high: '🟢高', mid: '🟡中', low: '🔴低' };
    const reasoning = t.llmReasoning.substring(0, 35).replace(/\n/g, ' ');
    console.log(
      `${String(i + 1).padStart(4)}  ${t.symbol.padEnd(12)}  ${t.expId.padStart(7)}  ` +
      `${String(t.llmTotalScore).padStart(6)}  ${levelMap[t.llmCategory]}  ` +
      `${String(t.ruleTotalScore).padStart(6)}  ${levelMap[t.ruleCategory]}  ${reasoning}...`
    );
  });
}

/**
 * 主函数
 */
async function main() {
  try {
    // 验证API Key
    if (!CONFIG.apiKey || CONFIG.apiKey.startsWith('your_')) {
      console.error('❌ 请在 config/.env 中设置 API_KEY');
      process.exit(1);
    }

    // 创建LLM客户端
    const llmClient = new LLMClient(CONFIG.llmType, {
      baseUrl: CONFIG.baseUrl,
      model: CONFIG.model,
      maxTokens: CONFIG.maxTokens,
      timeout: CONFIG.timeout,
      apiKey: CONFIG.apiKey,
      delay: 300  // 每次请求间隔300ms
    });

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                  LLM代币叙事分析系统');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`模型: ${CONFIG.model}`);
    console.log(`API地址: ${CONFIG.baseUrl}`);
    console.log(`超时: ${CONFIG.timeout}ms`);
    console.log(`分析模式: 顺序调用（避免并发问题）\n`);

    // 加载数据
    console.log('📂 加载代币数据...');
    console.log('📂 加载人工标注...');
    const humanAnnotations = loadHumanAnnotations();
    let tokens = loadTokenData(humanAnnotations);
    console.log(`   已加载 ${tokens.length} 个代币\n`);

    // 测试模式：限制处理数量
    if (CONFIG.testLimit && CONFIG.testLimit > 0) {
      console.log(`🧪 测试模式：只处理前 ${CONFIG.testLimit} 个代币\n`);
      tokens = tokens.slice(0, CONFIG.testLimit);
    }

    console.log('💾 加载分析缓存...');
    const cache = loadCache();
    console.log(`   已缓存 ${Object.keys(cache).length} 个分析结果\n`);

    // 顺序分析
    const analysisResults = await analyzeSequential(llmClient, tokens, cache);

    // 整理结果
    const organized = organizeResults(analysisResults);

    // 保存结果
    fs.writeFileSync(CONFIG.outputPath, JSON.stringify(organized, null, 2));
    console.log(`\n💾 结果已保存到: ${CONFIG.outputPath}`);

    // 打印统计
    compareScores(organized);
    showLLMStats(organized);

    // 打印LLM使用统计
    llmClient.printStats();

    // 保存详细分析日志（包含prompt和响应信息）
    const llmDataDir = path.resolve(__dirname, 'data');
    const mainDataDir = path.resolve(__dirname, '../../data');
    const analysisLogPath = path.resolve(llmDataDir, 'llm_analysis_log.json');
    const promptLogPath = path.resolve(llmDataDir, 'llm_prompt_log.json');

    const analysisLog = {
      timestamp: new Date().toISOString(),
      model: CONFIG.model,
      promptVersion: 'V4',
      totalTokens: tokens.length,
      config: {
        baseUrl: CONFIG.baseUrl,
        maxTokens: CONFIG.maxTokens,
        timeout: CONFIG.timeout
      },
      // 详细记录每次分析的信息（用于prompt优化）
      analysisDetails: analysisResults
        .filter(r => !r.cached && r.result)
        .map(r => ({
          symbol: r.token.symbol,
          address: r.token.address,
          expId: r.token.expId,
          // 输入数据
          input: {
            twitterText: r.token.twitterText?.substring(0, 200) + '...',
            introEn: r.token.introEn,
            introCn: r.token.introCn
          },
          // 性能数据
          performance: {
            responseTime: r.result.responseTime,
            promptLength: r.result.promptLength,
            responseLength: r.result.responseLength
          },
          // 评分结果
          scores: {
            llm: { total: r.result.llmTotalScore, category: r.result.llmCategory },
            rule: { total: r.token.ruleTotalScore, category: r.token.ruleCategory }
          },
          reasoning: r.result.llmReasoning,
          // V2新增：prompt摘要
          promptSummary: r.result.promptSummary
        }))
    };
    fs.writeFileSync(analysisLogPath, JSON.stringify(analysisLog, null, 2));
    console.log(`\n💾 详细分析日志已保存: ${analysisLogPath}`);

    // 保存完整的prompt日志（用于详细审查）
    const promptLog = {
      timestamp: new Date().toISOString(),
      model: CONFIG.model,
      promptVersion: 'V4',
      prompts: analysisResults
        .filter(r => !r.cached && r.result)
        .map(r => ({
          symbol: r.token.symbol,
          address: r.token.address,
          expId: r.token.expId,
          // 完整输入数据
          inputData: {
            twitterText: r.token.twitterText,
            introEn: r.token.introEn,
            introCn: r.token.introCn
          },
          // 完整prompt
          fullPrompt: r.result.fullPrompt,
          // LLM响应
          llmResponse: r.result.llmReasoning,
          // 评分
          scores: {
            llm: {
              total: r.result.llmTotalScore,
              category: r.result.llmCategory,
              details: r.result.llmScores
            },
            rule: {
              total: r.token.ruleTotalScore,
              category: r.token.ruleCategory,
              details: r.token.ruleScores
            }
          },
          performance: {
            responseTime: r.result.responseTime,
            promptLength: r.result.promptLength,
            responseLength: r.result.responseLength
          }
        }))
    };
    fs.writeFileSync(promptLogPath, JSON.stringify(promptLog, null, 2));
    console.log(`💾 完整Prompt日志已保存: ${promptLogPath}`);

    // 构建rule_cache.json（规则评分缓存，结构与llm_cache.json一致）
    console.log('\n📝 构建规则评分缓存...');
    const ruleCache = {};
    for (const token of tokens) {
      const cacheKey = `${token.expId}_${token.address}`;
      ruleCache[cacheKey] = {
        // 完整输入数据
        symbol: token.symbol,
        address: token.address,
        expId: token.expId,
        twitterUrl: token.twitterUrl,
        twitterText: token.twitterText,
        tweetId: token.tweetId,
        tweetData: token.tweetData,
        introEn: token.introEn,
        introCn: token.introCn,
        description: token.description,
        website: token.website,
        tiktok: token.tiktok,
        // 规则评分结果
        ruleScores: token.ruleScores,
        ruleTotalScore: token.ruleTotalScore,
        ruleCategory: token.ruleCategory,
        // 方法标识
        method: 'rule',
        promptVersion: 'N/A'
      };
    }
    fs.writeFileSync(CONFIG.ruleCachePath, JSON.stringify(ruleCache, null, 2));
    console.log(`💾 规则评分缓存已保存: ${CONFIG.ruleCachePath}`);

    // 显示缓存统计
    console.log('\n📊 缓存统计:');
    console.log(`   LLM缓存: ${Object.keys(cache).length} 个代币`);
    console.log(`   规则缓存: ${Object.keys(ruleCache).length} 个代币`);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  分析完成！规则评分和LLM评分已保存，可进行对比分析。');
    console.log('═══════════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ 发生错误:', error);
    process.exit(1);
  }
}

main();
