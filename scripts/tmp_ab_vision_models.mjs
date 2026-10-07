/**
 * 2026-10-07 模型选型复测（182 现场）：用户裁定换智谱专门视觉模型（glm-5.3 是文本模型，
 * webp 图片块被端点静默丢弃 → 「看不到图」废结果）。
 *
 * A/B：glm-4.6v（视觉模型）× {jpeg(压缩后重编码), webp(生产压缩直出)}，
 * 生产同款 prompt（token 无关 + 强反编造约束）。
 * 用法（182 repo 根目录）：node scripts/tmp_ab_vision_models.mjs
 */
import { readFileSync } from 'fs';
import { ImageDownloader } from '../src/narrative/utils/image-downloader.mjs';
import sharp from 'sharp';

const env = readFileSync('config/.env', 'utf8');
const KEY = env.match(/NEWS_LLM_API_KEY=(.+)/)[1].trim();
const BASE = 'https://open.bigmodel.cn/api/anthropic';
const IMG = 'https://pbs.twimg.com/media/HTeSnpDXAAAMv9P.jpg'; // 现金猫案配图（TradersLeague 排行榜）

// 与 image-analysis-service._buildPrompt 同款（token 无关）
const PROMPT = `你是meme币叙事分析助手。请分析这条推文的配图。

推文作者：@binance
推文文字：POV: You check the Binance #TradersLeagueS4 leaderboard and see your name at the top.

要求：严格以图中实际可见内容为准——读不清的文字就明说读不清，绝不允许编造（这是叙事判定的证据，编造会导致误判）。

只输出如下 JSON（不要输出其他内容，不要markdown代码块）：
{
  "description": "图片内容一段话描述",
  "key_elements": ["图中的关键元素/形象/可读文字，逐项列出"],
  "meme_type": "梗图类型（POV/对比图/排行榜截图/表情包等，非梗图写'非梗图'）",
  "meme_meaning": "这张图在传播的情绪或含义"
}`;

async function call(model, mediaType, b64, extra = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'Authorization': `Bearer ${KEY}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model, max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
        ...extra,
      }),
    });
    const ms = Date.now() - t0;
    const body = await res.json();
    if (!res.ok) {
      console.log(`[${model} ${mediaType}] HTTP ${res.status} ${ms}ms :: ${JSON.stringify(body).slice(0, 300)}`);
      return;
    }
    const blocks = body.content || [];
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
    console.log(`[${model} ${mediaType}] ${ms}ms | stop=${body.stop_reason} | blocks=[${blocks.map(b => b.type).join(',')}] | in=${body.usage?.input_tokens} out=${body.usage?.output_tokens}`);
    console.log(`  ${text.replace(/\n/g, '\n  ').slice(0, 1500) || '(空)'}\n`);
  } catch (e) {
    console.log(`[${model} ${mediaType}] THROW ${e.message}`);
  }
}

const webp = await ImageDownloader.downloadAsBase64(IMG);
console.log(`生产链路下载: mimeType=${webp.mimeType} compressed=${webp.compressed} base64len=${webp.base64.length}`);
const jpegB64 = (await sharp(Buffer.from(webp.base64, 'base64')).jpeg({ quality: 85 }).toBuffer()).toString('base64');
console.log(`jpeg 重编码: base64len=${jpegB64.length}\n`);

await call('glm-4.6v', 'image/jpeg', jpegB64);
await call('glm-4.6v', webp.mimeType, webp.base64);
await call('glm-4.6v', 'image/jpeg', jpegB64, { thinking: { type: 'disabled' } });
process.exit(0);
