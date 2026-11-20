#!/usr/bin/env node
// 临时查证：9b31baf4 + 0x5fb7…7777 「已走过一轮大生命周期的票 burst 放行」案
// 用户裁定方向：涨超一倍+量够=走过一轮大生命周期，不买 burst。查为何没拦。
const { dbManager } = require('../src/services/dbManager');

const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';
const TOKEN = '0x5fb747c626da99bf83b01ac367832de3fb3e7777';
// four.meme 平台常量发行价（T127）
const LAUNCH_CONST = 4496173469e-18;

async function main() {
  const sb = dbManager.getClient();

  const { data: exp, error: e1 } = await sb.from('experiments')
    .select('id,experiment_name,trading_mode,status,config,created_at').eq('id', EXP).limit(1);
  if (e1) throw new Error(e1.message);
  const x = exp && exp[0];
  if (!x) { console.log('experiment not found'); return; }
  const cfg = x.config || {};
  const fm = cfg.fourmemeWs || {};
  console.log(`=== 实验 ${EXP}`);
  console.log(`name=${x.experiment_name} mode=${x.trading_mode} status=${x.status}`);
  const libRefs = (cfg.strategiesConfig && cfg.strategiesConfig.libraryRefs) || [];
  console.log(`libraryRefs=${JSON.stringify(libRefs)}`);
  console.log(`cheatCheck.enabled=${fm.cheatCheck && fm.cheatCheck.enabled} actFrontGate=${JSON.stringify((fm.cheatCheck || {}).actFrontGate || null)}`);
  console.log(`factorCheck.enabled=${fm.buyPointCheck && fm.buyPointCheck.factorCheck && fm.buyPointCheck.factorCheck.enabled} bp.enabled=${fm.buyPointCheck && fm.buyPointCheck.enabled}`);

  // —— 信号（全量，打门链轨迹）
  const { data: sigs, error: e2 } = await sb.from('strategy_signals')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(40);
  if (e2) throw new Error(e2.message);
  console.log(`\n=== 信号 ${sigs.length} 条`);
  for (const s of sigs) {
    const md = s.metadata || {};
    const sg = md.signalGate || {};
    console.log(`\n- [${s.created_at}] type=${s.signal_type} strat=${s.strategy_name || '-'} status=${s.execution_status}`);
    console.log(`  reason=${(s.reason || '').slice(0, 120)}`);
    if (sg.legId || sg.triggerNo) console.log(`  signalGate: leg=${sg.legId} triggerNo=${sg.triggerNo} maxTriggers=${sg.maxTriggers}`);
    const fc = md.factorCheck;
    if (fc) console.log(`  factorCheck: ${fc.status} pass=${fc.pass} code=${fc.reason || fc.code || '-'}`);
    const af = md.actFrontGate;
    if (af) console.log(`  actFront: ${JSON.stringify(af).slice(0, 300)}`);
    const cc = md.cheatCheck;
    if (cc) {
      const info = cc.info || {};
      console.log(`  cheatCheck: grade=${cc.grade || info.grade} status=${cc.status || info.status} cached=${info.cached}`);
      if (cc.levels) console.log(`    levels.act=${cc.levels.activityLevel} sbw=${cc.levels.stallBurstWave}`);
      if (cc.exempt || info.exempt) console.log(`    exempt=${JSON.stringify(cc.exempt || info.exempt)}`);
      if (cc.exemptDenied || info.exemptDenied) console.log(`    exemptDenied=${cc.exemptDenied || info.exemptDenied}`);
    }
    const bp = md.buyPoint;
    if (bp) {
      console.log(`  buyPoint: status=${bp.status} rule=${bp.rule || '-'} ${bp.exempt ? 'exempt=' + JSON.stringify(bp.exempt) : ''}`);
      const d = bp.digest || {};
      if (d.answers) console.log(`    answers=${JSON.stringify(d.answers)}`);
      const q = d.qualities || {};
      if (Object.keys(q).length) console.log(`    qualities=${JSON.stringify(q)}`);
      if (d.buyDerived) {
        const bd = d.buyDerived;
        const keys = ['currentVsLaunchPct', 'athVsLaunchPct', 'minVsLaunchPct', 'launchPriceBnb', 'curVsAthPct', 'chg5Pct', 'chg10Pct', 'totalVolumeBnb', 'buyVolumeBnb', 'tradeCount', 'tokenAgeSec'];
        const o = {};
        for (const k of keys) if (bd[k] !== undefined) o[k] = bd[k];
        console.log(`    buyDerived锚=${JSON.stringify(o)}`);
      }
    }
  }

  // —— 成交
  const { data: trs, error: e4 } = await sb.from('trades')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(40);
  if (e4) throw new Error(e4.message);
  console.log(`\n=== 成交 ${trs.length} 笔`);
  let pnlSum = 0;
  for (const t of trs) {
    const p = t.profit_loss_bnb != null ? t.profit_loss_bnb : (t.metadata && t.metadata.profitLossBnb);
    if (t.trade_type === 'sell' || String(t.trade_type).toLowerCase() === 'sell') pnlSum += Number(p || 0);
    console.log(`- [${t.created_at}] ${t.trade_type} bnb=${t.bnb_amount} price=${t.price_bnb} pnl=${p != null ? p : '-'}`);
  }
  console.log(`累计实现 pnl(卖腿合计)=${pnlSum.toFixed(4)}`);

  // —— ticks 全史生命周期画像
  const { data: ticks, error: e3 } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,trade_type,bnb_amount,price_bnb,sender_address,trader_address,price_outlier')
    .eq('token_address', TOKEN)
    .order('block_time', { ascending: true }).limit(3000);
  if (e3) throw new Error(e3.message);
  console.log(`\n=== ticks 行数=${ticks.length}`);
  if (!ticks.length) return;
  const t0 = new Date(ticks[0].block_time).getTime();
  const tEnd = new Date(ticks[ticks.length - 1].block_time).getTime();
  console.log(`span=${((tEnd - t0) / 60000).toFixed(1)}min 首行=${ticks[0].block_time}`);

  // 可靠价序列
  const rel = ticks.filter((r) => r.price_bnb && Number(r.price_bnb) > 0 && !r.price_outlier);
  let firstRel = rel.length ? Number(rel[0].price_bnb) : null;
  let ath = -Infinity, athTs = null, minAfterAth = Infinity, minAfterAthTs = null;
  let rollingMin = Infinity;
  for (const r of rel) {
    const p = Number(r.price_bnb);
    const ts = new Date(r.block_time).getTime();
    if (p > ath) { ath = p; athTs = ts; minAfterAth = p; minAfterAthTs = ts; }
    else if (p < minAfterAth) { minAfterAth = p; minAfterAthTs = ts; }
    if (p < rollingMin) rollingMin = p;
  }
  const pct = (a, b) => ((a / b - 1) * 100).toFixed(1);
  console.log(`\n首可靠价=${firstRel.toPrecision(6)} (vs常量launch ${pct(firstRel, LAUNCH_CONST)}%)`);
  console.log(`ATH=${ath.toPrecision(6)} @t+${((athTs - t0) / 1000).toFixed(0)}s (vs常量 ${pct(ath, LAUNCH_CONST)}% / vs首价 ${pct(ath, firstRel)}%)`);
  console.log(`ATH后最低=${minAfterAth.toPrecision(6)} @t+${((minAfterAthTs - t0) / 1000).toFixed(0)}s (自ATH ${pct(minAfterAth, ath)}%)`);
  console.log(`全史滚动最低=${rollingMin.toPrecision(6)} (vs常量 ${pct(rollingMin, LAUNCH_CONST)}%)`);

  // 累计流量 + 钱包数
  let buyN = 0, sellN = 0, buyB = 0, sellB = 0;
  const wallets = new Set();
  for (const r of ticks) {
    const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
    if (w) wallets.add(w);
    if (String(r.trade_type).toLowerCase() === 'buy') { buyN++; buyB += Number(r.bnb_amount || 0); }
    else { sellN++; sellB += Number(r.bnb_amount || 0); }
  }
  console.log(`累计 buy=${buyN}/${buyB.toFixed(2)}B sell=${sellN}/${sellB.toFixed(2)}B 独立钱包=${wallets.size}`);

  // 信号时刻画像（每条 BUY 信号）
  const buys = sigs.filter((s) => String(s.signal_type).toUpperCase() === 'BUY');
  for (const s of buys) {
    const ts = new Date(s.created_at).getTime();
    const relBefore = rel.filter((r) => new Date(r.block_time).getTime() <= ts);
    const last = relBefore.length ? Number(relBefore[relBefore.length - 1].price_bnb) : null;
    if (last == null) continue;
    const seg = relBefore.slice(-60);
    let sAth = -Infinity;
    for (const r of seg) sAth = Math.max(sAth, Number(r.price_bnb));
    // 信号时刻的 curVs（常量锚 + 地板锚两种）
    const floor = Math.min(LAUNCH_CONST, firstRel, rollingMin);
    console.log(`\n>> 信号 [${s.created_at}] t+${((ts - t0) / 1000).toFixed(0)}s 现价=${last.toPrecision(6)}`);
    console.log(`   curVs常量=${pct(last, LAUNCH_CONST)}% curVs地板=${pct(last, floor)}% 距ATH=${((ts - athTs) / 1000).toFixed(0)}s 自ATH回落=${pct(last, ath)}%`);
    // 信号前 60s 流量与静默
    let b = 0, sn = 0, bb = 0, sb = 0, lastTickTs = null, maxGap = 0, prevTs = null;
    for (const r of ticks) {
      const rts = new Date(r.block_time).getTime();
      if (rts > ts) break;
      if (rts > ts - 60000) {
        if (String(r.trade_type).toLowerCase() === 'buy') { bb++; b += Number(r.bnb_amount || 0); }
        else { sn++; sb += Number(r.bnb_amount || 0); }
        if (prevTs != null) maxGap = Math.max(maxGap, rts - prevTs);
        prevTs = rts;
      }
      lastTickTs = rts;
    }
    console.log(`   前60s: buy=${bb}/${b.toFixed(2)}B sell=${sn}/${sb.toFixed(2)}B 窗内最大gap=${(maxGap / 1000).toFixed(0)}s`);
    // 信号前 300s 累计量（burst 波量级）
    let b300 = 0, bn300 = 0;
    for (const r of ticks) {
      const rts = new Date(r.block_time).getTime();
      if (rts > ts) break;
      if (rts > ts - 300000 && String(r.trade_type).toLowerCase() === 'buy') { bn300++; b300 += Number(r.bnb_amount || 0); }
    }
    console.log(`   前300s buy=${bn300}/${b300.toFixed(2)}B`);
  }

  // 分桶拱（60s 桶，紧凑）
  console.log(`\n=== 60s 分桶拱（桶内末可靠价 vs 常量launch% + 买卖量B）`);
  const bucket = new Map();
  for (const r of ticks) {
    const rts = new Date(r.block_time).getTime();
    const k = Math.floor((rts - t0) / 60000);
    const o = bucket.get(k) || { b: 0, s: 0, bn: 0, sn: 0, lastP: null, lastTs: 0, hi: -Infinity, lo: Infinity };
    if (String(r.trade_type).toLowerCase() === 'buy') { o.bn++; o.b += Number(r.bnb_amount || 0); }
    else { o.sn++; o.s += Number(r.bnb_amount || 0); }
    if (r.price_bnb && !r.price_outlier) {
      const p = Number(r.price_bnb);
      o.hi = Math.max(o.hi, p); o.lo = Math.min(o.lo, p);
      if (rts >= o.lastTs) { o.lastTs = rts; o.lastP = p; }
    }
    bucket.set(k, o);
  }
  const ks = [...bucket.keys()].sort((a, b) => a - b);
  for (const k of ks) {
    const o = bucket.get(k);
    const vsL = o.lastP ? pct(o.lastP, LAUNCH_CONST) : '-';
    console.log(`  [${String(k * 60).padStart(4)}s~] 末价vsL=${vsL}% hi=${o.hi > -Infinity ? pct(o.hi, LAUNCH_CONST) + '%' : '-'} buy=${o.bn}/${o.b.toFixed(1)}B sell=${o.sn}/${o.s.toFixed(1)}B`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
