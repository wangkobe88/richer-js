#!/usr/bin/env node
// 一次性：JG-4 burst 触发波钱包画像（0x4509 下雨了，bt-v164 fire=2026-10-03T15:03:13Z）。用后可删。
// burst 触发波窗 = fire 前最密 5s 窗（T189 口径）；成员 = 窗内买入钱包；画像 = gmgn_wallet_profiles。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0x4509204c4f82dee14352bf7cfafae4138b287777';
const FIRE = new Date('2026-10-03T15:03:13Z').getTime();

(async () => {
  const sb = dbManager.getClient();
  // 拉该票全部 ticks（单票，量小）
  const ticks = [];
  for (let off = 0; ; off += 1000) {
    const { data: page } = await sb.from('wss_price_ticks')
      .select('block_time,trade_type,sender_address,trader_address,bnb_amount,price_bnb')
      .eq('token_address', TOKEN).order('block_time', { ascending: true })
      .range(off, off + 999);
    ticks.push(...(page || []));
    if (!page || page.length < 1000) break;
  }
  console.log(`全窗 ticks ${ticks.length} 行（${ticks[0]?.block_time} ~ ${ticks[ticks.length-1]?.block_time}）`);

  // fire 前 120s 内的买行时间线
  const pre = ticks.filter(t => {
    const ts = new Date(t.block_time).getTime();
    return ts <= FIRE && ts >= FIRE - 120000;
  });
  console.log(`\n== fire 前 120s 时间线（${pre.length} 行）==`);
  for (const t of pre) {
    const w = (t.sender_address || t.trader_address || '?').toLowerCase();
    const sec = (new Date(t.block_time).getTime() - (FIRE - 120000)) / 1000;
    console.log(`t+${sec.toFixed(1).padStart(6)}s ${t.trade_type.toUpperCase().padEnd(4)} ${Number(t.bnb_amount).toFixed(3)}B @${Number(t.price_bnb).toExponential(2)} ${t.sender_address ? 'S' : 'T'}:${w}`);
  }

  // 最密 5s 窗（fire 前，按买额）——T189 触发波窗口径
  const buysPre = pre.filter(t => t.trade_type === 'buy' && new Date(t.block_time).getTime() <= FIRE);
  let best = null;
  for (const b of buysPre) {
    const w0 = new Date(b.block_time).getTime();
    const inWin = buysPre.filter(x => {
      const ts = new Date(x.block_time).getTime();
      return ts >= w0 && ts < w0 + 5000;
    });
    const vol = inWin.reduce((s, x) => s + Number(x.bnb_amount || 0), 0);
    if (!best || vol > best.vol) best = { w0, vol, n: inWin.length, rows: inWin };
  }
  console.log(`\n== 最密 5s 买窗（fire 前）==`);
  if (best) {
    console.log(`窗 [${new Date(best.w0).toISOString()} +5s) 买额 ${best.vol.toFixed(3)}B / ${best.n} 笔`);
    const members = new Map();
    for (const r of best.rows) {
      const w = (r.sender_address || r.trader_address || '?').toLowerCase();
      const e = members.get(w) || { buy: 0, n: 0 };
      e.buy += Number(r.bnb_amount || 0); e.n++;
      members.set(w, e);
    }
    // burst 成员在整个票窗的行为（不只触发窗）
    const all = new Map();
    for (const t of ticks) {
      const w = (t.sender_address || t.trader_address || '').toLowerCase();
      if (!w) continue;
      const e = all.get(w) || { buy: 0, sell: 0, buyN: 0, sellN: 0, first: t.block_time, last: t.block_time, rows: [] };
      if (t.trade_type === 'buy') { e.buy += Number(t.bnb_amount || 0); e.buyN++; } else { e.sell += Number(t.bnb_amount || 0); e.sellN++; }
      if (t.block_time > e.last) e.last = t.block_time;
      e.rows.push(`${t.block_time.slice(11,19)} ${t.trade_type} ${Number(t.bnb_amount).toFixed(3)}B`);
      all.set(w, e);
    }
    const wallets = [...members.keys()];
    const { data: profs } = await sb.from('gmgn_wallet_profiles')
      .select('address,tags,created_at_sec,token_num,realized_profit,winrate,last_active_sec')
      .in('address', wallets);
    const pm = new Map((profs || []).map(p => [String(p.address).toLowerCase(), p]));
    for (const [w, m] of members) {
      const a = all.get(w) || {}, p = pm.get(w);
      console.log(`\n--- ${w}`);
      console.log(`  触发窗买 ${m.buy.toFixed(3)}B/${m.n} 笔 | 全票：买${a.buy?.toFixed(3) ?? 0}B/${a.buyN} 卖${a.sell?.toFixed(3) ?? 0}B/${a.sellN} 首现${a.first?.slice(11,19)} 末现${a.last?.slice(11,19)}`);
      console.log(`  行为序列: ${(a.rows || []).join(' | ')}`);
      if (p) {
        const ageD = p.created_at_sec > 0 ? ((FIRE/1000 - p.created_at_sec)/86400).toFixed(0) + 'd@fire' : '?';
        console.log(`  GMGN画像: tags=[${(p.tags||[]).join('/')||'—'}] 30d票=${p.token_num} 盈亏=${p.realized_profit!=null?p.realized_profit.toFixed(0)+'$':'?'} wr=${p.winrate!=null?(p.winrate*100).toFixed(0)+'%':'?'} 号龄${ageD}`);
      } else console.log('  GMGN画像: MISS（离线库未覆盖）');
    }
    // 非成员承接核查（批1 判定「承接 0」的复核）：fire 后 15s 非成员买
    const post = ticks.filter(t => {
      const ts = new Date(t.block_time).getTime();
      return ts > FIRE && ts <= FIRE + 15000;
    });
    let abs = 0, absN = 0, memPost = 0;
    for (const t of post) {
      const w = (t.sender_address || t.trader_address || '').toLowerCase();
      const isBuy = t.trade_type === 'buy';
      const v = Number(t.bnb_amount || 0);
      if (isBuy && !members.has(w)) { abs += v; absN++; }
      if (isBuy && members.has(w)) memPost += v;
    }
    console.log(`\n== 批1 判定复核 == fire 后 15s：非成员买 ${abs.toFixed(3)}B/${absN} 笔 | 成员再买 ${memPost.toFixed(3)}B`);
    console.log(`   （引擎判「承接 0 < 0.1B」→ 批1 全清）`);
  }

  // fire 后价格走势（tick 域统一；卖出基准=卖出时刻（15:03:28）前最近可靠 tick 价）
  const SELL_AT = new Date('2026-10-03T15:03:28Z').getTime();
  const priced = ticks.filter(t => t.price_bnb && Number(t.price_bnb) > 0);
  const beforeSell = priced.filter(t => new Date(t.block_time).getTime() <= SELL_AT);
  const base = Number(beforeSell[beforeSell.length - 1].price_bnb);
  const post = priced.filter(t => new Date(t.block_time).getTime() > SELL_AT);
  let mx = 0, mxAt = '';
  for (const t of post) {
    const p = Number(t.price_bnb);
    if (p > mx) { mx = p; mxAt = t.block_time; }
  }
  const last = Number(post[post.length - 1].price_bnb);
  console.log(`\n== fire 后走势（tick 域）== 卖出基准 ${base.toExponential(2)} @${beforeSell[beforeSell.length-1].block_time.slice(11,19)}`);
  console.log(`   峰值 ${mx.toExponential(2)}（×${(mx/base).toFixed(2)}）@${mxAt.slice(11,19)} | 末价 ${last.toExponential(2)}（×${(last/base).toFixed(2)}）@${post[post.length-1].block_time.slice(11,19)}`);
  // 关键时点采样：卖出后每分钟末价
  const marks = [1, 2, 3, 5, 10].map(m => SELL_AT + m * 60000);
  for (const m of marks) {
    const upto = priced.filter(t => new Date(t.block_time).getTime() <= m);
    if (!upto.length) continue;
    const p = Number(upto[upto.length - 1].price_bnb);
    console.log(`   +${((m - SELL_AT) / 60000)}min: ${p.toExponential(2)}（×${(p / base).toFixed(2)}）`);
  }
  // quote 盘确认
  const { data: qrows } = await sb.from('wss_events')
    .select('kind,block_time,payload').eq('token_address', TOKEN).eq('kind', 'token_quote_set').limit(2);
  console.log(`   quote_set 行: ${qrows && qrows.length ? JSON.stringify(qrows.map(r => ({ at: r.block_time, payload: r.payload }))) : '无（BNB 计价盘）'}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
