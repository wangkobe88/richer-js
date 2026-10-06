// 临时实测：智谱视觉模型分析推文配图（BSI 案那张图）
// 量三段耗时：图片下载 / 压缩 / API 调用；并看判断质量
require('dotenv').config({ path: 'config/.env' });
const sharp = require('sharp');

const BASE = process.env.NEWS_LLM_BASE_URL; // https://open.bigmodel.cn/api/anthropic
const KEY = process.env.NEWS_LLM_API_KEY;
const IMG_URL = 'https://pbs.twimg.com/media/HTyPWxhWwAEnKkg.jpg'; // BSI 案 @binance Day9 配图
const MODELS = ['glm-4.6v', 'glm-4.5v'];

const PROMPT = `推文作者：@binance（币安官方）
推文文字："Day 9 of 100 Days of AI 🤖 — I'm nice to AI for strategic reasons."
待判断代币：name="Binance Si Pro", symbol="BSI"

请分析这张推文配图，回答两个问题：
1. 图片内容是什么（一句话）？
2. 代币名 "Binance Si Pro"/BSI 与图片/推文内容是否存在指代关系（token 名是否取材于图中的形象/文字/主题）？给出 yes/no + 一句理由。`;

async function downloadImage(url) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Chrome/120)' } });
  if (!res.ok) throw new Error('download ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ms: Date.now() - t0 };
}

async function compress(buf) {
  const t0 = Date.now();
  const out = await sharp(buf)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  return { out, ms: Date.now() - t0 };
}

async function callVision(model, base64, mediaType) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': KEY,
      'Authorization': `Bearer ${KEY}`,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: PROMPT }
        ]
      }]
    })
  });
  const ms = Date.now() - t0;
  const body = await res.json();
  return { ms, ok: res.ok, status: res.status, body };
}

(async () => {
  const { buf, ms: dlMs } = await downloadImage(IMG_URL);
  console.log(`[下载] ${(buf.length / 1024).toFixed(0)}KB, ${dlMs}ms`);
  const { out, ms: cpMs } = await compress(buf);
  console.log(`[压缩] ${(out.length / 1024).toFixed(0)}KB webp, ${cpMs}ms`);
  const base64 = out.toString('base64');

  for (const model of MODELS) {
    for (let i = 1; i <= 2; i++) {
      try {
        const r = await callVision(model, base64, 'image/webp');
        if (!r.ok) {
          console.log(`[${model} #${i}] HTTP ${r.status} ${r.ms}ms :: ${JSON.stringify(r.body).slice(0, 200)}`);
        } else {
          const blocks = r.body.content || [];
          const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
          const usage = r.body.usage || {};
          console.log(`[${model} #${i}] ${r.ms}ms | in=${usage.input_tokens} out=${usage.output_tokens} | blocks=[${blocks.map(b => b.type).join(',')}]`);
          console.log(`  -> ${text.slice(0, 500).replace(/\n/g, ' ')}`);
          if (!text && i === 1) console.log(`  RAW: ${JSON.stringify(r.body).slice(0, 700)}`);
        }
      } catch (e) {
        console.log(`[${model} #${i}] THROW ${e.message}`);
      }
    }
  }
  process.exit(0);
})();
