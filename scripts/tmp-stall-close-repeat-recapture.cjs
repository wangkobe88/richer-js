/**
 * 流动性止损（T104 10s 全清）后——再买臂（buy-v2-repeat v3）对二次起飞票的接回面分析
 *
 * 问题：stall-close 提前清仓的票里，事后大涨的（二次起飞形状）能不能被再买臂接回？
 * 再买臂核心门 = drawdownFromHighest ∈ (-70,-40)（从全时最高点跌 40-70% 才可再买，
 * T101/T103）+ 净买双窗 (LongWin>=0 AND ShortWin>=40)（T96）+ 其余门。
 *
 * 复算口径（tick 流近似，与 FA 同源公式）：
 *   - accepted 价轨 = price_outlier=false 行（DB 落库 flag ≈ FA 离群判定）
 *   - ATH = 首行起 accepted 价 running max（FA highestPriceBnb 任意接受价全时峰）
 *   - 净买窗 = 尾 20/100 笔 (Σ买-Σ卖)/Σ买×100（_netBuyWinFactors 逐字口径，BNB 域）
 *   - wallet = sender||trader；holders/top1/top2/holdersExDust 用净持仓近似
 *     （token 量 = bnb_amount/price_bnb；尘门 0.015 BNB @ 首可靠价）
 *   - marketCap = price_bnb × totalSupply（wss_events token_create payload；缺=1e9）
 *   - 不复算：holderTrendSlope / crashSpeedPctPerSec / roster 门 / 叙事评级
 *     （评级门：首买经评级臂（rating 2|3）成交=token 级缓存 PASS 近似；momentum
 *     臂（rating==1）成交的票再买臂永远进不去——v61 起才有，样本内大票无此形状）
 * 观察窗口：清仓点后 +2h（再买臂无年龄上限，tradeCount>=25 恒真）。
 */
const { dbManager } = require('../src/services/dbManager.js');

const STALL_MS = 10000;
const DAYS = 8;
const TAIL_MS = 2 * 3600 * 1000;
const MAX_TICK_ROWS = 80000;
const BNB_LIKE = new Set(['BNB', 'WBNB', 'WNB']);
const DUST_BNB = 0.015;
const POST_UPSIDE_MIN = 30; // 只深挖「触发后再涨 >=30%」的二次起飞形状

const num = (v) => (v === null || v === undefined ? null : Number(v));
const ts = (s) => new Date(s).getTime();

