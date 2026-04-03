/**
 * 测试不同视觉模型的性能
 */

import { ImageDownloader } from './src/narrative/utils/image-downloader.mjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: join(__dirname, 'config/.env') });

const API_URL = process.env.SILICONFLOW_API_URL || 'https://api.siliconflow.cn/v1';
const API_KEY = process.env.SILICONFLOW_API_KEY;

// 测试图片
const TEST_IMAGE_URL = 'https://picsum.photos/800/600';
const TEST_PROMPT = `描述这张图片的内容，简要说明图中有什么。`;

// 测试模型列表
const VISION_MODELS = [
  { name: 'Pro/OpenAI/GPT-4o-mini', timeout: 30000 },
  { name: 'Pro/Anthropic/Gemini-2.0-Flash', timeout: 30000 },
  { name: 'Pro/moonshotai/Kimi-K2.5', timeout: 45000 },
  { name: 'Qwen/Qwen2-VL-7B-Instruct', timeout: 30000 },
  { name: 'deepseek-ai/Janus-Pro-7B', timeout: 30000 }
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

    return {
      success: true,
      elapsed,
      content: content.substring(0, 100)
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
  console.log('='.repeat(60));
  console.log('视觉模型性能测试');
  console.log('='.repeat(60) + '\n');

  const imageData = await downloadImage();

  const results = [];

  for (const model of VISION_MODELS) {
    const result = await testModel(model.name, imageData, TEST_PROMPT, model.timeout);
    results.push({
      model: model.name,
      ...result
    });

    if (result.success) {
      console.log(`✓ ${model.name}: ${result.elapsed}ms`);
      console.log(`  回复: ${result.content}...\n`);
    } else {
      console.log(`✗ ${model.name}: ${result.error}\n`);
    }

    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // 汇总
  console.log('='.repeat(60));
  console.log('测试结果汇总');
  console.log('='.repeat(60));

  const successResults = results.filter(r => r.success);

  if (successResults.length > 0) {
    console.log(`\n成功的模型 (${successResults.length}):`);
    successResults.sort((a, b) => a.elapsed - b.elapsed).forEach(r => {
      console.log(`  ${r.model}: ${r.elapsed}ms`);
    });
    console.log(`\n推荐: ${successResults[0].model} (${successResults[0].elapsed}ms)`);
  }

  const failedResults = results.filter(r => !r.success);
  if (failedResults.length > 0) {
    console.log(`\n失败的模型 (${failedResults.length}):`);
    failedResults.forEach(r => {
      console.log(`  ${r.model}: ${r.error}`);
    });
  }
}

runTest().catch(console.error);
