/**
 * 测试 Qwen 视觉模型的性能
 */

import { ImageDownloader } from './src/narrative/utils/image-downloader.mjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, 'config/.env') });

const API_URL = process.env.SILICONFLOW_API_URL || 'https://api.siliconflow.cn/v1';
const API_KEY = process.env.SILICONFLOW_API_KEY;

// 使用CZ的推文图片（更复杂，更真实）
const CZ_IMAGE_URL = 'https://pbs.twimg.com/media/HE9cRuea4AAyGTV.jpg';

const TOKEN_DATA = {
  symbol: '#1',
  name: '#1',
  address: '0x20ba337adfef39cca70b1ab28cd7033f983d4444'
};

const prompt = `你是代币叙事分析专家。请分析这张图片与代币"${TOKEN_DATA.symbol}"的关系。

【代币信息】
- Symbol: ${TOKEN_DATA.symbol}
- Name: ${TOKEN_DATA.name}

【分析任务】
1. **图片内容描述**：详细描述图片中的主体、人物、动物、文字、符号等
2. **代币关联度评估**：图片内容与代币名称/Symbol是否有关联？

【输出格式】（JSON）`;

// 要测试的模型
const MODELS = [
  { name: 'Qwen/Qwen3-VL-32B-Instruct', timeout: 30000 },
  { name: 'Qwen/Qwen3-Omni-30B-A3B-Captioner', timeout: 30000 },
  { name: 'zai-org/GLM-4.6V', timeout: 40000 },  // 对比
];

async function downloadImage() {
  console.log(`下载图片: ${CZ_IMAGE_URL}`);
  const imageData = await ImageDownloader.downloadAsBase64(CZ_IMAGE_URL, {
    maxSize: 5 * 1024 * 1024,
    timeout: 15000
  });

  if (!imageData) {
    throw new Error('图片下载失败');
  }

  console.log(`✓ 下载成功: ${imageData.size}字节\n`);
  return imageData;
}

async function testModel(modelName, imageData, timeout) {
  const startTime = Date.now();

  try {
    console.log(`[${new Date().toISOString().substring(11, 19)}] 测试: ${modelName}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageData.dataUrl } }
            ]
          }
        ],
        temperature: 0.7,
        max_tokens: 1500
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText.substring(0, 100)}`
      };
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      return {
        success: false,
        error: '返回内容为空'
      };
    }

    const elapsed = Date.now() - startTime;

    // 尝试提取JSON
    let jsonExtracted = null;
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        jsonExtracted = JSON.parse(jsonMatch[0]);
      } catch (e) {
        // 忽略解析错误
      }
    }

    return {
      success: true,
      elapsed,
      content: content.substring(0, 200),
      jsonExtracted
    };

  } catch (error) {
    const elapsed = Date.now() - startTime;
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: `超时 (${timeout}ms)`,
        elapsed
      };
    }
    return {
      success: false,
      error: error.message,
      elapsed
    };
  }
}

async function runTest() {
  console.log('='.repeat(70));
  console.log('Qwen 视觉模型性能测试');
  console.log('测试图片: CZ推文图片 (复杂图片)');
  console.log('='.repeat(70) + '\n');

  const imageData = await downloadImage();

  const results = [];

  for (const model of MODELS) {
    const result = await testModel(model.name, imageData, model.timeout);
    results.push({
      model: model.name,
      ...result
    });

    if (result.success) {
      console.log(`✓ ${result.elapsed}ms`);
      if (result.jsonExtracted) {
        console.log(`  JSON: ${JSON.stringify(result.jsonExtracted).substring(0, 150)}...`);
      } else {
        console.log(`  内容: ${result.content}...`);
      }
    } else {
      console.log(`✗ ${result.error}`);
    }
    console.log('');

    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // 汇总
  console.log('='.repeat(70));
  console.log('测试结果汇总');
  console.log('='.repeat(70));

  const successResults = results.filter(r => r.success);

  if (successResults.length > 0) {
    console.log(`\n✓ 成功 (${successResults.length}):`);
    successResults.sort((a, b) => a.elapsed - b.elapsed).forEach((r, i) => {
      const rank = i === 0 ? '🏆' : '  ';
      console.log(`${rank} ${r.model.padEnd(40)} ${r.elapsed}ms`);
    });

    console.log(`\n推荐: ${successResults[0].model} (${successResults[0].elapsed}ms)`);

    // 性能评估
    const fastest = successResults[0].elapsed;
    console.log(`\n性能评估:`);
    if (fastest < 15000) {
      console.log(`  ✓ 优秀: ${fastest}ms (<15秒)`);
    } else if (fastest < 25000) {
      console.log(`  △ 可接受: ${fastest}ms (15-25秒)`);
    } else {
      console.log(`  ✗ 较慢: ${fastest}ms (>25秒)`);
    }
  }

  const failedResults = results.filter(r => !r.success);
  if (failedResults.length > 0) {
    console.log(`\n✗ 失败 (${failedResults.length}):`);
    failedResults.forEach(r => {
      console.log(`  ${r.model.padEnd(40)} ${r.error}`);
    });
  }

  console.log('\n' + '='.repeat(70));
}

runTest().catch(console.error);
