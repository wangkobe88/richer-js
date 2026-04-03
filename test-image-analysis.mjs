/**
 * 图片识别性能测试
 * 测试高影响力账号推文图片的分析性能
 */

import { ImageDownloader } from './src/narrative/utils/image-downloader.mjs';
import { LLMClient } from './src/narrative/analyzer/llm-client.mjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: join(__dirname, 'config/.env') });

// 测试图片URL（使用公开可访问的图片）
const TEST_IMAGES = [
  'https://pbs.twimg.com/media/Gb9Fj1uX0AEpY8q?format=jpg&name=medium',
  'https://pbs.twimg.com/media/GcC6PwnWkAAq_Xp?format=jpg&name=medium',
  'https://picsum.photos/800/600'  // 备用测试图片
];

const TOKEN_DATA = {
  symbol: 'TEST',
  name: 'Test Token',
  address: '0x20ba337adfef39cca70b1ab28cd7033f983d4444',
  raw_api_data: {
    name: 'Test Token',
    intro_en: 'A test token for image analysis',
    intro_cn: '用于图片分析的测试代币'
  }
};

async function testSingleImage(imageUrl, index) {
  console.log(`\n========== 测试图片 ${index + 1} ==========`);
  console.log(`URL: ${imageUrl}`);

  const startTime = Date.now();

  try {
    // 1. 下载图片
    const downloadStart = Date.now();
    const imageData = await ImageDownloader.downloadAsBase64(imageUrl, {
      maxSize: 5 * 1024 * 1024,
      timeout: 15000
    });

    if (!imageData) {
      console.log(`❌ 下载失败`);
      return null;
    }

    const downloadTime = Date.now() - downloadStart;
    console.log(`✓ 下载成功: ${imageData.size}字节 (${imageData.mimeType}), 耗时${downloadTime}ms`);

    // 2. 分析图片
    const prompt = `你是代币叙事分析专家。请分析这张图片与代币"${TOKEN_DATA.symbol}"的关系。

【代币信息】
- Symbol: ${TOKEN_DATA.symbol}
- Name: ${TOKEN_DATA.name}
- 地址: ${TOKEN_DATA.address.substring(0, 8)}...

【分析任务】
1. **图片内容描述**：详细描述图片中的主体、人物、动物、文字、符号等
2. **代币关联度评估**：图片内容与代币名称/Symbol是否有关联？
3. **meme/梗图识别**：是否是流行meme图？
4. **营销信号**：图片是否呈现明显的营销设计风格？

【输出格式】（JSON）
{
  "description": "图片内容详细描述",
  "token_relevance": {
    "is_related": true/false,
    "reason": "关联/无关联的原因",
    "match_type": "symbol|name|concept|visual|none"
  },
  "meme_info": {
    "is_meme": true/false,
    "name": "meme名称（如果是）"
  },
  "marketing_signals": ["信号1", "信号2"]
}`;

    const analysisStart = Date.now();
    const result = await LLMClient.analyzeImage(imageData.dataUrl, prompt, {
      model: 'Pro/moonshotai/Kimi-K2.5',
      timeout: 60000,
      maxTokens: 2000
    });

    const analysisTime = Date.now() - analysisStart;
    const totalTime = Date.now() - startTime;

    console.log(`✓ 分析完成: 耗时${analysisTime}ms`);
    console.log(`总耗时: ${totalTime}ms (下载${downloadTime}ms + 分析${analysisTime}ms)`);

    // 解析结果
    let jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`\n分析结果:`);
      console.log(`- 描述: ${parsed.description?.substring(0, 60)}...`);
      console.log(`- 代币关联: ${parsed.token_relevance?.is_related ? '✓ 相关' : '✗ 无关'}`);
      console.log(`- 原因: ${parsed.token_relevance?.reason}`);
      if (parsed.meme_info?.is_meme) {
        console.log(`- Meme: ${parsed.meme_info.name}`);
      }
    }

    return {
      index: index + 1,
      url: imageUrl,
      downloadTime,
      analysisTime,
      totalTime,
      size: imageData.size
    };

  } catch (error) {
    const errorTime = Date.now() - startTime;
    console.error(`❌ 失败 (${errorTime}ms): ${error.message}`);
    return {
      index: index + 1,
      url: imageUrl,
      error: error.message,
      totalTime: errorTime
    };
  }
}

async function runTest() {
  console.log('='.repeat(60));
  console.log('图片识别性能测试');
  console.log('模型: Pro/moonshotai/Kimi-K2.5');
  console.log('='.repeat(60));

  const results = [];

  for (let i = 0; i < TEST_IMAGES.length; i++) {
    const result = await testSingleImage(TEST_IMAGES[i], i);
    results.push(result);
  }

  // 统计
  console.log('\n' + '='.repeat(60));
  console.log('测试结果汇总');
  console.log('='.repeat(60));

  const successResults = results.filter(r => !r.error);
  if (successResults.length > 0) {
    const avgDownload = successResults.reduce((sum, r) => sum + r.downloadTime, 0) / successResults.length;
    const avgAnalysis = successResults.reduce((sum, r) => sum + r.analysisTime, 0) / successResults.length;
    const avgTotal = successResults.reduce((sum, r) => sum + r.totalTime, 0) / successResults.length;
    const maxAnalysis = Math.max(...successResults.map(r => r.analysisTime));
    const minAnalysis = Math.min(...successResults.map(r => r.analysisTime));

    console.log(`成功: ${successResults.length}/${results.length}`);
    console.log(`平均下载时间: ${avgDownload.toFixed(0)}ms`);
    console.log(`平均分析时间: ${avgAnalysis.toFixed(0)}ms`);
    console.log(`分析时间范围: ${minAnalysis}ms - ${maxAnalysis}ms`);
    console.log(`平均总耗时: ${avgTotal.toFixed(0)}ms`);
  }

  if (results.some(r => r.error)) {
    console.log(`\n失败的测试:`);
    results.filter(r => r.error).forEach(r => {
      console.log(`- 图片${r.index}: ${r.error}`);
    });
  }

  console.log('\n性能评估:');
  if (avgAnalysis < 20000) {
    console.log('✓ 分析速度优秀 (<20秒)');
  } else if (avgAnalysis < 40000) {
    console.log('△ 分析速度可接受 (20-40秒)');
  } else {
    console.log('✗ 分析速度较慢 (>40秒)，建议换模型');
  }
}

runTest().catch(console.error);
