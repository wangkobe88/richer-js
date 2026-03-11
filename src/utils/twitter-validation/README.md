# Twitter代币验证模块

这是一个用于验证代币在Twitter上提及情况的JavaScript模块。模块集成了API Key，支持直接函数调用，无需外部依赖。

## 🚀 快速开始

### 基本使用

```javascript
const twitterValidation = require('./components/twitter-validation/index');

// 验证单个代币
const result = await twitterValidation.validateTokenOnTwitter('0x1234...abcd');

console.log(`验证结果: ${result.has_mentions ? '✅ 通过' : '❌ 失败'}`);
console.log(`高质量推文数: ${result.tweet_count}`);
```

### 批量验证

```javascript
// 批量验证多个代币
const results = await twitterValidation.batchValidateTokens([
  '0x1234...abcd',
  '0x5678...efgh',
  '0x9abc...def0'
]);

// 过滤有效代币
const validTokens = twitterValidation.filterValidTokens(results);

// 获取统计信息
const stats = twitterValidation.getValidationStatistics(results);
console.log(`通过率: ${stats.valid_rate}`);
```

## 📋 API函数

### 主要函数

#### `validateTokenOnTwitter(tokenAddress, options)`

验证单个代币地址的Twitter提及情况。

**参数:**
- `tokenAddress` (string): 代币合约地址
- `options` (object): 配置选项
  - `minTweetCount` (number): 最小推文数量要求，默认2
  - `maxRetries` (number): 最大重试次数，默认3
  - `retryDelay` (number): 重试延迟(ms)，默认2000
  - `timeout` (number): 请求超时(ms)，默认30000

**返回:**
```javascript
{
  has_mentions: boolean,        // 是否有有效提及
  tweet_count: number,          // 高质量推文数量
  low_quality_count: number,    // 低质量推文数量
  relevant_tweets: Array,       // 高质量推文列表（前5条）
  total_search_results: number, // 总搜索结果数
  analysis_details: Object,     // 详细分析结果
  search_time: Date           // 搜索时间
}
```

#### `batchValidateTokens(tokenAddresses, options)`

批量验证多个代币地址。

**参数:**
- `tokenAddresses` (string[]): 代币地址数组
- `options` (object): 配置选项

**返回:** 验证结果数组

#### `filterValidTokens(validationResults)`

从验证结果中过滤出通过验证的代币地址。

**返回:** string[] - 通过验证的代币地址数组

#### `getValidationStatistics(validationResults)`

获取验证统计信息。

**返回:**
```javascript
{
  total: number,              // 总数
  valid: number,              // 通过数量
  invalid: number,            // 未通过数量
  valid_rate: string,         // 通过率
  total_tweets: number,       // 总推文数
  total_engagement: number,   // 总互动数
  avg_tweets_per_token: number // 平均每代币推文数
}
```

#### `createTwitterTokenValidator(options)`

创建验证器实例，用于多次验证。

**返回:** TwitterTokenValidator 实例

## 🛠️ 高级用法

### 使用验证器实例

```javascript
const validator = twitterValidation.createTwitterTokenValidator({
  maxRetries: 5,
  timeout: 60000
});

const result = await validator.validateTokenMentions('0x1234...abcd', 3);
const summary = validator.getValidationSummary(result);
```

### 自定义配置

```javascript
const result = await twitterValidation.validateTokenOnTwitter(address, {
  minTweetCount: 5,        // 要求至少5条高质量推文
  maxRetries: 5,          // 最大重试5次
  timeout: 60000,         // 超时时间60秒
  retryDelay: 3000        // 重试延迟3秒
});
```

### 业务集成示例

```javascript
// 在代币分析服务中使用
class TokenAnalysisService {
  constructor() {
    this.twitterValidator = twitterValidation.createTwitterTokenValidator({
      minTweetCount: 2,
      maxRetries: 3
    });
  }

  async analyzeToken(tokenAddress) {
    const twitterResult = await this.twitterValidator.validateTokenMentions(tokenAddress);

    return {
      address: tokenAddress,
      twitterValid: twitterResult.has_mentions,
      tweetCount: twitterResult.tweet_count,
      engagement: twitterResult.analysis_details?.statistics?.total_engagement || 0
    };
  }
}
```

