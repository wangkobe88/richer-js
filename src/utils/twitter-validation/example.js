/**
 * Twitter验证模块使用示例
 * 展示如何在其他模块中使用twitter-validation.js
 */

const twitterValidation = require('./index');

/**
 * 示例1: 基本使用 - 验证单个代币
 */
async function basicExample() {
  console.log('=== 示例1: 基本使用 ===');

  try {
    const tokenAddress = '11111111111111111111111111111111';

    // 使用默认配置验证代币
    const result = await twitterValidation.validateTokenOnTwitter(tokenAddress);

    console.log(`代币地址: ${tokenAddress}`);
    console.log(`验证结果: ${result.has_mentions ? '✅ 通过' : '❌ 失败'}`);
    console.log(`高质量推文数: ${result.tweet_count}`);
    console.log(`总搜索结果: ${result.total_search_results}`);

    if (result.relevant_tweets && result.relevant_tweets.length > 0) {
      console.log('\n热门推文:');
      result.relevant_tweets.slice(0, 3).forEach((tweet, index) => {
        console.log(`${index + 1}. @${tweet.user.screen_name} - ${tweet.metrics.total_engagement} 互动`);
      });
    }

  } catch (error) {
    console.error('验证失败:', error.message);
  }
}

/**
 * 示例2: 自定义配置验证
 */
async function customConfigExample() {
  console.log('\n=== 示例2: 自定义配置 ===');

  try {
    const tokenAddress = '11111111111111111111111111111111';

    // 自定义配置
    const result = await twitterValidation.validateTokenOnTwitter(tokenAddress, {
      minTweetCount: 5,        // 要求至少5条高质量推文
      maxRetries: 5,          // 最大重试5次
      timeout: 60000,         // 超时时间60秒
      retryDelay: 3000        // 重试延迟3秒
    });

    console.log(`自定义配置验证结果: ${result.has_mentions ? '通过' : '失败'}`);
    console.log(`最小推文要求: 5, 实际高质量推文: ${result.tweet_count}`);
    console.log(`筛选原因: ${result.analysis_details?.filter_reason}`);

  } catch (error) {
    console.error('自定义配置验证失败:', error.message);
  }
}

/**
 * 示例3: 使用验证器实例
 */
async function validatorInstanceExample() {
  console.log('\n=== 示例3: 验证器实例 ===');

  try {
    // 创建验证器实例
    const validator = twitterValidation.createTwitterTokenValidator({
      maxRetries: 2,
      timeout: 30000
    });

    const tokenAddress = '11111111111111111111111111111111';

    // 验证代币
    const result = await validator.validateTokenMentions(tokenAddress, 3);

    // 获取详细摘要
    const summary = validator.getValidationSummary(result);

    console.log('验证器实例结果:');
    console.log(summary);

    // 显示详细统计信息
    const stats = result.analysis_details?.statistics;
    if (stats) {
      console.log('\n详细统计:');
      console.log(`  总互动数: ${stats.total_engagement}`);
      console.log(`  平均互动: ${stats.avg_engagement.toFixed(2)}`);
      console.log(`  认证用户: ${stats.verified_users}`);
      console.log(`  24小时内推文: ${stats.recent_tweets}`);
    }

  } catch (error) {
    console.error('验证器实例测试失败:', error.message);
  }
}

/**
 * 示例4: 批量验证多个代币
 */
async function batchValidationExample() {
  console.log('\n=== 示例4: 批量验证 ===');

  try {
    const tokenAddresses = [
      '11111111111111111111111111111111',  // Solana系统程序
      'TokenKepegDeskmguPzdrf1HLMPfobc9x4', // 另一个地址
      'unknownaddress123456789'              // 未知地址
    ];

    console.log(`开始批量验证 ${tokenAddresses.length} 个代币地址...`);

    const results = await twitterValidation.batchValidateTokens(tokenAddresses, {
      minTweetCount: 1,
      timeout: 30000
    });

    console.log('\n批量验证结果:');
    results.forEach((result, index) => {
      console.log(`${index + 1}. ${result.address.slice(0, 20)}...: ${result.valid ? '✅ 有效' : '❌ 无效'}`);
      console.log(`   ${result.summary}`);
    });

    return results;

  } catch (error) {
    console.error('批量验证失败:', error.message);
    return [];
  }
}

/**
 * 示例5: 统计分析和过滤
 */
