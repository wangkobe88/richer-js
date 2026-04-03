/**
 * 测试多个视觉模型的性能
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

// 测试图片（使用简单的图片）
const TEST_IMAGE_URL = 'https://picsum.photos/800/600';

const TEST_PROMPT = `简要描述这张图片的内容。如果图片中有文字，请提取出来。`;

// 要测试的模型列表
const VISION_MODELS = [
  { name: 'Qwen/Qwen3.5-397B-A17B', timeout: 30000 },
  { name: 'Qwen/Qwen3.5-122B-A10B', timeout: 30000 },
  { name: 'Qwen/Qwen3.5-35B-A3B', timeout: 30000 },
  { name: 'zai-org/GLM-4.6V', timeout: 30000 },
  { name: 'Pro/moonshotai/Kimi-K2.5', timeout: 45000 }  // 对比
];

async function downloadImage() {
  console.log(`下载测试图片: ${TEST_IMAGE_URL}`);
  const imageData = await ImageDownloader.downloadAsBase64(TEST_IMAGE_URL, {
    maxSize: 5 * 1024 * 1024,
    timeout: 15000
  });

  if (!imageData) {
    throw new Error('图片下载失败');
  }

  console.log(`✓ 下载成功: ${imageData.size}字节 (${imageData.mimeType})\n`);
  return imageData;
}

async function testModel(modelName, imageData, prompt, timeout) {
  const startTime = Date.now();

  try {
    console.log(`测试模型: ${modelName} (超时: ${timeout}ms)`);

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
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageData.dataUrl
                }
              }
            ]
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText.substring(0, 150)}`
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

    return {
      success: true,
      elapsed,
      content: content.substring(0, 150)
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
  console.log('视觉模型性能测试');
  console.log('='.repeat(70) + '\n');

  const imageData = await downloadImage();

  const results = [];

  for (const model of VISION_MODELS) {
    const result = await testModel(model.name, imageData, TEST_PROMPT, model.timeout);
    results.push({
      model: model.name,
      ...result
    });

    if (result.success) {
      console.log(`✓ ${model.name.padEnd(35)} ${result.elapsed}ms`);
      console.log(`  回复: ${result.content}...\n`);
    } else {
      console.log(`✗ ${model.name.padEnd(35)} ${result.error}\n`);
    }

    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  // 汇总
  console.log('='.repeat(70));
  console.log('测试结果汇总');
  console.log('='.repeat(70));

  const successResults = results.filter(r => r.success);

  if (successResults.length > 0) {
    console.log(`\n✓ 成功的模型 (${successResults.length}):`);
    console.log('─'.repeat(70));
    successResults.sort((a, b) => a.elapsed - b.elapsed).forEach((r, i) => {
      const rank = i === 0 ? '🏆 推荐' : `  ${i + 1}.`;
      console.log(`${rank} ${r.model.padEnd(35)} ${r.elapsed}ms`);
    });
    console.log();
    console.log(`推荐使用: ${successResults[0].model} (${successResults[0].elapsed}ms)`);
  }

  const failedResults = results.filter(r => !r.success);
  if (failedResults.length > 0) {
    console.log(`\n✗ 失败的模型 (${failedResults.length}):`);
    console.log('─'.repeat(70));
    failedResults.forEach(r => {
      console.log(`  ${r.model.padEnd(35)} ${r.error}`);
    });
  }

  console.log('\n' + '='.repeat(70));

  // 性能评估
  if (successResults.length > 0) {
    const fastest = successResults[0].elapsed;
    console.log(`\n性能评估:`);
    if (fastest < 10000) {
      console.log(`  ✓ 优秀: ${fastest}ms (<10秒)`);
    } else if (fastest < 20000) {
      console.log(`  △ 可接受: ${fastest}ms (10-20秒)`);
    } else {
      console.log(`  ✗ 较慢: ${fastest}ms (>20秒)`);
    }
  }
}

runTest().catch(console.error);
