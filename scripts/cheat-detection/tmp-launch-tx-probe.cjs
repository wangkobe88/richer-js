// 一次性（182 跑）：launch 调研——发布 tx input 解析探查（用户质疑「发布价应可从发布信息推断」验证）：
//   取 fourmeme 3 只 + flap 2 只的 token_create txHash → eth_getTransactionByHash → dump calldata
//   selector + 逐参数 word（找 template/tier/maxRaising 类发布参数）→ 若在，方案二=解析创建 tx 即得发布参数
const { dbManager } = require('../../src/services/dbManager.js');

const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-dataseed2.defibit.io'];

async function rpc(method, params) {
  let lastErr = null;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await res.json();
      if (j.result) return j.result;
      lastErr = new Error(j.error ? j.error.message : 'empty');
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function dumpWords(input, label) {
  const hex = input.slice(2);
  console.log(`  ${label} input 长度=${hex.length / 2} 字节（${Math.floor(hex.length / 64)} words + 尾 ${hex.length % 64 ? hex.length % 64 / 2 : 0} 字节）`);
  const n = Math.min(hex.length / 64, 24);
  for (let i = 0; i < n; i++) {
    const w = hex.slice(i * 64, (i + 1) * 64);
    const asInt = BigInt('0x' + w);
    const asEth = Number(asInt) / 1e18;
    // 尝试 UTF-8（参数若是 string 偏移则非文本）
    let text = '';
    if (/^0{48}/.test(w) === false) { /* 高位非零，非地址非小整数 */ }
    try { const b = Buffer.from(w.slice(48), 'hex'); if (/^[\x20-\x7e]+$/.test(b.toString('latin1'))) text = ` ascii尾="${b.toString('latin1')}"`; } catch (e) {}
    console.log(`    w${i}: 0x${w} | int=${asInt.toString()} | ether=${Number.isFinite(asEth) ? asEth : '-'}${text}`);
  }
  if (hex.length / 64 > 24) console.log(`    …（余 ${Math.floor(hex.length / 64) - 24} words 略）`);
}

async function main() {
  const sb = await dbManager.getClient();
  for (const plat of ['fourmeme', 'flap']) {
    const { data } = await sb.from('wss_events')
      .select('token_address,payload,block_time').eq('kind', 'token_create').eq('platform', plat)
      .gte('block_time', '2026-11-04T00:00:00Z').lte('block_time', '2026-11-06T00:00:00Z')
      .order('id', { ascending: true }).limit(3);
    if (!data || !data.length) { console.log(`[${plat}] 无行`); continue; }
    let k = 0;
    for (const row of data) {
      k++;
      const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      if (!p || !p.txHash) continue;
      const tx = await rpc('eth_getTransactionByHash', [p.txHash]);
      if (!tx) { console.log(`[${plat}#${k}] ${row.token_address} tx 未找到`); continue; }
      console.log(`\n===== [${plat}#${k}] ${row.token_address} (${p.symbol || p.name}) =====`);
      console.log(`  to=${tx.to} | selector=0x${tx.input.slice(2, 10)} | tx.value=${BigInt(tx.value).toString()} wei`);
      dumpWords(tx.input, 'createTx');
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
