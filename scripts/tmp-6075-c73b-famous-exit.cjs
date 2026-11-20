#!/usr/bin/env node
// 0x6075 famous 离场→跌回买入区间→承接 取证：FP10/T167b 各腿取值 + 买点结局
const fs = require('fs');
const path = require('path');
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0x6075e97a4553c71ec1ef1a5bb29200e184f17777';
const EXPS = ['c73b62be-bb1d-4acf-8002-652e5fb8a507', '9b31baf4-bdd3-4ebb-9031-2a1603f34633'];

function loadRoster() {
  const p = path.resolve(__dirname, '../config/rosters/famous-copy-wallets.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const arr = Array.isArray(j) ? j : (j.wallets || j.addresses || []);
  return new Set(arr.map((x) => (typeof x === 'string' ? x.toLowerCase() : String(x.address || x.wallet || '').toLowerCase())).filter(Boolean));
}

async function main() {
  const sb = dbManager.getClient();
  const roster = loadRoster();
  console.log(`famous roster size=${roster.size}`);

  // 实验 1：c73b 配置（FP 门/actFront 灰度）
  for (const eid of EXPS) {
    const { data: ex, error } = await sb.from('experiments')
      .select('id,experiment_name,trading_mode,status,config').eq('id', eid).limit(1);
    if (error || !ex.length) { console.log(`\n=== ${eid} 不存在/错误`); continue; }
    const cfg = ex[0].config || {};
    const fm = cfg.fourmemeWs || {};
    const bp = fm.buyPointCheck || {};
    console.log(`\n=== 实验 ${eid}`);
    console.log(`${ex[0].experiment_name} | mode=${ex[0].trading_mode} status=${ex[0].status}`);
    console.log(`factorCheck.enabled=${(fm.buyPointCheck || {}).factorCheck && fm.buyPointCheck.factorCheck.enabled} actFront=${JSON.stringify((fm.cheatCheck || {}).actFrontGate || null)} cheat=${(fm.cheatCheck || {}).enabled} bp=${bp.enabled}`);
  }

  // token_create 平台确认
  const { data: ev } = await sb.from('wss_events')
    .select('kind,block_time,payload').eq('token_address', TOKEN).eq('kind', 'token_create').limit(1);
  if (ev && ev.length) console.log(`\ntoken_create: ${ev[0].block_time} platform=${(ev[0].payload || {}).platform || (ev[0].payload || {}).pad || '?'}`);

  // ticks 全量分页拉取
  const rows = [];
  let anchor = null;
  for (;;) {
    let q = sb.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address,price_outlier')
      .eq('token_address', TOKEN).order('block_time', { ascending: true }).limit(1000);
    if (anchor) q = q.gt('block_time', anchor);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) break;
    anchor = data[data.length - 1].block_time;
  }
  console.log(`\nticks 总行数=${rows.length}`);
  if (!rows.length) return;

  // 尘 tick 剔除口径与 FA 一致: 依靠 price_bnb; outlier 行价格不可靠
  const t0 = new Date(rows[0].block_time).getTime();
  const rel = rows.filter((r) => r.price_bnb != null && !r.price_outlier);
  const firstRel = rel.length ? Number(rel[0].price_bnb) : null;
  const LAUNCH_CONST = 4496173469e-18;
  const launchFloor = Math.min(LAUNCH_CONST, firstRel || Infinity); // 简化地板(常量+首可靠价),不含滚动最低
  const vsPct = (p) => ((Number(p) / launchFloor) - 1) * 100;

  // famous 时间线
  const fam = [];
  for (const r of rows) {
    const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
    if (roster.has(w)) fam.push(r);
  }
  console.log(`\n=== famous 命中行=${fam.length}`);
  const byW = {};
  for (const r of fam) {
    const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
    (byW[w] = byW[w] || []).push(r);
  }
  let groupBuy = 0, groupSell = 0;
  const famSells = [];
  for (const [w, evs] of Object.entries(byW)) {
    let b = 0, s = 0;
    for (const r of evs) {
      const isBuy = String(r.trade_type).toLowerCase() === 'buy';
      if (isBuy) b += Number(r.bnb_amount || 0); else { s += Number(r.bnb_amount || 0); famSells.push(r); }
    }
    groupBuy += b; groupSell += s;
    const last = evs[evs.length - 1];
    console.log(`${w.slice(0, 10)}: 买=${b.toFixed(4)} 卖=${s.toFixed(4)} 净=${(b - s).toFixed(4)} 首行t+${((new Date(evs[0].block_time).getTime() - t0) / 1000).toFixed(0)}s 末行t+${((new Date(last.block_time).getTime() - t0) / 1000).toFixed(0)}s`);
  }
  famSells.sort((a, b) => new Date(a.block_time) - new Date(b.block_time));
  if (famSells.length) {
    const lastSell = famSells[famSells.length - 1];
    console.log(`\n群体: 买=${groupBuy.toFixed(4)} 卖=${groupSell.toFixed(4)} 自卖比=${(groupSell / (groupBuy || 1)).toFixed(3)} 残仓=${(groupBuy - groupSell).toFixed(4)}`);
    console.log(`末卖: t+${((new Date(lastSell.block_time).getTime() - t0) / 1000).toFixed(0)}s price=${lastSell.price_bnb} vsFloor=${lastSell.price_bnb ? vsPct(lastSell.price_bnb).toFixed(1) + '%' : 'null'}`);
  }

  // 群体加权成本 + 入场后最低（T167b 深破幅度）
  let cost = 0, qty = 0;
  for (const r of fam) {
    const isBuy = String(r.trade_type).toLowerCase() === 'buy';
    if (isBuy && r.price_bnb && !r.price_outlier) {
      const q = Number(r.bnb_amount || 0) / Number(r.price_bnb);
      cost += Number(r.bnb_amount || 0); qty += q;
    }
  }
  const groupCost = qty > 0 ? cost / qty : null;
  let minAfter = Infinity;
  const famLastBuyTs = Math.max(...fam.filter((r) => String(r.trade_type).toLowerCase() === 'buy').map((r) => new Date(r.block_time).getTime()));
  for (const r of rel) {
    const ts = new Date(r.block_time).getTime();
    if (ts >= famLastBuyTs && Number(r.price_bnb) < minAfter) minAfter = Number(r.price_bnb);
  }
  if (groupCost) {
    console.log(`群体加权成本=${groupCost.toExponential(4)} 入场后最低=${minAfter < Infinity ? minAfter.toExponential(4) : '?'} 深破幅度=${minAfter < Infinity ? (((minAfter - groupCost) / groupCost) * 100).toFixed(1) + '%' : '?'}（T167b 豁免线 ≥20% 深）`);
  }

  // 信号+成交（c73b 为主）
  for (const eid of EXPS) {
    const { data: sigs } = await sb.from('strategy_signals')
      .select('created_at,signal_type,strategy_name,execution_status,reason,metadata')
      .eq('experiment_id', eid).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(40);
    if (!sigs || !sigs.length) continue;
    console.log(`\n=== ${eid.slice(0, 8)} 信号 ${sigs.length} 条`);
    for (const s of sigs) {
      const md = s.metadata || {};
      const bp = md.buyPoint || {};
      const sg = md.signalGate || {};
      console.log(`[${s.created_at}] ${s.signal_type} ${s.strategy_name || ''} ${s.execution_status} ${(s.reason || '').slice(0, 60)}` +
        (sg.legId ? ` leg=${sg.legId}#${sg.triggerNo}` : '') +
        (bp.status ? ` bp:${bp.status}/${bp.rule || ''}` : ''));
    }
    const { data: trs } = await sb.from('trades')
      .select('created_at,trade_type,bnb_amount,price_bnb,profit_loss_bnb,metadata')
      .eq('experiment_id', eid).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(30);
    if (trs && trs.length) {
      console.log(`--- 成交 ${trs.length} 笔`);
      for (const t of trs) console.log(`  [${t.created_at}] ${t.trade_type} ${t.bnb_amount}B @${t.price_bnb} pnl=${t.profit_loss_bnb ?? '-'}`);
    }
  }

  // 买点锚（首个 BUY 信号或成交）之后的轨迹 + 全程价格轨迹概览
  const keyTs = rows.length ? null : null;
  // 用 c73b 首成交/首 BUY 信号时刻
  const { data: s0 } = await sb.from('strategy_signals')
    .select('created_at').eq('experiment_id', EXPS[0]).eq('token_address', TOKEN)
    .eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(1);
  if (s0 && s0.length) {
    const buyTs = new Date(s0[0].created_at).getTime();
    console.log(`\n=== 首 BUY 信号 t+${((buyTs - t0) / 1000).toFixed(0)}s（token 首行起算）`);
    let after = rel.filter((r) => new Date(r.block_time).getTime() >= buyTs);
    if (after.length) {
      let maxP = -Infinity, maxPt = null, lastP = null;
      for (const r of after) {
        const p = Number(r.price_bnb);
        if (p > maxP) { maxP = p; maxPt = r.block_time; }
        lastP = p;
      }
      const base = Number(after[0].price_bnb);
      console.log(`买点价=${base.toExponential(4)} vsFloor=${vsPct(base).toFixed(1)}% | 之后 max=${maxP.toExponential(4)}(${(((maxP - base) / base) * 100).toFixed(1)}% @${maxPt}) 尾价=${lastP.toExponential(4)}(${(((lastP - base) / base) * 100).toFixed(1)}%)`);
    }
    // 买点前 120s famous 是否已离场 + 买点前 60s 承接
    const pre120 = rows.filter((r) => { const ts = new Date(r.block_time).getTime(); return ts < buyTs && ts >= buyTs - 120000; });
    const famInPre = pre120.filter((r) => roster.has(((r.sender_address || r.trader_address) || '').toLowerCase()));
    console.log(`买点前120s famous 行=${famInPre.length}（${famInPre.map((r) => `${String(r.trade_type)[0]}${Number(r.bnb_amount).toFixed(2)}`).join(' ') || '-'}）`);
    const pre60 = pre120.filter((r) => new Date(r.block_time).getTime() >= buyTs - 60000);
    let pb = 0, pbn = 0, ps = 0, psn = 0;
    const buyers = new Set();
    for (const r of pre60) {
      const isBuy = String(r.trade_type).toLowerCase() === 'buy';
      if (isBuy) { pb += Number(r.bnb_amount || 0); pbn++; buyers.add(((r.sender_address || r.trader_address) || '').toLowerCase()); }
      else { ps += Number(r.bnb_amount || 0); psn++; }
    }
    console.log(`买点前60s: 买=${pbn}笔/${pb.toFixed(3)}B(${buyers.size}钱包) 卖=${psn}笔/${ps.toFixed(3)}B`);
  }

  // 价格轨迹粗线（每 30s 采样 vsFloor%）
  console.log(`\n=== 价格轨迹（30s 采样, vsFloor=${(launchFloor).toExponential(3)}）`);
  let lastSlot = -1;
  for (const r of rel) {
    const ts = new Date(r.block_time).getTime();
    const slot = Math.floor((ts - t0) / 30000);
    if (slot !== lastSlot) {
      console.log(`  t+${((ts - t0) / 1000).toFixed(0).padStart(5)}s ${vsPct(r.price_bnb).toFixed(1).padStart(7)}%`);
      lastSlot = slot;
    }
  }
  const lastRel = rel[rel.length - 1];
  console.log(`尾行 t+${((new Date(lastRel.block_time).getTime() - t0) / 1000 / 60).toFixed(1)}min ${vsPct(lastRel.price_bnb).toFixed(1)}%`);

  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