## 📊 数据结构

### 验证结果结构

```javascript
{
  has_mentions: boolean,        // 是否有有效提及
  tweet_count: number,          // 高质量推文数量
  low_quality_count: number,    // 低质量推文数量
  relevant_tweets: [            // 高质量推文列表
    {
      tweet_id: string,
      text: string,
      created_at: string,
      user: {
        screen_name: string,
        name: string,
        followers_count: number,
        verified: boolean
      },
      metrics: {
        favorite_count: number,
        retweet_count: number,
        reply_count: number,
        total_engagement: number
      },
      is_quality: boolean
    }
  ],
  total_search_results: number, // 总搜索结果数
  analysis_details: {           // 详细分析结果
    has_mentions: boolean,
    total_tweets: number,
    quality_count: number,
    low_quality_count: number,
    statistics: {
      total_engagement: number,
      avg_engagement: number,
      total_followers: number,
      verified_users: number,
      recent_tweets: number
    }
  },
  search_time: Date,           // 搜索时间
  reason: string               // 失败原因（如有）
}
```

## 🔧 配置说明

### 默认配置

```javascript
{
  apiKey: 'llfo2ip8ghxvivzo77tugorx3dz7xf',  // 集成的API Key
  baseUrl: 'https://api.apidance.pro',         // API基础URL
  timeout: 30000,                               // 请求超时30秒
  maxRetries: 3,                                // 最大重试3次
  retryDelay: 2000                              // 重试延迟2秒
}
```

### 质量标准

- **高质量推文**: 总互动数（点赞+转发+回复）> 4
- **低质量推文**: 总互动数 ≤ 4
- **推文相关性**: 通过搜索关键词自动匹配

## ⚠️ 错误处理

模块自动处理以下错误情况：

- 网络连接错误（自动重试）
- API限流错误（自动重试）
- 请求超时（自动重试）
- 无效代币地址格式
- API响应错误

所有验证结果都包含错误信息，确保程序不会因验证失败而中断。

## 🧪 测试

### 运行测试

```bash
# 基本功能测试
node components/twitter-validation/test.js

# 详细使用示例
node components/twitter-validation/example.js
```

### 测试内容

- ✅ 基本验证功能
- ✅ 批量验证
- ✅ 错误处理
- ✅ 配置管理
- ✅ 统计分析

## 📈 性能特性

- **无外部依赖**: 使用原生fetch API
- **自动重试**: 网络错误自动重试机制
- **超时控制**: 可配置的请求超时
- **批量处理**: 支持多代币同时验证
- **结果缓存**: 避免重复API调用

## 🔒 API Key说明

模块已集成API Key `llfo2ip8ghxvivzo77tugorx3dz7xf`，该Key直接嵌入在代码中，无需额外配置。API服务提供商为 `apidance.pro`。

## 📝 注意事项

1. **API限制**: 请注意API调用频率限制，避免过频调用
2. **网络依赖**: 需要稳定的网络连接才能正常工作
3. **地址格式**: 支持各种代币地址格式，包括Solana、Ethereum等
4. **质量筛选**: 只有互动量 > 4 的推文被认为是高质量的
5. **实时数据**: Twitter数据是实时的，不同时间点的验证结果可能不同

## 🎯 最佳实践

1. **批量验证**: 对多个代币使用 `batchValidateTokens` 提高效率
2. **错误处理**: 始终用try-catch包装API调用
3. **配置调优**: 根据需要调整 `minTweetCount` 和重试参数
4. **结果分析**: 结合统计信息做出更准确的判断
5. **缓存策略**: 对相同地址可以缓存验证结果避免重复调用

## 📞 支持

如有问题或需要帮助，请查看：
- 测试文件: `components/twitter-validation/test.js`
- 使用示例: `components/twitter-validation/example.js`
- 原有代码备份: `components/twitter-validation-backup/`