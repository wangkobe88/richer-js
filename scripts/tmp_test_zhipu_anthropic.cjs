// 实测 v3：anthropic 兼容端点 + thinking disabled + 短输出，两案对照
require('dotenv').config({ path: 'config/.env' });
const sharp = require('sharp');

const BASE = process.env.NEWS_LLM_BASE_URL;
const KEY = process.env.NEWS_LLM_API_KEY;
const IMG_URL = 'https://pbs.twimg.com/media/HTyPWxhWwAEnKkg.jpg';
const CASES = [
  { label: '零关联(BSI案)', name: 'Binance Si Pro', sym: 'BSI' },
  { label: '强关联(对照)', name: 'Nice Bot', sym: 'NICE' },
];
const PROMPT = (c) => `推文作者：@binance（币安官方）
推文文字："Day 9 of 100 Days of AI 🤖 — I'm nice to AI for strategic reasons."
待判断代币：name="${c.name}", symbol="${c.sym}"

看这张推文配图，严格按 JSON 输出（不要多余文字）：
{"desc": "图片内容一句话（图中主体/文字）", "referent": "yes|no", "reason": "代币名是否取材于图中形象/文字/主题，一句话理由"}`;

(async () => {
  const res = await fetch(IMG_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (Chrome/120)' } });
  const buf = Buffer.from(await res.arrayBuffer());
  const small = await sharp(buf).resize(768, 768, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const b64 = small.toString('base64');
  console.log(`[图] 原图 ${(buf.length / 1024).toFixed(0)}KB → 压缩 ${(small.length / 1024).toFixed(0)}KB`);

  for (const model of ['glm-4.5v']) {
    for (const c of CASES) {
      for (const think of [{ type: 'disabled' }, undefined]) {
        const t0 = Date.now();
        try {
          const body = {
            model, max_tokens: 300, temperature: 0.2,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
                { type: 'text', text: PROMPT(c) }
              ]
            }]
          };
          if (think) body.thinking = think;
          const r = await fetch(`${BASE}/v1/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'Authorization': `Bearer ${KEY}`, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify(body)
          });
          const ms = Date.now() - t0;
          const b = await r.json();
          const blocks = b.content || [];
          const text = blocks.filter(x => x.type === 'text').map(x => x.text).join(' ');
          const thinkLen = blocks.filter(x => x.type === 'thinking').map(x => x.thinking?.length || 0).reduce((a, v) => a + v, 0);
          console.log(`[${model} ${c.label} ${think ? 'think=off' : 'think=on'}] ${ms}ms | in=${b.usage?.input_tokens} out=${b.usage?.output_tokens} | blocks=[${blocks.map(x => x.type)}] 思考${thinkLen}字`);
          console.log(`  -> ${text.slice(0, 400).replace(/\n/g, ' ') || '(无text块)'}`);
        } catch (e) { console.log(`[${model} ${c.label}] THROW ${e.message}`); }
      }
    }
  }
  process.exit(0);
})();
