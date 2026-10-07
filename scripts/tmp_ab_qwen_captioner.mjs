/**
 * 2026-10-07 模型选型补测（用户 mid-turn 指令）：SiliconFlow
 * Qwen/Qwen3-Omni-30B-A3B-Captioner vs 已定案的智谱 glm-4.6v。
 * 同图（现金猫案配图）同生产 prompt（token 无关 + 反编造）。
 * OpenAI 兼容端点 /v1/chat/completions（content 数组 image_url + text）。
 * 用法：node scripts/tmp_ab_qwen_captioner.mjs（key 读 config/.env SILICONFLOW_API_KEY）
 */
import { readFileSync } from 'fs';
import { ImageDownloader } from '../src/narrative/utils/image-downloader.mjs';
import sharp from 'sharp';

const env = readFileSync('config/.env', 'utf8');
const KEY = process.env.SILICONFLOW_API_KEY || env.match(/SILICONFLOW_API_KEY=(.+)/)[1].trim();
const BASE = 'https://api.siliconflow.cn/v1';
const MODEL = 'Qwen/Qwen3-Omni-30B-A3B-Captioner';
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

const webp = await ImageDownloader.downloadAsBase64(IMG, { format: 'jpeg' });
console.log(`下载: mimeType=${webp.mimeType} compressed=${webp.compressed} base64len=${webp.base64.length}\n`);

const t0 = Date.now();
try {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${webp.mimeType};base64,${webp.base64}` } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  });
  const ms = Date.now() - t0;
  const body = await res.json();
  if (!res.ok) {
    console.log(`HTTP ${res.status} ${ms}ms :: ${JSON.stringify(body).slice(0, 500)}`);
    process.exit(1);
  }
  const choice = body.choices?.[0];
  console.log(`[${MODEL}] ${ms}ms | finish=${choice?.finish_reason} | in=${body.usage?.prompt_tokens} out=${body.usage?.completion_tokens}`);
  console.log('────── 输出 ──────');
  console.log(choice?.message?.content || '(空)');
} catch (e) {
  console.log(`THROW ${Date.now() - t0}ms ${e.message}`);
}
process.exit(0);
