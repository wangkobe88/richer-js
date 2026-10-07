require('dotenv').config({ path: 'config/.env' });
const fs = require('fs');
const BASE = process.env.NEWS_LLM_BASE_URL;
const KEY = process.env.NEWS_LLM_API_KEY;
const b64 = fs.readFileSync('/tmp/cashcat-tweet.jpg').toString('base64'); // 原图 1146x1200
console.log(`原图 base64 长度: ${b64.length}`);
const PROMPT = `这是 binance（币安官方）一条推文的配图，推文文字是 "POV: You check the Binance #TradersLeagueS4 leaderboard and see your name at the top."。有一个 meme 币 name="cashcat" symbol="现金猫"。
请回答：
1. 图片内容一句话描述；
2. 图中出现哪些具体可读文字（排行榜上的用户名逐个列出，能读几个列几个）？是否有猫的形象？
3. 代币名 cashcat/现金猫 与图片内容是否存在指代关联（yes/no + 理由）。`;
async function call(model, extra = {}, label = '') {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'Authorization': `Bearer ${KEY}`, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 4000,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: PROMPT }
        ]}],
        ...extra
      })
    });
    const ms = Date.now() - t0;
    const body = await res.json();
    if (!res.ok) { console.log(`[${model}${label}] HTTP ${res.status} ${ms}ms :: ${JSON.stringify(body).slice(0,300)}`); return; }
    const blocks = body.content || [];
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
    console.log(`[${model}${label}] ${ms}ms | stop=${body.stop_reason} | blocks=[${blocks.map(b => b.type).join(',')}] | in=${body.usage?.input_tokens} out=${body.usage?.output_tokens}`);
    console.log(`  TEXT: ${text.replace(/\n/g, '\n  ').slice(0, 1200) || '(空)'}\n`);
  } catch (e) { console.log(`[${model}${label}] THROW ${e.message}`); }
}
(async () => {
  await call('glm-4.6v');
  await call('glm-5.3', { thinking: { type: 'disabled' } }, '+no-think');
  process.exit(0);
})();
