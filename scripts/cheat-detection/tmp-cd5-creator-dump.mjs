// tmp-cd5-creator-dump.mjs — CD5 创建者「代币转入方式卖出」检查（批次六用户指令）
// 用户裁定待验：「创建者已经卖了，而且应该是通过代币转入的方式卖的——明显作弊行为」
// 三路：① 创建者锚后全窗 swap 行 ② 零买入纯卖方（transfer-in 侧写）③ RPC Transfer(from=creator) 实锤对拍
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');

const ADDR = '0x647f9dbf1cff892aee246fa50743ba8b98017777';
const short = (w) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : 'NULL');
const sb = dbManager.getClient();

// creator 全地址
const { data: ev } = await sb.from('wss_events').select('payload').eq('kind', 'token_create').eq('token_address', ADDR).limit(5);
const creator = ((ev ?? []).find((r) => r.payload?.creator)?.payload.creator || '').toLowerCase();
console.log(`creator=${creator}`);

// ① 全量 ticks（1000 帽）：创建者行 + 锚后行为
const { data: ticks, error } = await sb.from('wss_price_ticks')
  .select('block_time,block_number,trade_type,bnb_amount,token_amount,sender_address,trader_address')
  .eq('token_address', ADDR)
  .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(1000);
if (error) throw error;
console.log(`全窗 ticks=${ticks.length}（1000=帽，可能截断）`);
const t0 = Date.parse(ticks[0].block_time);
const walletOf = (r) => (r.sender_address || r.trader_address || '').toLowerCase();
const crRows = ticks.filter((r) => walletOf(r) === creator);
console.log(`\n── 创建者 swap 行（${crRows.length} 笔）──`);
for (const r of crRows) {
  console.log(`t+${String(Math.round((Date.parse(r.block_time) - t0) / 1000)).padStart(5)}s blk${r.block_number} ${r.trade_type === 'buy' ? '买' : '卖'} ${r.bnb_amount.toFixed(4)} BNB (${Number(r.token_amount).toExponential(3)} tok)`);
}

// ② 零买入纯卖方（全窗）
const agg = new Map();
for (const r of ticks) {
  const w = walletOf(r);
  const e = agg.get(w) || { buy: 0, sell: 0, sellN: 0, firstDt: null };
  if (r.trade_type === 'buy') { e.buy += r.bnb_amount; if (e.firstDt === null) e.firstDt = Math.round((Date.parse(r.block_time) - t0) / 1000); }
  else { e.sell += r.bnb_amount; e.sellN += 1; }
  agg.set(w, e);
}
const pure = [...agg.entries()].filter(([, e]) => e.buy === 0 && e.sell > 0).sort((a, b) => b[1].sell - a[1].sell);
console.log(`\n── 零买入纯卖方（${pure.length} 个，Σ卖 ${pure.reduce((s, [, e]) => s + e.sell, 0).toFixed(2)} BNB / 全窗总卖 ${[...agg.values()].reduce((s, e) => s + e.sell, 0).toFixed(2)}）──`);
for (const [w, e] of pure.slice(0, 20)) console.log(`${short(w)} 卖 ${e.sell.toFixed(3)}×${e.sellN}`);

// ③ RPC Transfer(from=creator)：转出到谁、接收方卖出对拍
const env = readFileSync('config/.env', 'utf8');
const wsUrl = (env.match(/^ANKR_WS_URL=(.+)$/m)?.[1] || '').trim();
const wsKey = wsUrl.split('/').pop();
const key = (wsKey && wsKey.length >= 20 ? wsKey : '')
  || ((env.match(/^ANKR_API_KEY=(.+)$/m)?.[1] || '').trim());
if (!key || key.length < 20) throw new Error('ANKR key 提取失败');
const rpc = `https://rpc.ankr.com/bsc/${key}`;
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = (a) => '0x' + a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const call = async (m, p) => (await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json();
const head = (await call('eth_blockNumber', [])).result;
const fromBlk = ticks[0].block_number;
console.log(`\n── RPC Transfer(from=creator) 块 ${fromBlk}→${parseInt(head, 16)} ──`);
const logs = (await call('eth_getLogs', [{
  address: ADDR, topics: [TRANSFER, pad(creator)],
  fromBlock: '0x' + fromBlk.toString(16), toBlock: head,
}])).result ?? [];
console.log(`转出 ${logs.length} 笔`);
const recvSell = new Map();
for (const lg of logs) {
  const to = '0x' + lg.topics[2].slice(-40);
  const e = recvSell.get(to) || { tok: 0n, n: 0, blk0: parseInt(lg.blockNumber, 16) };
  e.tok += BigInt(lg.data === '0x' ? '0' : lg.data); e.n += 1;
  recvSell.set(to, e);
}
for (const [to, e] of recvSell) {
  const a = agg.get(to);
  console.log(`${short(to)} 收 ${e.n} 笔转入 Σ${Number(e.tok / 10n ** 12n) / 1e6}M tok @blk${e.blk0} → 卖 ${a ? a.sell.toFixed(3) + ' BNB×' + a.sellN : '0（窗内未卖）'} 买 ${a ? a.buy.toFixed(3) : '0'}`);
}
