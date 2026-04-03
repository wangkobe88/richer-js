/**
 * 测试CZ图片用GLM-4.6V
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
3. **meme/梗图识别**：是否是流行meme图？
4. **营销信号**：图片是否呈现明显的营销设计风格？

【输出格式】（JSON）`;

async function test() {
  console.log('测试GLM-4.6V分析CZ推文图片');
  console.log('='.repeat(60));

  const imageData = await ImageDownloader.downloadAsBase64(CZ_IMAGE_URL, {
    maxSize: 5 * 1024 * 1024,
    timeout: 15000
  });

  if (!imageData) {
    console.log('下载失败');
    return;
  }

  console.log(`下载成功: ${imageData.size}字节\n`);

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 40000);

    const response = await fetch(`${API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'zai-org/GLM-4.6V',
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
        max_tokens: 2000
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.log(`错误: ${response.status} ${await response.text()}`);
      return;
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    const elapsed = Date.now() - startTime;

    console.log(`✓ 分析完成: ${elapsed}ms\n`);
    console.log('回复内容:');
    console.log(content.substring(0, 800));

  } catch (error) {
    const elapsed = Date.now() - startTime;
    if (error.name === 'AbortError') {
      console.log(`✗ 超时 (${elapsed}ms)`);
    } else {
      console.log(`✗ 错误: ${error.message}`);
    }
  }
}

test().catch(console.error);
