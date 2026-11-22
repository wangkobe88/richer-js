#!/usr/bin/env node
// 一次性：金狗集合「休眠强庄突然点火」形状扫描（用户假设 2026-11-21：
// （多个）大户持仓好久也不砸盘，然后突然开始拉盘——JG-7 cloutLab 同形状找同类）。
// 数据=case_ticks 集合副本（30 票全 synced）；182 跑全量，本地可单票验证。
// 用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const ONLY = process.argv[2] || null; // 可选：只跑单票（地址前缀）

const SUBstantial = 0.05;   // 静默判定足额线（B）
const IGNITE_BNB = 0.1;     // 点火单认定线（B）
const IGNITE_WIN = 120;     // 点火窗（s）

// ── 单票分析（纯函数）──
function analyze(rows, meta) {
  const ticks = rows.map(r => ({
    ts: new Date(r.block_time).getTime(),
    side: r.trade_type,
    bnb: Number(r.bnb_amount || 0),
    tok: Number(r.token_amount || 0),
    px: Number(r.price_bnb || 0),
    out: !!r.price_outlier,
    w: ((r.sender_address || r.trader_address) || '?').toLowerCase(),
    bn: Number(r.block_number || 0), li: Number(r.log_index || 0),
  })).sort((a, b) => a.bn - b.bn || a.li - b.li);

  const created = meta.createdAtMs || ticks[0].ts;
  const senderFill = rows.filter(r => r.sender_address).length / Math.max(rows.length, 1);

  // ── 价格路径（可靠价：非 outlier 且 >0）──
  const pr = ticks.filter(t => !t.out && t.px > 0);
  if (pr.length < 10) return { skip: '可靠价不足' };
  let athPx = 0, tAth = null;
  for (const t of pr) if (t.px > athPx) { athPx = t.px; tAth = t.ts; }
  // 坑底 t_trough = ATH 前可靠价最低点的【最后一次】出现（黄金坑/平台底）
  let pMin = Infinity, tTrough = null;
  for (const t of pr) {
    if (t.ts > tAth) break;
    if (t.px <= pMin) { pMin = t.px; tTrough = t.ts; }
  }
  // 点火时刻 t_ign = 坑底之后首笔 ≥IGNITE_BNB 大买（回退 0.05B/坑底本身）
  let ign = null;
  for (const t of ticks) {
    if (t.ts <= tTrough || t.ts > tAth) continue;
    if (t.side === 'buy' && t.bnb >= IGNITE_BNB) { ign = t; break; }
  }
  if (!ign) for (const t of ticks) {
    if (t.ts <= tTrough || t.ts > tAth) continue;
    if (t.side === 'buy' && t.bnb >= SUBstantial) { ign = t; break; }
  }
  const tStart = ign ? ign.ts : tTrough;
  const multiple = athPx / pMin;
  const ageAtStart = (tStart - created) / 1000;
  const troughGapSec = ign ? Math.round((ign.ts - tTrough) / 1000) : 0;

  // ── t_ign 前最后足额成交 → 静默时长 ──
  let lastSub = null;
  for (const t of ticks) { if (t.ts >= tStart) break; if (t.bnb >= SUBstantial) lastSub = t.ts; }
  const quietSec = lastSub == null ? ageAtStart : (tStart - lastSub) / 1000;

  // ── t_ign 时刻持仓结构（净 token 持仓；市值用坑底价）──
  const pos = new Map();   // w -> {netTok, buyBnb, sellBnb, firstBuyTs, lastBuyTs, sellCnt}
  for (const t of ticks) {
    if (t.ts >= tStart) break;
    let a = pos.get(t.w);
    if (!a) { a = { netTok: 0, buyBnb: 0, sellBnb: 0, firstBuyTs: null, lastBuyTs: null, sellCnt: 0 }; pos.set(t.w, a); }
    if (t.side === 'buy') { a.netTok += t.tok; a.buyBnb += t.bnb; if (a.firstBuyTs == null) a.firstBuyTs = t.ts; a.lastBuyTs = t.ts; }
    else { a.netTok -= t.tok; a.sellBnb += t.bnb; a.sellCnt++; }
  }
  const holders = [...pos.entries()].filter(([, a]) => a.netTok > 0)
    .map(([w, a]) => ({ w, ...a, val: a.netTok * pMin }))
    .sort((x, y) => y.val - x.val);
  const totVal = holders.reduce((s, h) => s + h.val, 0);
  const top1 = holders[0] || null;
  const top3 = holders.slice(0, 3);
  const top1Share = totVal > 0 && top1 ? top1.val / totVal : 0;
  const top3Share = totVal > 0 ? top3.reduce((s, h) => s + h.val, 0) / totVal : 0;

  // ── 点火窗 [t_ign, +120s]：老持仓者（t_ign 前净持仓>0） vs 新钱包 ──
  const posAt = new Map(holders.map(h => [h.w, h.netTok]));
  let oldBuyBnb = 0, newBuyBnb = 0, igniteBuys = 0, igniteWallets = new Set();
  let firstBig = null; // {ts, w, bnb, old}——点火窗内首笔 ≥IGNITE_BNB
  for (const t of ticks) {
    if (t.ts < tStart || t.ts > tStart + IGNITE_WIN * 1000) continue;
    if (t.side !== 'buy') continue;
    igniteBuys++;
    igniteWallets.add(t.w);
    const old = (posAt.get(t.w) || 0) > 0;
    if (old) oldBuyBnb += t.bnb; else newBuyBnb += t.bnb;
    if (t.bnb >= IGNITE_BNB && (!firstBig || t.ts < firstBig.ts)) firstBig = { ts: t.ts, w: t.w, bnb: t.bnb, old };
  }
  const oldShare = (oldBuyBnb + newBuyBnb) > 0 ? oldBuyBnb / (oldBuyBnb + newBuyBnb) : 0;
  const igniterOld = ign ? (posAt.get(ign.w) || 0) > 0 : null;

  // ── 分类旗 ──
  const fDormant = ageAtStart >= 120 && quietSec >= 60;
  const fConc = top1Share >= 0.4 || top3Share >= 0.6;
  const fIgnite = igniterOld === true || oldShare >= 0.5 || (firstBig && firstBig.old);
  const fPump = multiple >= 2;
  const match = fDormant && fConc && fIgnite && fPump;

  return {
    match, n: ticks.length, senderFill,
    multiple: +multiple.toFixed(1), ageAtStart: Math.round(ageAtStart), quietSec: Math.round(quietSec), troughGapSec,
    athDelayMin: +((tAth - tStart) / 60000).toFixed(1),
    top1Share: +(top1Share * 100).toFixed(1), top3Share: +(top3Share * 100).toFixed(1), nHolders: holders.length,
    top1: top1 ? {
      w: top1.w.slice(0, 10), valBnb: +top1.val.toFixed(2),
      heldSec: Math.round((tStart - top1.firstBuyTs) / 1000),
      dumpRatio: +(top1.buyBnb > 0 ? top1.sellBnb / top1.buyBnb : 0).toFixed(2), sellCnt: top1.sellCnt,
    } : null,
    ignite: { oldShare: +(oldShare * 100).toFixed(0), igniterOld, firstBigOld: firstBig ? firstBig.old : null, firstBigBnb: firstBig ? +firstBig.bnb.toFixed(2) : 0, wallets: igniteWallets.size },
    flags: { fDormant, fConc, fIgnite, fPump },
    _debug: { tStart, tAth, created },
  };
}

