#!/usr/bin/env node
// 临时查证：2bdf98ab 实验 0x5731…7777 是否构成 burst（用户疑问：自身活跃度够）
const { dbManager } = require('../src/services/dbManager');

const EXP = '2bdf98ab-d85f-40fa-84b5-d79099e1006c';
const TOKEN = '0x5731879f6d4c2bc1d1d3d7d3370875eaa19c7777';

async function main() {
  const sb = dbManager.getClient();

  const { data: ex } = await sb.from('experiments').select('experiment_name,trading_mode,status,platform').eq('id', EXP).limit(1);
  if (ex && ex[0]) console.log(`exp: ${ex[0].experiment_name} mode=${ex[0].trading_mode} status=${ex[0].status} platform=${ex[0].platform}`);

  // 1) BUY 信号 + 门链判定
  const { data: sigs, error: e1 } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  if (e1) throw new Error(e1.message);
  console.log(`\nsignals=${sigs.length}`);
  for (const s of sigs) {
    const md = s.metadata || {};
    console.log(`\n[${s.created_at}] type=${s.signal_type} status=${s.status} exec=${s.execution_status} strat=${s.strategy_id} px=${s.price}`);
    console.log(`  md keys: ${Object.keys(md).join(',')}`);
    if (s.signal_type === 'SELL' || md.burstCooldownInfo || md.stallClose || md.factorSellFilter) {
      console.log(`  SELL-md(raw): ${JSON.stringify(md).slice(0, 3000)}`);
    }
    if (md.signalGate) console.log(`  signalGate: ${JSON.stringify({ ...md.signalGate, factorResults: undefined }).slice(0, 500)}`);
    if (md.factorCheck) console.log(`  factorCheck: ${JSON.stringify(md.factorCheck).slice(0, 1500)}`);
    if (md.actFrontGate) console.log(`  actFront: ${JSON.stringify(md.actFrontGate).slice(0, 900)}`);
    if (md.cheatCheck) {
      const cc = md.cheatCheck;
      console.log(`  cheat keys: ${Object.keys(cc).join(',').slice(0, 200)}`);
      console.log(`  cheat(raw): ${JSON.stringify(cc).slice(0, 2200)}`);
    }
    if (md.buyPoint) {
      const bp = md.buyPoint;
      console.log(`  bp keys: ${Object.keys(bp).join(',').slice(0, 200)}`);
      console.log(`  bp(raw): ${JSON.stringify(bp).slice(0, 2500)}`);
    }
  }

  // 2) cheat_detection 观测行（先探列名）
  const { data: cds, error: e2 } = await sb.from('cheat_detection')
    .select('*').eq('token_address', TOKEN)
    .order('anchor_at', { ascending: true }).limit(20);
  if (e2) {
    console.log(`cheat_detection err: ${e2.message.slice(0, 200)}`);
  } else {
    console.log(`\ncheat_detection rows=${cds.length}`);
    for (const r of cds) {
      const dig = r.digest || {};
      const lv = dig.levels || {};
      console.log(`\n[cd] verdict=${r.verdict} grade=${r.grade} qv=${r.question_version}`);
      console.log(`  act=${lv.activityLevel} sbw=${lv.stallBurstWave} wash=${lv.washPair} pump=${lv.slowGrindPump}`);
      if (dig.anchors) {
        const a = dig.anchors;
        const pick = {};
        for (const k of ['burstLastGapSec','burstExitWaveBuyBnb','burstExitWaveWallets','burstSecSinceWaveEnd','burstMaxGapSec','burstWaveBuyBnb','burstWaveWallets','burstWaveSegBuyBnb','burstWaveSegSellBnb','burstWaveSegSellPct','spanSec','tickCount','avgTradeBnb','maxGapSec','idlePct']) {
          if (a[k] != null) pick[k] = a[k];
        }
        console.log(`  anchors: ${JSON.stringify(pick).slice(0, 1200)}`);
      }
    }
  }

  // 3) 首信号锚前 20min ticks 概览（密度/静默段/波形状）
  const firstBuy = sigs.find((s) => s.signal_type === 'BUY') || sigs[0];
  const anchor = firstBuy ? new Date(firstBuy.created_at) : new Date();
  const from = new Date(anchor.getTime() - 20 * 60 * 1000).toISOString();
  const to = new Date(anchor.getTime() + 30 * 1000).toISOString();
  const { data: ticks, error: e3 } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,rel_price,sender_address,trader_address,price_outlier')
    .eq('token_address', TOKEN)
    .gte('block_time', from).lte('block_time', to)
    .order('block_time', { ascending: true }).limit(2000);
  if (e3) throw new Error(e3.message);
  console.log(`\n=== ticks ${from.slice(11, 19)} .. ${to.slice(11, 19)} rows=${ticks.length} anchor=${anchor.toISOString().slice(11, 19)}`);
  // 逐 30s 桶汇总：笔数/买额/钱包数/最大 gap
  let bStart = null, bRows = [];
  const flush = () => {
    if (!bRows.length) return;
    let buyB = 0, wallets = new Set(), maxGap = 0, prev = null, buys = 0, sells = 0;
    for (const t of bRows) {
      const bnb = (t.bnb_amount || 0) / 1e18;
      const side = t.trade_type;
      if (side === 'BUY' || side === 'buy') { buyB += bnb; buys++; } else sells++;
      wallets.add((t.sender_address || t.trader_address || '').toLowerCase());
      const ts = new Date(t.block_time).getTime();
      if (prev != null) maxGap = Math.max(maxGap, (ts - prev) / 1000);
      prev = ts;
    }
    console.log(`${new Date(bStart).toISOString().slice(11, 19)}~  n=${bRows.length} buy=${buys}/sell=${sells} buyBnb=${buyB.toFixed(3)} wallets=${wallets.size} maxGap=${maxGap.toFixed(1)}s`);
  };
  for (const t of ticks) {
    const ts = new Date(t.block_time);
    if (bStart == null) bStart = ts;
    if ((ts - bStart) / 1000 >= 30) { flush(); bStart = ts; bRows = []; }
    bRows.push(t);
  }
  flush();

  // 4) 静默段定位：>=30s gap 全列出 + 锚前最密 5s 波
  let prevT = null;
  for (const t of ticks) {
    if (prevT) {
      const gap = (new Date(t.block_time) - prevT) / 1000;
      if (gap >= 25) console.log(`GAP ${gap.toFixed(1)}s: ${prevT.toISOString().slice(11, 19)} -> ${t.block_time.slice(11, 19)} (side=${t.trade_type} bnb=${((t.bnb_amount || 0) / 1e18).toFixed(4)})`);
    }
    prevT = new Date(t.block_time);
  }
  // 锚前 5s 波
  const anchorMs = anchor.getTime();
  let best = null;
  for (let i = 0; i < ticks.length; i++) {
    const tI = new Date(ticks[i].block_time).getTime();
    if (tI > anchorMs) break;
    let j = i, buyB = 0, wallets = new Set();
    while (j < ticks.length && new Date(ticks[j].block_time).getTime() - tI <= 5000) {
      const t = ticks[j];
      if (t.trade_type === 'BUY' || t.trade_type === 'buy') buyB += (t.bnb_amount || 0) / 1e18;
      wallets.add((t.sender_address || t.trader_address || '').toLowerCase());
      j++;
    }
    if (!best || buyB > best.buyB) best = { t0: tI, buyB, wallets: wallets.size };
  }
  if (best) console.log(`\n锚前最密 5s 波: t0=${new Date(best.t0).toISOString().slice(11, 19)} buyBnb=${best.buyB.toFixed(4)} wallets=${best.wallets} 距锚=${((anchorMs - best.t0) / 1000).toFixed(1)}s`);

  // 5) 成交
  const { data: tr } = await sb.from('trades')
    .select('trade_type,amount,price,profit_loss,created_at')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(20);
  if (tr) for (const t of tr) console.log(`trade [${t.created_at}] ${t.trade_type} amt=${t.amount} px=${t.price} pnl=${t.profit_loss}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
