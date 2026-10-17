#!/usr/bin/env node
/**
 * 判别力初筛：我们买过的票，按「creator 是合约 vs EOA」分桶盈亏
 * - trades range 分页聚合买入票（轻列）
 * - wss_events .in 批量取 token_create creator（批 50）
 * - 公共 BSC RPC eth_getCode（不走 VPN）
 * 纯读。本地可跑（trades 几千行轻量 + creator 去重后几十个 getCode）。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const RPC = 'https://bsc-dataseed.binance.org/';

async function rpc(method, params) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) {
      if (i === 2) throw e;
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

async function main() {
  const db = dbManager.getClient();

  // 1. 买入票聚合（range 分页，trades 总量几千行）
  const trades = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await db.from('trades')
      .select('token_address,token_symbol,trade_direction,trade_status,input_currency,output_currency,input_amount,output_amount,executed_at')
      .eq('trade_status', 'success').range(offset, offset + 999);
    if (error) throw error;
    if (!data.length) break;
    trades.push(...data); offset += 1000;
    if (data.length < 1000) break;
  }
  console.log('trades success rows:', trades.length);
  const byToken = new Map();
  for (const t of trades) {
    const e = byToken.get(t.token_address) || { buy: 0, sell: 0, sym: t.token_symbol };
    if (t.trade_direction === 'buy' && t.input_currency === 'BNB') e.buy += Number(t.input_amount) || 0;
    if (t.trade_direction === 'sell' && t.output_currency === 'BNB') e.sell += Number(t.output_amount) || 0;
    byToken.set(t.token_address, e);
  }
  const bought = [...byToken.entries()].filter(([, e]) => e.buy > 0).map(([addr, e]) => ({
    addr, ...e, ret: e.sell / e.buy - 1, pnl: e.sell - e.buy,
  }));
  console.log('买过 token 数:', bought.length);

  // 2. creator 批量查（.in 50/批）
  const tokenCreator = new Map();
  const addrs = bought.map(b => b.addr);
  for (let i = 0; i < addrs.length; i += 50) {
    const batch = addrs.slice(i, i + 50);
    const { data, error } = await db.from('wss_events')
      .select('token_address,payload->>creator')
      .eq('kind', 'token_create').in('token_address', batch);
    if (error) throw error;
    for (const r of data || []) if (r.creator) tokenCreator.set(r.token_address, r.creator);
  }
  console.log('有 creator 的票:', tokenCreator.size);

  // 3. getCode 去重查（公共 RPC，串行+小间隔）
  const creators = [...new Set([...tokenCreator.values()])];
  console.log('去重 creator 数:', creators.length);
  const isContract = new Map();
  for (const c of creators) {
    const code = await rpc('eth_getCode', [c, 'latest']);
    isContract.set(c, code && code !== '0x');
    await new Promise(r => setTimeout(r, 60));
  }
  const contractCreators = [...isContract.entries()].filter(([, v]) => v).map(([k]) => k);
  console.log('合约 creator:', contractCreators.length, '/', creators.length);

  // 4. 分桶
  function bucket(rows, label) {
    if (!rows.length) { console.log(`${label}: 0 票`); return; }
    const rets = rows.map(r => r.ret).filter(Number.isFinite);
    const win = rets.filter(r => r > 0).length;
    console.log(`${label}: n=${rows.length} 平均ret=${(rets.reduce((a, b) => a + b, 0) / rets.length * 100).toFixed(1)}% 胜率=${win}/${rets.length} 净BNB=${rows.reduce((a, r) => a + r.pnl, 0).toFixed(3)}`);
  }
  const rowsContract = [], rowsEoa = [], rowsUnknown = [];
  for (const b of bought) {
    const c = tokenCreator.get(b.addr);
    if (!c) { rowsUnknown.push(b); continue; }
    (isContract.get(c) ? rowsContract : rowsEoa).push(b);
  }
  bucket(rowsContract, '合约 creator（匿名服务盘）');
  bucket(rowsEoa, 'EOA creator（直接发币）');
  bucket(rowsUnknown, 'creator 未知（早于采集）');

  // 明细：合约盘 top 亏损/盈利
  console.log('\n-- 合约 creator 盘明细（按 pnl 升序前 20）--');
  rowsContract.sort((a, b) => a.pnl - b.pnl).slice(0, 20)
    .forEach(r => console.log(`  ${r.sym} ${r.addr.slice(0, 10)} ret=${(r.ret * 100).toFixed(1)}% pnl=${r.pnl.toFixed(4)} creator=${tokenCreator.get(r.addr).slice(0, 10)}`));
  console.log('-- 合约 creator 盘盈利前 10 --');
  [...rowsContract].sort((a, b) => b.pnl - a.pnl).slice(0, 10)
    .forEach(r => console.log(`  ${r.sym} ${r.addr.slice(0, 10)} ret=${(r.ret * 100).toFixed(1)}% pnl=${r.pnl.toFixed(4)} creator=${tokenCreator.get(r.addr).slice(0, 10)}`));

  // 合约 creator 聚合：哪些合约贡献了多少盘
  const cCount = new Map();
  for (const r of rowsContract) {
    const c = tokenCreator.get(r.addr);
    const e = cCount.get(c) || { n: 0, pnl: 0 };
    e.n++; e.pnl += r.pnl; cCount.set(c, e);
  }
  console.log('\n-- 合约 creator 发盘数排行（我们买入范围内）--');
  [...cCount.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10)
    .forEach(([c, e]) => console.log(`  ${c} n=${e.n} 净BNB=${e.pnl.toFixed(3)}`));

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