(async () => {
  const db = await dbManager.getClient();
  const cutoff = new Date(Date.now() - DAYS * 86400e3).toISOString();

  const exps = await db.from('experiments').select('id,config,created_at').gte('created_at', cutoff);
  const expName = new Map(exps.data.map(e => {
    let n = ''; try { n = (typeof e.config === 'string' ? JSON.parse(e.config) : e.config)?.name || ''; } catch (_) {}
    return [e.id, n];
  }));

  const tradesRes = await db.from('trades')
    .select('experiment_id,token_address,token_symbol,trade_direction,input_currency,output_currency,input_amount,output_amount,created_at')
    .gte('created_at', cutoff).eq('success', true).order('created_at');
  const trades = tradesRes.data || [];

  // round 重建（同 tmp-stall10s-close-analysis）
  const groups = new Map();
  for (const t of trades) {
    const key = t.experiment_id + '|' + t.token_address;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const rounds = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => ts(a.created_at) - ts(b.created_at));
    let cur = null;
    for (const t of list) {
      const buy = t.trade_direction === 'buy';
      if (!BNB_LIKE.has(buy ? t.input_currency : t.output_currency)) continue;
      const bnb = num(buy ? t.input_amount : t.output_amount);
      const tok = num(buy ? t.output_amount : t.input_amount);
      if (bnb === null || tok === null || !(bnb > 0) || !(tok > 0)) continue;
      const tms = ts(t.created_at);
      if (buy) {
        if (!cur || cur.qty <= 1e-12) { if (cur) rounds.push(cur); cur = null; }
        if (!cur) cur = { exp: t.experiment_id, token: t.token_address, symbol: t.token_symbol, qty: 0, cost: 0, proceeds: 0, events: [] };
        cur.qty += tok; cur.cost += bnb;
        cur.events.push({ t: tms, dir: 'buy', bnb, tok });
      } else if (cur && cur.qty > 1e-12) {
        cur.qty -= Math.min(tok, cur.qty); cur.proceeds += bnb;
        cur.events.push({ t: tms, dir: 'sell', bnb, tok: Math.min(tok, cur.qty) });
      }
    }
    if (cur) rounds.push(cur);
  }

  // token_create totalSupply 缓存
  const supplyCache = new Map();
  async function totalSupplyOf(addr) {
    if (supplyCache.has(addr)) return supplyCache.get(addr);
    let s = 1e9;
    try {
      const r = await db.from('wss_events').select('payload,platform')
        .eq('kind', 'token_create').eq('token_address', addr).limit(1);
      const p = r.data && r.data[0] && r.data[0].payload;
      const v = num(p && p.totalSupply);
      if (v && v > 0) s = v;
    } catch (_) {}
    supplyCache.set(addr, s);
    return s;
  }

  const out = [];
  for (const r of rounds) {
    const t0 = r.events[0].t;
    const winEnd = r.events[r.events.length - 1].t + TAIL_MS;
    const ticks = [];
    let cursorId = 0;
    for (;;) {
      const res = await db.from('wss_price_ticks')
        .select('id,block_time,price_bnb,bnb_amount,price_outlier,trade_type,sender_address,trader_address')
        .eq('token_address', r.token).gt('id', cursorId)
        .gte('block_time', new Date(t0 - 120e3).toISOString())
        .lte('block_time', new Date(winEnd).toISOString())
        .order('id', { ascending: true }).range(0, 999);
      if (res.error) throw new Error('ticks: ' + res.error.message);
      for (const row of res.data || []) {
        ticks.push({
          t: ts(row.block_time), p: num(row.price_bnb), out: !!row.price_outlier,
          bnb: num(row.bnb_amount), buy: row.trade_type === 'buy', id: row.id,
          w: ((row.sender_address || row.trader_address) || '').toLowerCase(),
        });
      }
      if (!res.data || res.data.length < 1000) break;
      cursorId = res.data[res.data.length - 1].id;
      if (ticks.length >= MAX_TICK_ROWS) break;
    }
    ticks.sort((a, b) => a.t - b.t || a.id - b.id);
    if (ticks.length < 2) continue;

    // stall 触发点（同前版口径）
    let prevIdx = -1;
    for (let i = 0; i < ticks.length; i++) { if (ticks[i].t <= t0) prevIdx = i; else break; }
    if (prevIdx === -1) continue;
    let trigger = null;
    if (t0 - ticks[prevIdx].t >= STALL_MS) {
      trigger = { at: t0, price: null, immediate: true };
    } else {
      for (let i = prevIdx + 1; i < ticks.length; i++) {
        if (ticks[i].t - ticks[i - 1].t > STALL_MS) {
          const at = ticks[i - 1].t + STALL_MS;
          if (at <= r.events[r.events.length - 1].t) {
            let px = null;
            for (let j = i - 1; j >= 0; j--) { if (ticks[j].p != null && ticks[j].p > 0 && !ticks[j].out) { px = ticks[j].p; break; } }
            trigger = { at, price: px, immediate: false };
          }
          break;
        }
      }
    }
    if (!trigger) continue; // 未触发的 round 与再买接回无关

    const exitPx = trigger.immediate
      ? r.cost / r.events.filter(e => e.dir === 'buy').reduce((s, e) => s + e.tok, 0)
      : trigger.price;
    if (exitPx == null) continue;

    // 触发后再涨空间（+2h 内 accepted 最高价）
    let postPeak = 0;
    for (const q of ticks) if (!q.out && q.p > 0 && q.t > trigger.at && q.t <= trigger.at + TAIL_MS) postPeak = Math.max(postPeak, q.p);
    const postUpside = postPeak > 0 ? (postPeak / exitPx - 1) * 100 : null;
    if (postUpside == null || postUpside < POST_UPSIDE_MIN) continue; // 只看二次起飞形状

    // ── 再买臂接回模拟：从清仓点起逐步推进 ──
    const supply = await totalSupplyOf(r.token);
    let ath = 0, firstPx = 0;
    const netTok = new Map();       // wallet → 净 token
    const buyBnbAll = [];
    const accepted = [];
    let bandTick = null;            // 首个落腰斩区间的 tick
    let bandNetbuyTick = null;      // 首个 腰斩区间 ∧ 净买双窗过 的 tick（=可接回点）
    let netbuyEverPassInBand = false;

    for (let i = 0; i < ticks.length; i++) {
      const q = ticks[i];
      // 净买窗原料（全部行照计，含 outlier——FA 流量口径）
      if (q.bnb != null && q.bnb > 0) buyBnbAll.push(q.buy ? q.bnb : -q.bnb);
      if (q.w) {
        const tok = q.p > 0 ? q.bnb / q.p : 0;
        netTok.set(q.w, (netTok.get(q.w) || 0) + (q.buy ? tok : -tok));
      }
      if (q.out || q.p == null || q.p <= 0) continue;
      accepted.push(q);
      if (!firstPx) firstPx = q.p;
      if (q.p > ath) ath = q.p;
      if (ath <= 0 || q.t <= trigger.at) continue;

      const dd = (q.p - ath) / ath * 100;
      if (!(dd > -70 && dd < -40)) continue;
      if (!bandTick) bandTick = { t: q.t, p: q.p, dd };
      // 净买双窗（尾 20/100 笔，_netBuyWinFactors 逐字口径）
      const n = buyBnbAll.length;
      let wb = 0, sb = 0;
      for (let j = Math.max(0, n - 20); j < n; j++) { const v = buyBnbAll[j]; if (v > 0) wb += v; else sb -= v; }
      let lb = 0, ls = 0;
      for (let j = Math.max(0, n - 100); j < n; j++) { const v = buyBnbAll[j]; if (v > 0) lb += v; else ls -= v; }
      const shortWin = wb > 0 ? (wb - sb) / wb * 100 : -100;
      const longWin = lb > 0 ? (lb - ls) / lb * 100 : -100;
      const netbuyPass = longWin >= 0 && shortWin >= 40;
      if (netbuyPass) {
        netbuyEverPassInBand = true;
        if (!bandNetbuyTick) {
          // 其余近似门：mcap 带宽 / 人气 / 集中度 / buyVolume
          const mcapBnb = q.p * supply;
          let pos = 0, m1 = 0, m2 = 0;
          const vals = [...netTok.values()].sort((a, b) => b - a);
          for (const v of vals) if (v > 0) { pos += v; }
          m1 = vals[0] || 0; m2 = ((vals[0] || 0) + (vals[1] || 0));
          const circ = Math.max(pos, pos); // Σ正净持仓近似
          let exDust = 0;
          for (const v of vals) if (v > 0 && v * firstPx >= DUST_BNB) exDust++;
          const g = {
            mcap: mcapBnb > 4.7 && mcapBnb < 27,
            buyVolume: lb + ls >= 1.25, // 长窗买量近似全史 buyVolume（大票恒过）
            holdersExDust: exDust >= 10,
            top1: circ > 0 && m1 / circ * 100 < 35,
            top2: circ > 0 && m2 / circ * 100 < 55,
          };
          bandNetbuyTick = { t: q.t, p: q.p, dd, shortWin: +shortWin.toFixed(1), longWin: +longWin.toFixed(1), gates: g };
        }
      }
    }

    // 接回点后的可捕上行（+2h accepted 峰）
    let rePeak = 0;
    if (bandNetbuyTick) {
      for (const q of accepted) if (q.t > bandNetbuyTick.t && q.t <= bandNetbuyTick.t + TAIL_MS) rePeak = Math.max(rePeak, q.p);
    }
    out.push({
      symbol: r.symbol, exp: expName.get(r.exp) || r.exp.slice(0, 8), token: r.token,
      postUpside, exitPx,
      band: bandTick ? { afterExitSec: +((bandTick.t - trigger.at) / 1000).toFixed(0), dd: +bandTick.dd.toFixed(1) } : null,
      reEnter: bandNetbuyTick ? {
        afterExitSec: +((bandNetbuyTick.t - trigger.at) / 1000).toFixed(0),
        dd: +bandNetbuyTick.dd.toFixed(1), shortWin: bandNetbuyTick.shortWin, longWin: bandNetbuyTick.longWin,
        gates: bandNetbuyTick.gates,
        upsidePct: rePeak > 0 ? +((rePeak / bandNetbuyTick.p - 1) * 100).toFixed(0) : null,
      } : null,
      netbuyEverPassInBand,
    });
  }

  console.log(`\n===== stall-close 触发且事后再涨 >=${POST_UPSIDE_MIN}% 的 round：${out.length} 个 =====`);
  const reenter = out.filter(o => o.reEnter);
  const bandOnly = out.filter(o => o.band && !o.reEnter);
  const noBand = out.filter(o => !o.band);
  console.log(`可接回（腰斩区间+净买双窗+近似门全过）: ${reenter.length}`);
  console.log(`落过腰斩区间但净买双窗从未过: ${bandOnly.length}`);
  console.log(`清仓后从未跌进 (-70,-40) 区间: ${noBand.length}`);
  if (reenter.length) {
    const ups = reenter.map(o => o.reEnter.upsidePct).filter(v => v != null).sort((a, b) => a - b);
    console.log(`接回点后 +2h 上行: p25=${ups[Math.floor(0.25 * ups.length)]}% p50=${ups[Math.floor(0.5 * ups.length)]}% p75=${ups[Math.floor(0.75 * ups.length)]}%`);
  }
  console.log('\n--- 明细 ---');
  for (const o of out.sort((a, b) => b.postUpside - a.postUpside)) {
    const g = o.reEnter ? Object.entries(o.reEnter.gates).filter(([, v]) => !v).map(([k]) => k) : [];
    console.log(`${o.symbol} [${o.exp}] 触发后再涨+${o.postUpside.toFixed(0)}% → ` +
      (o.reEnter
        ? `可接回（清仓后 ${o.reEnter.afterExitSec}s @dd ${o.reEnter.dd}% S/L=${o.reEnter.shortWin}/${o.reEnter.longWin}${g.length ? ' 但近似门拦:' + g.join(',') : ''}）接回后上行 ${o.reEnter.upsidePct != null ? '+' + o.reEnter.upsidePct + '%' : '?'}`
        : o.band
          ? `落腰斩区间但净买双窗未过（首个 dd ${o.band.dd}% @清仓后 ${o.band.afterExitSec}s）`
          : `从未跌进腰斩区间（V 型直接走/跌穿 -70 不回头）`));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
