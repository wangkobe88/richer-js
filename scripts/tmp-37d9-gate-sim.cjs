#!/usr/bin/env node
// G5 口径修正对照模拟(bt-v153 10-12 窗口):各门径下被拦票盈亏/误伤-止血对照(182 跑)
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');
const { dbManager } = require('../src/services/dbManager');

const EXP = 'd3453504-03d5-480c-89e0-483db930361c';
const R = p => path.join(__dirname, '..', p);
const lc = s => (s || '').toLowerCase();
const NEW7 = [
  '0x9d41e99374e4bceebb4c0bd070e814e72b7e7ace', '0xd80bf2b4d8158b21da727c3a510284a5f73747c3',
  '0xf7a934528d38e2f2865a7cd30c335c6d115928b8', '0xf90026d86fb41f02a2be73345a8904d0b003ff6d',
  '0x9a213971f8749e087c6f8d5f5d1daabef0e14191', '0xc8c2c361142fda8a8ee5a807972fbfa9eb4f5a51',
  '0xa44039d10d4883a7353ee729a48fda88fa5d2333',
].map(lc);
const V1_6 = [
  '0x06f0a63c7f3df29d855c84c6cbfc55f35abc1cfc', '0x0b2259e10d494f848ea1458acb39152ad9865424',
  '0x727864fad9aef9b1049b1a724c66d2f91ecc0bf2', '0x27ac0351e225a15fb13d6b84a8dc31d799d0fe76',
  '0x66c81cf68a6bfb01a1885be28f01a588be477231', '0x1bd3c9ac6f9a4204aa7ededcf3a7afe16b3f644e',
].map(lc);
const ALL13 = new Set([...NEW7, ...V1_6]);
const A440 = '0xa44039d10d4883a7353ee729a48fda88fa5d2333';

// token -> [{w, firstDt, bnb}]
const trace = new Map();
async function scanCache() {
  for (const f of ['fourmeme.jsonl.gz', 'flap.jsonl.gz']) {
    const fp = R('data/tick-cache/backtest/win-20261012t000000000z_20261013t120000000z/' + f);
    if (!fs.existsSync(fp)) continue;
    const rl = readline.createInterface({ input: fs.createReadStream(fp).pipe(zlib.createGunzip()) });
    for await (const line of rl) {
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (r.trade_type !== 'buy') continue;
      const w = lc(r.sender_address) || lc(r.trader_address);
      if (!ALL13.has(w)) continue;
      const t = lc(r.token_address);
      if (!trace.has(t)) trace.set(t, []);
      const arr = trace.get(t);
      let e = arr.find(x => x.w === w);
      if (!e) { e = { w, firstDt: Date.parse(r.block_time), bnb: 0 }; arr.push(e); }
      e.bnb += Number(r.bnb_amount) || 0;
      if (Date.parse(r.block_time) < e.firstDt) e.firstDt = Date.parse(r.block_time);
    }
  }
}

function crewStateAt(t, dt) {
  const arr = (trace.get(t) || []).filter(e => e.firstDt <= dt && e.bnb >= 0.001);
  return { n: arr.length, bnb: arr.reduce((s, e) => s + e.bnb, 0), wallets: arr.map(e => e.w), hasA440: arr.some(e => e.w === A440) };
}

async function main() {
  await scanCache();
  const sb = dbManager.getClient();
  const tr = await sb.from('trades').select('token_address,trade_direction,input_amount,output_amount,success,executed_at')
    .eq('experiment_id', EXP).order('executed_at').limit(3000);
  if (tr.error) throw tr.error;
  const pnl = new Map(), firstBuy = new Map();
  for (const t of tr.data) {
    if (!t.success) continue;
    const tok = lc(t.token_address);
    if (!pnl.has(tok)) pnl.set(tok, 0);
    if (t.trade_direction === 'buy') {
      pnl.set(tok, pnl.get(tok) - (Number(t.input_amount) || 0));
      const et = Date.parse(t.executed_at);
      if (!firstBuy.has(tok) || et < firstBuy.get(tok)) firstBuy.set(tok, et);
    } else pnl.set(tok, pnl.get(tok) + (Number(t.output_amount) || 0));
  }

  // 门径定义:返回 true=拦截
  const GATES = {
    '现行 G5:13 址 bnb>0(绝对 veto)': s => s.bnb > 0,
    'v1 6 址 bnb>0(现状对照)': (s, poolTag) => poolTag === 'v1',
    '7 址 bnb>0(本批增量)': (s, poolTag) => poolTag === 'new',
    'A. wallets>=2(组织性在场)': s => s.n >= 2,
    'B. wallets>=3': s => s.n >= 3,
    'C. bnb>=0.3(金额门,≈三人组 0.132×3 档)': s => s.bnb >= 0.3,
    'D. wallets>=2 或 bnb>=0.3': s => s.n >= 2 || s.bnb >= 0.3,
    'E. 剔 a44039d1 后 bnb>0(12 址)': s => s.bnb > 0 && !s.onlyA440,
  };
  // 先算每票 crew 状态(分 v1/new/混合/onlyA440)
  const states = new Map();
  for (const [tok] of pnl) {
    const fb = firstBuy.get(tok);
    if (fb == null) continue;
    const s = crewStateAt(tok, fb);
    const v1N = s.wallets.filter(w => V1_6.includes(w)).length;
    const newN = s.wallets.filter(w => NEW7.includes(w)).length;
    s.poolTag = v1N > 0 && newN > 0 ? 'mix' : (v1N > 0 ? 'v1' : (newN > 0 ? 'new' : 'none'));
    s.onlyA440 = s.hasA440 && s.n === 1;
    states.set(tok, s);
  }
  console.log('══ 各门径净效应(bt-v153 106 成交票;被拦票盈亏<0=止血,>0=误伤) ══\n');
  for (const [label, gate] of Object.entries(GATES)) {
    let blocked = 0, blockedPnl = 0, pos = 0, neg = 0, posPnl = 0;
    for (const [tok, p] of pnl) {
      const s = states.get(tok);
      if (!s) continue;
      const hit = label.includes('v1 6 址') ? gate(s, 'v1') : label.includes('7 址 bnb>0') ? gate(s, 'new') : gate(s);
      if (hit) { blocked++; blockedPnl += p; if (p > 0) { pos++; posPnl += p; } else if (p < 0) neg++; }
    }
    console.log(`${label}\n  拦 ${blocked} 票 合计 ${blockedPnl >= 0 ? '+' : ''}${blockedPnl.toFixed(4)}(盈利票误伤 ${pos} 张 +${posPnl.toFixed(4)} / 亏损票止血 ${neg} 张)`);
  }
  console.log('\n══ 被拦票明细(现行 G5 全 13 址口径,按盈亏排序) ══');
  const rows = [];
  for (const [tok, p] of pnl) {
    const s = states.get(tok);
    if (s && s.bnb > 0) rows.push({ tok, p, n: s.n, bnb: s.bnb, a440: s.hasA440 });
  }
  rows.sort((a, b) => b.p - a.p);
  for (const r of rows) console.log(`  ${r.tok} ${r.p >= 0 ? '+' : ''}${r.p.toFixed(4)} crew${r.n}址 ${r.bnb.toFixed(3)}B${r.a440 ? ' 含a440' : ''}`);
  console.log('\n[done]');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