(async () => {
  const sb = dbManager.getClient();
  const { data: members, error } = await sb.from('case_collection_tokens')
    .select('token_address, platform, note, token_meta')
    .eq('collection_id', COL)
    .order('added_at', { ascending: true });
  if (error) throw new Error(error.message);
  const list = ONLY ? members.filter(m => m.token_address.startsWith(ONLY.toLowerCase())) : members;
  console.log(`金狗集合成员 ${members.length} 票，本次扫描 ${list.length} 票`);

  const out = [];
  for (const m of list) {
    // 分页拉该票 case_ticks（keyset by id）
    const rows = [];
    let cursor = 0;
    for (;;) {
      const { data: page, error: e2 } = await sb.from('case_ticks')
        .select('id, trade_type, bnb_amount, token_amount, price_bnb, price_outlier, block_number, log_index, block_time, sender_address, trader_address')
        .eq('collection_id', COL).eq('token_address', m.token_address)
        .gt('id', cursor).order('id', { ascending: true }).limit(1000);
      if (e2) throw new Error(e2.message);
      rows.push(...page);
      if (page.length < 1000) break;
      cursor = page[page.length - 1].id;
    }
    const meta = { createdAtMs: (m.token_meta && m.token_meta.blockTimeMs) ? Number(m.token_meta.blockTimeMs) : null };
    const r = analyze(rows, meta);
    const sym = (m.token_meta && m.token_meta.symbol) || m.token_address.slice(0, 8);
    out.push({ sym, addr: m.token_address, note: (m.note || '').slice(0, 18), ...r });
    const line = out[out.length - 1];
    console.log(`${String(sym).padEnd(14)} ${line.skip ? 'SKIP:' + line.skip :
      `${line.match ? '★★MATCH' : '  -    '} ×${String(line.multiple).padStart(5)} age=${String(line.ageAtStart).padStart(5)}s quiet=${String(line.quietSec).padStart(5)}s gap=${String(line.troughGapSec).padStart(4)}s ` +
      `top1=${String(line.top1Share).padStart(5)}% top3=${String(line.top3Share).padStart(5)}% hN=${String(line.nHolders).padStart(3)} ` +
      `点火者=${line.ignite.igniterOld === null ? '-' : line.ignite.igniterOld ? '老' : '新'} ignOld=${String(line.ignite.oldShare).padStart(3)}% ` +
      `top1[dump${line.top1 ? line.top1.dumpRatio : '-'} held${line.top1 ? Math.round(line.top1.heldSec / 60) : '-'}m]`}`);
  }

  const matches = out.filter(o => o.match);
  console.log(`\n===== 匹配「休眠强庄点火」 ${matches.length}/${out.length} 票 =====`);
  for (const o of matches) console.log(`${o.sym} ${o.addr}`);
  // 近似匹配（三旗差一个）
  console.log('\n===== 差一旗票 =====');
  for (const o of out.filter(o => !o.match && !o.skip)) {
    const fl = o.flags;
    const cnt = [fl.fDormant, fl.fConc, fl.fIgnite, fl.fPump].filter(Boolean).length;
    if (cnt === 3) console.log(`${o.sym} 差:${!fl.fDormant ? '休眠' : !fl.fConc ? '集中' : !fl.fIgnite ? '老点火' : '涨幅'} age=${o.ageAtStart} quiet=${o.quietSec} top1=${o.top1Share}% ignOld=${o.ignite.oldShare}%`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
