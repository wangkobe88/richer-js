// 实测 v2：智谱原生 v4 chat/completions 端点 + 关 thinking + 短输出
require('dotenv').config({ path: 'config/.env' });
const sharp = require('sharp');

const KEY = process.env.NEWS_LLM_API_KEY;
const V4 = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const IMG_URL = 'https://pbs.twimg.com/media/HTyPWxhWwAEnKkg.jpg';
const CASES = [
  { label: 'BSI案(零关联)', name: 'Binance Si Pro', sym: 'BSI',
    author: '@binance（币安官方）', text: 'Day 9 of 100 Days of AI 🤖 — I\'m nice to AI for strategic reasons.' },
  { label: '对照(强关联)', name: 'Nice Bot', sym: 'NICE',
    author: '@binance（币安官方）', text: 'Day 9 of 100 Days of AI 🤖 — I\'m nice to AI for strategic reasons.' },
];

const PROMPT = (c) => `推文作者：${c.author}
推文文字："${c.text}"
待判断代币：name="${c.name}", symbol="${c.sym}"

看这张推文配图，严格按 JSON 输出（不要多余文字）：
{"desc": "图片内容一句话（图中主体/文字）", "referent": "yes|no", "reason": "代币名是否取材于图中形象/文字/主题，一句话理由"}`;

async function run(model, body) {
  const t0 = Date.now();
  const res = await fetch(V4, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify(body)
  });
  const ms = Date.now() - t0;
  const b = await res.json();
  return { ms, ok: res.ok, status: res.status, b };
}

(async () => {
  const dl0 = Date.now();
  const res = await fetch(IMG_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (Chrome/120)' } });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`[下载] ${(buf.length / 1024).toFixed(0)}KB ${Date.now() - dl0}ms`);
  const c0 = Date.now();
  const small = await sharp(buf).resize(768, 768, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  console.log(`[压缩] ${(small.length / 1024).toFixed(0)}KB jpeg ${Date.now() - c0}ms`);
  const b64 = small.toString('base64');

  const models = ['glm-4.6v', 'glm-4.5v'];
  for (const model of models) {
    for (const c of CASES) {
      const body = {
        model,
        thinking: { type: 'disabled' },
        max_tokens: 300,
        temperature: 0.2,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
            { type: 'text', text: PROMPT(c) }
          ]
        }]
      };
      try {
        const r = await run(model, body);
        if (!r.ok) { console.log(`[${model} ${c.label}] HTTP ${r.status} ${r.ms}ms ${JSON.stringify(r.b).slice(0, 150)}`); continue; }
        const msg = r.b.choices?.[0]?.message || {};
        const text = (msg.content || '') + (msg.reasoning_content ? ` <think:${String(msg.reasoning_content).length}字>` : '');
        const usage = r.b.usage || {};
        console.log(`[${model} ${c.label}] ${r.ms}ms | in=${usage.prompt_tokens} out=${usage.completion_tokens}`);
        console.log(`  -> ${text.slice(0, 400).replace(/\n/g, ' ')}`);
      } catch (e) { console.log(`[${model} ${c.label}] THROW ${e.message}`); }
    }
  }
  process.exit(0);
})();
