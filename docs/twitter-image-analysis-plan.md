# Twitter 图片分析方案

## 概述

当推文的主要内容是图片时，需要使用多模态 LLM 来理解图片内容。本方案整合了 Twitter 图片提取、图片下载和硅基流动多模态 API 调用。

## 技术验证

### 1. Twitter API 图片数据

Twitter GraphQL API 的 `legacy.extended_entities.media` 字段包含图片信息：

```json
{
  "media_url_https": "https://pbs.twimg.com/media/HDMmdflbQAMAKTT.png",
  "type": "photo",
  "original_info": {
    "width": 170,
    "height": 250
  }
}
```

### 2. 硅基流动多模态 API

- **端点**: `https://api.siliconflow.cn/v1/chat/completions`
- **模型**: `Pro/moonshotai/Kimi-K2.5`
- **输入格式**: 图片需要使用 base64 编码（`data:image/png;base64,{base64_string}`）
- **API Key**: `SILICONFLOW_API_KEY`（已配置在 .env 中）

**测试结果**：
- 成功识别出"微笑狗"表情包
- 详细描述了狗狗的特征、背景和梗图的含义

## 组件设计

### 组件 1: Twitter 图片提取器

**文件**: `src/narrative/utils/twitter-media-extractor.mjs`

**职责**:
- 从 `getTweetDetailGraphQL` 返回的推文数据中提取图片信息
- 返回标准化的图片 URL 列表

**接口**:
```javascript
export class TwitterMediaExtractor {
  /**
   * 从推文数据中提取图片 URL
   * @param {Object} tweetData - getTweetDetailGraphQL 返回的推文数据
   * @returns {Array<{url: string, type: string, width: number, height: number}>}
   */
  static extractImageUrls(tweetData)
}
```

### 组件 2: 图片下载器

**文件**: `src/narrative/utils/image-downloader.mjs`

**职责**:
- 下载图片并转换为 base64 格式
- 支持多种图片格式（PNG, JPG, GIF等）
- 处理下载失败的情况

**接口**:
```javascript
export class ImageDownloader {
  /**
   * 下载图片并转换为 base64
   * @param {string} imageUrl - 图片 URL
   * @param {Object} options - 选项
   * @param {number} options.maxSize - 最大文件大小（字节），默认 5MB
   * @param {number} options.timeout - 请求超时（毫秒），默认 10000
   * @returns {Promise<{base64: string, mimeType: string, size: number}|null>}
   */
  static async downloadAsBase64(imageUrl, options = {})
}
```

### 组件 3: 多模态 LLM 客户端（扩展现有 LLMClient）

**文件**: `src/narrative/analyzer/llm-client.mjs`（扩展）

**新增功能**:
- 支持多模态分析（图片 + 文本）
- 使用 `Pro/moonshotai/Kimi-K2.5` 模型

**新增接口**:
```javascript
export class LLMClient {
  /**
   * 分析图片内容（多模态）
   * @param {string} base64Image - base64 编码的图片
   * @param {string} prompt - 分析提示词
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 图片分析结果
   */
  static async analyzeImage(base64Image, prompt, options = {})
}
```

### 组件 4: 叙事分析器整合

**文件**: `src/narrative/analyzer/NarrativeAnalyzer.mjs`（修改）

**修改点**:
1. 调用 `getTweetDetailGraphQL` 后，检查是否有图片
2. 如果有图片，调用图片分析流程
3. 将图片分析结果整合到 `twitterInfo` 中

**新增字段**:
```javascript
{
  // 现有字段...
  twitter_info: {
    // ... 现有字段
    images: [
      {
        url: "https://pbs.twimg.com/media/HDMmdflbQAMAKTT.png",
        analysis: {
          description: "这张图片展示了一只微笑狗...",
          meme_meaning: "得意洋洋、幸灾乐祸...",
          key_elements: ["狗", "微笑", "门垫", "红色项圈"]
        }
      }
    ]
  }
}
```

## 数据流程

```
1. NarrativeAnalyzer.analyze()
   └─> TwitterFetcher.fetchFromUrl()
       └─> getTweetDetailGraphQL()
           └─> 返回推文数据（包含 media 信息）

2. TwitterMediaExtractor.extractImageUrls(tweetData)
   └─> 提取图片 URL 列表

3. ImageDownloader.downloadAsBase64(imageUrl)
   └─> 下载图片
   └─> 转换为 base64

4. LLMClient.analyzeImage(base64Image, prompt)
   └─> 调用硅基流动多模态 API
   └─> 返回图片分析结果

5. 将分析结果整合到 twitterInfo.images
```

## Prompt 设计

### 图片分析 Prompt

```
请分析这张 Twitter 推文配图，用于代币叙事分析。

请提供以下信息：
1. **图片内容描述**：详细描述图片中的主体、人物、动物、文字等
2. **梗图/表情包识别**：如果是流行梗图或表情包，请指出其名称和常见含义
3. **关键元素**：列出图片中的所有关键元素（如人物、动物、符号、文字等）
4. **情感色彩**：图片传达的情感基调（如幽默、讽刺、严肃等）
5. **代币关联性**：如果图片内容可能与某个代币、人物或概念相关，请指出

请以 JSON 格式返回：
{
  "description": "图片内容描述",
  "meme_type": "梗图/表情包名称（如果有）",
  "meme_meaning": "梗图含义（如果是梗图）",
  "key_elements": ["元素1", "元素2", ...],
  "emotion": "情感基调",
  "token_relevance": "可能的代币关联（如果有）"
}
```

## 实现优先级

### Phase 1: 基础组件（独立实现）
1. ✅ 修改 `getTweetDetailGraphQL` 解析 media 信息
2. ✅ 创建 `TwitterMediaExtractor` 组件
3. ✅ 创建 `ImageDownloader` 组件
4. ✅ 扩展 `LLMClient` 支持多模态分析

### Phase 2: 整合测试
1. ✅ 在 `NarrativeAnalyzer` 中整合图片分析流程
2. ✅ 更新 `PromptBuilder` 将图片分析结果纳入 Prompt
3. ✅ 测试目标 token (0x682cc4943b1c290a96bf2dcc0a637979b4334444)

### Phase 3: 优化完善
1. 添加图片分析缓存（避免重复分析）
2. 添加图片分析失败的处理逻辑
3. 优化 Prompt 以提高分析质量

## 注意事项

1. **API 调用成本**: 多模态 API 调用消耗更多 token，需要合理使用
2. **图片大小限制**: Twitter 图片通常 < 5MB，但需要处理异常情况
3. **缓存策略**: 图片分析结果应该缓存，避免重复调用
4. **失败处理**: 图片下载或分析失败时，应该降级到仅文本分析
5. **模型选择**: `Pro/moonshotai/Kimi-K2.5` 效果好，但可以测试其他多模态模型

## 测试案例

**目标 Token**: `0x682cc4943b1c290a96bf2dcc0a637979b4334444`（微笑狗）

**推文**: `https://x.com/Four_FORM_/status/2032010157425926252`

**预期结果**:
- 识别出推文包含图片
- 下载图片并转换为 base64
- 调用多模态 API 分析图片
- 返回"微笑狗"表情包的描述和含义
- 正确评估代币叙事（应该识别出这是一个热门梗图）

## 配置变更

无需新增配置，使用现有的 `SILICONFLOW_API_KEY`。

如需使用不同的多模态模型，可以在 `.env` 中添加：
```
SILICONFLOW_VISION_MODEL=Pro/moonshotai/Kimi-K2.5
```