async function statisticsExample() {
  console.log('\n=== 示例5: 统计分析 ===');

  try {
    // 先执行批量验证
    const batchResults = await batchValidationExample();

    if (batchResults.length === 0) {
      console.log('没有验证结果可以分析');
      return;
    }

    // 过滤有效代币
    const validTokens = twitterValidation.filterValidTokens(batchResults);
    console.log(`\n有效代币 (${validTokens.length}个):`);
    validTokens.forEach(token => {
      console.log(`  - ${token}`);
    });

    // 获取详细统计信息
    const stats = twitterValidation.getValidationStatistics(batchResults);

    console.log('\n📊 验证统计信息:');
    console.log(`  总验证数量: ${stats.total}`);
    console.log(`  有效代币数: ${stats.valid}`);
    console.log(`  无效代币数: ${stats.invalid}`);
    console.log(`  通过率: ${stats.valid_rate}`);
    console.log(`  总推文数: ${stats.total_tweets}`);
    console.log(`  总互动数: ${stats.total_engagement}`);
    console.log(`  平均每代币推文数: ${stats.avg_tweets_per_token}`);

    // 计算有效性比例
    if (stats.total > 0) {
      const validPercentage = (stats.valid / stats.total * 100).toFixed(1);
      const avgEngagement = (stats.total_engagement / stats.total_tweets || 0).toFixed(2);

      console.log(`\n📈 额外分析:`);
      console.log(`  代币有效性比例: ${validPercentage}%`);
      console.log(`  平均每条推文互动: ${avgEngagement}`);
    }

  } catch (error) {
    console.error('统计分析失败:', error.message);
  }
}

/**
 * 示例6: 错误处理和重试
 */
async function errorHandlingExample() {
  console.log('\n=== 示例6: 错误处理 ===');

  try {
    // 测试网络超时配置
    console.log('测试网络超时处理:');
    const result1 = await twitterValidation.validateTokenOnTwitter('11111111111111111111111111111111', {
      timeout: 5000,  // 很短的超时时间
      maxRetries: 1
    });
    console.log(`短超时测试: ${result1.has_mentions ? '成功' : '失败或超时'}`);

    // 测试无效地址
    console.log('\n测试无效地址:');
    const result2 = await twitterValidation.validateTokenOnTwitter('invalid_address_format');
    console.log(`无效地址结果: ${result2.has_mentions ? '意外成功' : '预期失败'}`);
    console.log(`失败原因: ${result2.reason}`);

    // 测试空地址
    console.log('\n测试空地址:');
    const result3 = await twitterValidation.validateTokenOnTwitter('');
    console.log(`空地址结果: ${result3.reason || '无原因'}`);

  } catch (error) {
    console.log('✓ 正确捕获异常:', error.message);
  }
}

/**
 * 示例7: 在实际业务中使用
 */
async function businessExample() {
  console.log('\n=== 示例7: 业务应用场景 ===');

  try {
    // 模拟一个代币分析服务
    class TokenAnalysisService {
      constructor() {
        this.twitterValidator = twitterValidation.createTwitterTokenValidator({
          minTweetCount: 2,
          maxRetries: 3,
          timeout: 30000
        });
      }

      async analyzeToken(tokenAddress) {
        console.log(`\n🔍 开始分析代币: ${tokenAddress}`);

        const analysis = {
          address: tokenAddress,
          timestamp: new Date(),
          twitterValidation: null,
          overallScore: 0,
          recommendation: null
        };

        try {
          // Twitter验证
          analysis.twitterValidation = await this.twitterValidator.validateTokenMentions(tokenAddress);

          // 计算综合评分 (示例逻辑)
          const tweetCount = analysis.twitterValidation.tweet_count;
          const engagement = analysis.twitterValidation.analysis_details?.statistics?.total_engagement || 0;

          if (tweetCount >= 5 && engagement > 100) {
            analysis.overallScore = 85;
            analysis.recommendation = '推荐投资 - Twitter提及活跃且互动良好';
          } else if (tweetCount >= 2) {
            analysis.overallScore = 60;
            analysis.recommendation = '谨慎考虑 - 有一定Twitter提及但互动有限';
          } else {
            analysis.overallScore = 30;
            analysis.recommendation = '不推荐 - 缺乏有效的Twitter提及';
          }

        } catch (error) {
          analysis.twitterValidation = {
            has_mentions: false,
            reason: error.message
          };
          analysis.overallScore = 10;
          analysis.recommendation = '分析失败 - 无法获取Twitter数据';
        }

        return analysis;
      }
    }

    // 使用业务服务
    const analysisService = new TokenAnalysisService();
    const tokensToAnalyze = [
      '11111111111111111111111111111111',
      'TokenKepegDeskmguPzdrf1HLMPfobc9x4'
    ];

    const analyses = [];

    for (const token of tokensToAnalyze) {
      const analysis = await analysisService.analyzeToken(token);
      analyses.push(analysis);

      console.log(`分析结果:`);
      console.log(`  Twitter验证: ${analysis.twitterValidation.has_mentions ? '✅' : '❌'}`);
      console.log(`  综合评分: ${analysis.overallScore}/100`);
      console.log(`  投资建议: ${analysis.recommendation}`);
    }

    return analyses;

  } catch (error) {
    console.error('业务示例失败:', error.message);
  }
}

/**
 * 运行所有示例
 */
async function runAllExamples() {
  console.log('开始运行Twitter验证模块示例...\n');

  await basicExample();
  await customConfigExample();
  await validatorInstanceExample();
  await statisticsExample();
  await errorHandlingExample();
  await businessExample();

  console.log('\n所有示例运行完成！');
}

// 如果直接运行此文件，执行所有示例
if (require.main === module) {
  runAllExamples();
}

module.exports = {
  basicExample,
  customConfigExample,
  validatorInstanceExample,
  batchValidationExample,
  statisticsExample,
  errorHandlingExample,
  businessExample,
  runAllExamples
};