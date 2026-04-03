/**
 * 测试CZ推文图片分析
 */

import { ImageDownloader } from './src/narrative/utils/image-downloader.mjs';
import { LLMClient } from './src/narrative/analyzer/llm-client.mjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, 'config/.env') });

// CZ推文中的图片
const CZ_IMAGE_URL = 'https://pbs.twimg.com/media/HE9cRuea4AAyGTV.jpg';

const TOKEN_DATA = {
  symbol: '#1',
  name: '#1',
  address: '0x20ba337adfef39cca70b1ab28cd7033f983d4444',
  raw_api_data: {
    name: '#1',
    intro_en: '',
    intro_cn: ''
  }
};

async function testCZImageAnalysis() {
  console.log('测试CZ推文图片分析');
  console.log('='.repeat(60));
  console.log(`图片URL: ${CZ_IMAGE_URL}`);
  console.log(`代币: ${TOKEN_DATA.symbol} (${TOKEN_DATA.address.substring(0, 8)}...)`);
  console.log('='.repeat(60));

  // 1. 下载图片
  console.log('\n[1] 下载图片...');
  const imageData = await ImageDownloader.downloadAsBase64(CZ_IMAGE_URL, {
    maxSize: 5 * 1024 * 1024,
    timeout: 15000
  });

  if (!imageData) {
    console.log('❌ 图片下载失败');
    return;
  }

  console.log(`✓ 下载成功: ${imageData.size}字节 (${imageData.mimeType})`);

  // 2. 构建prompt
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

  // 3. 分析图片
  console.log('\n[2] 分析图片...');
  const startTime = Date.now();

  try {
    const result = await LLMClient.analyzeImage(imageData.dataUrl, prompt, {
      model: 'Pro/moonshotai/Kimi-K2.5',
      timeout: 45000,
      maxTokens: 2000
    });

    const elapsed = Date.now() - startTime;

    console.log(`✓ 分析完成: ${elapsed}ms`);
    console.log('\n原始回复:');
    console.log(result.content.substring(0, 500));

    // 4. 解析JSON
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('\n解析后的结果:');
      console.log(JSON.stringify(parsed, null, 2));
    }

  } catch (error) {
    console.error(`❌ 分析失败: ${error.message}`);
  }
}

testCZImageAnalysis().catch(console.error);
