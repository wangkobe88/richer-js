#!/usr/bin/env node
/**
 * gmgn-token-forensics — 任意票参与者 GMGN 画像复盘（T193，2026-11-19 张雪电摩
 * pump 作弊案工具化）：票盘面形状 × gmgn_wallet_profiles 画像库（30d 快照）联查，
 * 零 GMGN API 配额（全查库；--fetch-miss 可选补拉 top 钱包落库，显式烧配额）。
 *
 * 用法（本地/182 均可——单票小结果；重票请 182）：
 *   node scripts/gmgn-token-forensics.cjs --token 0x7174c6d4dd7cb414ec0ee43d8bf0dae282bc7777
 *   node scripts/gmgn-token-forensics.cjs --token <addr> --anchor 2026-11-19T08:30:00Z --window 300
 *   node scripts/gmgn-token-forensics.cjs --token <addr> --fetch-miss   # 库 miss 的 top20 补拉落库
 *
 * 输出：①票形状（价轨/买卖额/生命窗）②参与者分布（bot 浓度/票数/小亏带/新号/
 * 同秒停机组）③top 钱包明细（案内行为 × 库内画像）④锚窗 top-N 画像聚合键
 * （与 BuyPointCheckService T193 观察段同源 participant-profile.js 单一真相）。
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'config', '.env') });

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}
const TOKEN = String(arg('token', '')).toLowerCase();
const ANCHOR = arg('anchor', null);       // ISO 时刻（缺省=票全生命周期）
const WINDOW_SEC = parseFloat(arg('window', '0')) || 0; // 锚前窗秒（0=全窗）
const FETCH_MISS = arg('fetch-miss', false) === true;
if (!/^0x[0-9a-f]{40}$/.test(TOKEN)) throw new Error('--token <0x…40hex> 必填');

const { dbManager } = require(path.join(__dirname, '..', 'src', 'services', 'dbManager'));
const { selectTopBuyers, aggregateParticipantProfile } = require(path.join(__dirname, '..', 'src', 'market-analysis', 'participant-profile'));

const sb = dbManager.getClient();

async function main() {
  // ── 票事件与 ticks ──
  const { data: evs } = await sb.from('wss_events').select('kind,block_time,payload,platform')
    .eq('token_address', TOKEN).limit(10);
  const create = (evs || []).find(e => e.kind === 'token_create');
  if (create) console.log(`票：${create.payload?.name || ''}(${create.payload?.symbol || ''}) ${create.platform} 创建 ${create.block_time}`);

  let ticks = [];
  for (let off = 0; ; off += 1000) { // max-rows 分页（单票通常 <1000）
    const from = off;
    const { data: page } = await sb.from('wss_price_ticks')
      .select('block_time,trade_type,sender_address,trader_address,bnb_amount,price_bnb')
      .eq('token_address', TOKEN).order('block_time', { ascending: true })
      .range(from, from + 999);
    ticks.push(...(page || []));
    if (!page || page.length < 1000) break;
  }
  if (!ticks.length) { console.log('无 ticks'); process.exit(1); }
  if (ANCHOR && WINDOW_SEC > 0) {
    const hi = new Date(ANCHOR).getTime();
    const lo = hi - WINDOW_SEC * 1000;
    ticks = ticks.filter(t => {
      const ts = new Date(t.block_time).getTime();
      return ts >= lo && ts <= hi;
    });
    console.log(`锚窗 [${new Date(lo).toISOString()} ~ ${ANCHOR}]：${ticks.length} 行`);
  }

  // ── 盘面形状 ──
  const buys = ticks.filter(t => t.trade_type === 'buy'), sells = ticks.filter(t => t.trade_type === 'sell');
  const sum = a => a.reduce((x, t) => x + Number(t.bnb_amount || 0), 0);
  const px = ticks.filter(t => t.price_bnb && Number(t.price_bnb) > 0);
  const pxAt = i => Number((px[i] || px[px.length - 1] || {}).price_bnb) || 0;
  console.log(`\n== 盘面 == ${ticks.length} 笔 | 买 ${buys.length}/${sum(buys).toFixed(2)}B 卖 ${sells.length}/${sum(sells).toFixed(2)}B`);
  console.log(`   首 ${ticks[0].block_time.slice(5, 19)} 末 ${ticks[ticks.length - 1].block_time.slice(5, 19)}`);
  if (px.length > 1) {
    const mx = Math.max(...px.map(t => Number(t.price_bnb))), mn = Math.min(...px.map(t => Number(t.price_bnb)));
    const last = Number(px[px.length - 1].price_bnb);
    console.log(`   价 min=${mn.toExponential(2)} max=${mx.toExponential(2)}（${((mx / mn - 1) * 100).toFixed(0)}%） last=${last.toExponential(2)}`);
  }

  // ── 参与钱包汇总（案内行为）+ 查库画像 ──
  const ws = new Map();
  for (const t of ticks) {
    const w = (t.sender_address || t.trader_address || '').toLowerCase();
    if (!w) continue;
    const e = ws.get(w) || { buy: 0, sell: 0, buyN: 0, sellN: 0, first: t.block_time };
    if (t.trade_type === 'buy') { e.buy += Number(t.bnb_amount || 0); e.buyN++; }
    else { e.sell += Number(t.bnb_amount || 0); e.sellN++; }
    if (t.block_time < e.first) e.first = t.block_time;
    ws.set(w, e);
  }
  const wallets = [...ws.keys()];
  const prof = new Map();
  for (let i = 0; i < wallets.length; i += 50) {
    const { data } = await sb.from('gmgn_wallet_profiles')
      .select('address,tags,created_at_sec,token_num,realized_profit,winrate,last_active_sec')
      .in('address', wallets.slice(i, i + 50));
    for (const r of data || []) prof.set(String(r.address).toLowerCase(), r);
  }
  const miss = wallets.filter(w => !prof.has(w));
  console.log(`\n== 参与者 == ${wallets.length} 钱包 | 库内命中 ${wallets.length - miss.length}（miss ${miss.length}——离线库未覆盖，${FETCH_MISS ? '补拉中' : '可 --fetch-miss 补'}）`);

  if (FETCH_MISS && miss.length) {
    const { GMGNPortfolioAPI } = require(path.join(__dirname, '..', 'src', 'core', 'gmgn-api'));
    const api = new GMGNPortfolioAPI({ apiKey: process.env.GMGN_API_KEY, timeout: 15000 });
    // 只补案内成交额 top20（配额克制；其余 miss 保持 miss）
    const missTop = miss.sort((a, b) => (ws.get(b).buy + ws.get(b).sell) - (ws.get(a).buy + ws.get(a).sell)).slice(0, 20);
    console.log(`[fetch-miss] 补拉 ${missTop.length} 个（案内成交额 top20）…`);
    for (const w of missTop) {
      try {
        const data = await api.getWalletStats('bsc', w, '30d');
        const c = data?.common || {}, p = data?.pnl_stat || {};
        const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
        const row = {
          address: w, tags: Array.isArray(c.tags) ? c.tags : [], created_at_sec: num(c.created_at),
          fund_from_address: c.fund_from_address || null, stats_period: '30d',
          buy_count: num(data?.buy), sell_count: num(data?.sell), token_num: num(p.token_num),
          realized_profit: num(data?.realized_profit), winrate: num(p.winrate),
          last_active_sec: num(data?.last_timestamp), native_balance_bnb: num(data?.native_balance_bnb),
          fetched_at: new Date().toISOString(), fetch_count: 1,
        };
        const { error } = await sb.from('gmgn_wallet_profiles').upsert(row, { onConflict: 'address' });
        if (error) throw new Error(error.message);
        prof.set(w, row);
      } catch (e) { console.log('  [fail]', w.slice(0, 12), e.message.slice(0, 60)); }
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // ── 分布聚合（全参与者口径）──
  const hitRows = wallets.map(w => prof.get(w)).filter(Boolean);
  const BOT = ['gmgn', 'gmgn_go', 'arbitrager'];
  const botN = hitRows.filter(r => (r.tags || []).some(t => BOT.includes(t))).length;
  const toks = hitRows.map(r => r.token_num).filter(Number.isFinite).sort((a, b) => a - b);
  const rps = hitRows.map(r => r.realized_profit).filter(Number.isFinite);
  const med = a => a.length ? a[Math.floor((a.length - 1) / 2)] : null;
  const nowSec = Date.now() / 1000;
  const youngN = hitRows.filter(r => Number.isFinite(r.created_at_sec) && r.created_at_sec > 0 && nowSec - r.created_at_sec <= 30 * 86400).length;
  const withAge = hitRows.filter(r => Number.isFinite(r.created_at_sec) && r.created_at_sec > 0).length;
  const loserN = rps.filter(v => v < 0).length;
  const smallLoserN = rps.filter(v => v <= 0 && v > -2000).length;
  console.log(`\n== 参与者画像（全口径 ${hitRows.length} 命中）==`);
  console.log(`   bot 标签 ${botN}/${hitRows.length}（${(botN / Math.max(hitRows.length, 1) * 100).toFixed(0)}%） | 30d 票数 p50=${med(toks)} p90=${toks[Math.floor(toks.length * 0.9)] ?? '-'} max=${toks[toks.length - 1] ?? '-'}`);
  console.log(`   亏损 ${loserN}/${rps.length} | 小亏打工带(-2000~0$) ${smallLoserN}（${(smallLoserN / Math.max(rps.length, 1) * 100).toFixed(0)}%） | 盈亏Σ=${rps.reduce((a, b) => a + b, 0).toFixed(0)}$`);
  console.log(`   ≤30d 新号 ${youngN}/${withAge}`);
  const lastSecMap = new Map();
  for (const r of hitRows) if (Number.isFinite(r.last_active_sec) && r.last_active_sec > 0) lastSecMap.set(r.last_active_sec, (lastSecMap.get(r.last_active_sec) || 0) + 1);
  const sync = [...lastSecMap.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]);
  console.log(`   同秒停机组(≥3): ${sync.map(([ts, c]) => `${new Date(ts * 1000).toISOString().slice(5, 16)}×${c}`).join(', ') || '无'}`);

  // ── top 钱包明细（案内 × 画像）──
  const sorted = wallets.sort((a, b) => (ws.get(b).buy + ws.get(b).sell) - (ws.get(a).buy + ws.get(a).sell)).slice(0, 15);
  console.log(`\n== top15 钱包（案内行为 | 画像）==`);
  for (const w of sorted) {
    const e = ws.get(w), p = prof.get(w);
    const tagStr = p ? (p.tags || []).join('/') || '—' : 'MISS';
    console.log(`${w}` +
      ` 案内买${e.buy.toFixed(2)}B/${e.buyN} 卖${e.sell.toFixed(2)}B/${e.sellN} net=${(e.buy - e.sell).toFixed(3)} 首现${e.first.slice(11, 19)}` +
      ` | 30d票=${p?.token_num ?? '?'} 盈亏=${p?.realized_profit != null ? p.realized_profit.toFixed(0) + '$' : '?'} wr=${p?.winrate != null ? (p.winrate * 100).toFixed(0) + '%' : '?'} [${tagStr}]` +
      (p?.last_active_sec ? ` last:${new Date(p.last_active_sec * 1000).toISOString().slice(5, 16)}` : ''));
  }

  // ── 锚窗 top-N 聚合键（与 T193 观察段同源）──
  const top = selectTopBuyers(ticks);
  const seg = aggregateParticipantProfile(top, prof, { nowSec: Math.floor(nowSec) });
  console.log(`\n== 锚窗 top${seg.selected} 买家聚合键（PP1 观察段口径）==`);
  console.log(JSON.stringify({ ...seg, wallets: seg.wallets.map(w => w.wallet.slice(0, 10) + (w.miss ? ':miss' : ':')) }, null, 0));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
