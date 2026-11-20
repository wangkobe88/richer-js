// ============================================================================
// 临时工具（182 跑）：bt-v147 买点测试集构建（用户指令「取样所有买入点位，
// 一批批过」）——per (token, 首信号) 去重成复审卡：
//   token/symbol/信号时间/腿/五层链路（AF path·FP reason·cheat grade·BP bucket）/
//   executed / per-token 净盈亏 / 拒因
// 输出 /tmp/btv147-buyset.json + 控制台摘要（量级/分布/批次划分）
// ============================================================================
import { dbManager } from '../src/services/dbManager.js';
import fs from 'node:fs';

const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';

const c = await dbManager.getClient();
async function page(table, cols) {
  const out = []; let from = 0;
  while (true) {
    const { data, error } = await c.from(table).select(cols)
      .eq('experiment_id', EXP).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return out;
}

const sigs = await page('strategy_signals', 'id,signal_type,token_address,token_symbol,created_at,executed,metadata');
const buys = sigs.filter(s => s.signal_type === 'BUY');
console.log(`BUY 信号行: ${buys.length}`);

// per-token 盈亏
const trs = await page('trades', 'token_address,trade_direction,input_amount,output_amount');
const pnl = new Map();
for (const t of trs) {
  const k = (t.token_address || '').toLowerCase();
  const o = pnl.get(k) || { buy: 0, sell: 0, nBuy: 0, nSell: 0 };
  if (t.trade_direction === 'buy') { o.buy += Number(t.input_amount) || 0; o.nBuy++; }
  else { o.sell += Number(t.output_amount) || 0; o.nSell++; }
  pnl.set(k, o);
}
let gBuy = 0, gSell = 0;
for (const o of pnl.values()) { gBuy += o.buy; gSell += o.sell; }
console.log(`净收益: ${(gSell - gBuy).toFixed(4)}（买 ${gBuy.toFixed(2)} / 卖 ${gSell.toFixed(2)}）`);

// per (token, 首信号) 测试卡
const byToken = new Map();
for (const s of buys) {
  const k = (s.token_address || '').toLowerCase();
  const md = s.metadata || {};
  const card = {
    token: k, symbol: s.token_symbol, at: s.created_at,
    leg: (md.signalGate || {}).legId || null,
    af: (md.actFrontGate || {}).path || (md.actFrontGate || {}).status || null,
    afAct: (md.actFrontGate || {}).act || null,
    fp: (md.factorCheck || {}).reason || ((md.factorCheck || {}).status === 'assessed' ? 'pass' : (md.factorCheck || {}).status) || null,
    cheat: (md.cheatCheck || {}).grade || (md.cheatCheck || {}).status || null,
    bp: ((md.buyPoint || {}).assessment || {}).bucket || (md.buyPoint || {}).status || null,
    executed: false, sigN: 0,
  };
  const cur = byToken.get(k);
  if (!cur) { byToken.set(k, { ...card, executed: s.executed === true, sigN: 1 }); }
  else { cur.sigN++; if (s.executed === true) cur.executed = true; }
}
const cards = [...byToken.values()];
for (const card of cards) {
  const o = pnl.get(card.token);
  card.net = o ? +(o.sell - o.buy).toFixed(4) : null;
}
// 排序：成交票按净额降序在前（复审优先正票误拦风险/负票止血核对），未成交票按时间
cards.sort((a, b) => {
  if ((b.executed ? 1 : 0) !== (a.executed ? 1 : 0)) return (b.executed ? 1 : 0) - (a.executed ? 1 : 0);
  if (a.executed) return (b.net || 0) - (a.net || 0);
  return a.at < b.at ? -1 : 1;
});

// 摘要
const stat = { tokens: cards.length, execTokens: cards.filter(x => x.executed).length };
const afG = {}, fpG = {};
for (const x of cards) { afG[x.af] = (afG[x.af] || 0) + 1; if (!x.executed) fpG[x.fp] = (fpG[x.fp] || 0) + 1; }
console.log(`去重买点 token: ${stat.tokens}（成交 ${stat.execTokens}）`);
console.log('首信号 AF path 分布:', JSON.stringify(afG));
console.log('未成交票 FP/链路拦因分布:', JSON.stringify(fpG));
const BATCH = 25;
const batches = Math.ceil(cards.length / BATCH);
console.log(`分批: ${batches} 批×${BATCH} 票`);

fs.writeFileSync('/tmp/btv147-buyset.json', JSON.stringify({ exp: EXP, net: +(gSell - gBuy).toFixed(4), batch: BATCH, cards }, null, 1));
console.log('JSON → /tmp/btv147-buyset.json');
process.exit(0);
