// 一次性（182 跑）：flap 低开票 quote_token 分布验证（汇率折算假说：若 quote=USDT 等稳定币，P₀ 的 BNB 值随汇率连续漂移）
//   另：取最深 5 只低开票的首买时刻+fb 值（报告用判例）
const { dbManager } = require('../../src/services/dbManager.js');
const fs = require('fs');
const FL = 6.14 / (107036752 + 1e9);

async function main() {
  const rows = JSON.parse(fs.readFileSync('/tmp/launch-research.json', 'utf8'));
  const lows = rows.filter((r) => r.p === 'flap' && r.fb && (r.fb / FL - 1) < -0.05)
    .sort((a, b) => a.fb / FL - b.fb / FL); // 最深在前
  console.log(`低开票 ${lows.length} 只，最深 8 判例：`);
  for (const r of lows.slice(0, 8)) {
    console.log(`  ${r.a} fb=${r.fb.toExponential(3)}(${((r.fb / FL - 1) * 100).toFixed(1)}%) 首买=${r.fbt} 首买额=${r.fbb}B min=${r.min ? ((r.min / FL - 1) * 100).toFixed(1) + '%' : '-'} maxVs首买=${r.max ? ((r.max / r.fb - 1) * 100).toFixed(0) + '%' : '-'}`);
  }
  // quote_token 分布（抽样最深 30 + 随机 30）
  const sample = [...lows.slice(0, 30), ...lows.filter((_, i) => i % 13 === 0).slice(0, 30)];
  const sb = await dbManager.getClient();
  const byQuote = new Map();
  for (const r of sample) {
    const { data } = await sb.from('wss_price_ticks').select('quote_token').eq('token_address', r.a).not('quote_token', 'is', null).limit(1);
    const q = data && data.length ? data[0].quote_token : '(null=BNB盘)';
    byQuote.set(q, (byQuote.get(q) || 0) + 1);
  }
  console.log('低开票 quote_token 分布（60 抽样）：');
  for (const [k, v] of byQuote) console.log(`  ${k}: ${v}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
