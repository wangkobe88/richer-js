#!/usr/bin/env node
// ============================================================================
// 拱形止损（峰值市值分档回撤卖出）数据分析——基于已平仓实跑实验（182 专用）
//
// 理念（用户 2026-10-06）：新发 meme 币主流形状 = 拱形（低点→峰→归零）。
// 卖出策略契合形状：最高点市值越高 → 允许的回撤幅度越小（利润垫越厚越要锁）。
//
// 量纲口径（flap-usd-bnb-denomination 坑免疫）：全部比值（dd/peakProfit）在
// tick.price_bnb 链内部计算（无量纲）；假想卖出所得 = 剩余持仓 × fire 时 tick 价
// × k，k = 实际卖出所得 / Σ(卖出 token 数 × 卖出时刻 tick 价) —— 成交链与 tick
// 链的量纲换算因子（flap ≈ bnbUsd、fourmeme ≈ 1），自动归一两平台。
//
// 假想口径：事件流 = ticks ∪ 实际 sell trades（时间序）；拱形止损 fire 时把
// 当前持仓按 fire tick 价全清，fire 之前的实际卖出所得保留、之后的不再发生。
//
// 用法：
//   node scripts/analyze-arch-sell.cjs --exp <id>                       # profile 模式
//   node scripts/analyze-arch-sell.cjs --exp <id> --scan                # 阶梯扫描
//   node scripts/analyze-arch-sell.cjs --exp <id> --tiers '[[100000,-15],[50000,-20],[20000,-25],[10000,-30],[0,-45]]'
//   --min-peak-profit 0   # 峰值利润% >= 此值才启用拱形止损（默认 0）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
const argVal = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
const EXP = argVal('--exp');
const SCAN = args.includes('--scan');
const MIN_PEAK_PROFIT = parseFloat(argVal('--min-peak-profit') ?? '0');
let TIERS = null;
{
  const t = argVal('--tiers');
  if (t) TIERS = JSON.parse(t).map(([m, d]) => ({ mcap: m, dd: d })).sort((a, b) => b.mcap - a.mcap);
}

if (!EXP) { console.error('用法: node scripts/analyze-arch-sell.cjs --exp <experiment_id> [--scan] [--tiers JSON] [--min-peak-profit N]'); process.exit(1); }

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  // ── 1. trades（小表直拉）────────────────────────────────────────────
  const trades = [];
  {
    let from = 0;
    for (;;) {
      const { data, error } = await db.from('trades')
        .select('token_address,token_symbol,trade_direction,input_amount,output_amount,executed_at')
        .eq('experiment_id', EXP).order('executed_at', { ascending: true }).range(from, from + 499);
      if (error) throw new Error('trades: ' + error.message);
      trades.push(...(data || []));
      if (!data || data.length < 500) break;
      from += 500;
    }
  }
  const buyTrades = trades.filter(t => t.trade_direction === 'buy');
  const sellTrades = trades.filter(t => t.trade_direction === 'sell');
  const tokenSet = new Set(buyTrades.map(t => t.token_address));
  console.log(`trades=${trades.length} buys=${buyTrades.length} sells=${sellTrades.length} boughtTokens=${tokenSet.size}`);

  // ── 2. totalSupply / platform（experiment_tokens）──────────────────
  const meta = new Map();
  {
    const addrs = [...tokenSet];
    for (let i = 0; i < addrs.length; i += 100) {
      const { data, error } = await db.from('experiment_tokens')
        .select('token_address,token_symbol,platform,raw_api_data')
        .eq('experiment_id', EXP).in('token_address', addrs.slice(i, i + 100));
      if (error) throw new Error('experiment_tokens: ' + error.message);
      for (const r of data || []) {
        meta.set(r.token_address, {
          symbol: r.token_symbol || r.token_address.slice(0, 8),
          platform: r.platform || 'fourmeme',
          totalSupply: Number(r.raw_api_data?.totalSupply) || 0,
        });
      }
    }
    for (const t of buyTrades) if (!meta.has(t.token_address)) meta.set(t.token_address, { symbol: t.token_symbol || t.token_address.slice(0, 8), platform: 'fourmeme', totalSupply: 0 });
  }

  // ── 3. ticks per bought token（id 升序 = 回放序）────────────────────
  const ticksByToken = new Map();
  {
    const addrs = [...tokenSet];
    const COLS = 'id,token_address,block_time,price_bnb,price_usd,price_outlier';
    for (let i = 0; i < addrs.length; i += 100) {
      let from = 0;
      for (;;) {
        const { data, error } = await db.from('wss_price_ticks').select(COLS)
          .in('token_address', addrs.slice(i, i + 100)).order('id', { ascending: true }).range(from, from + 999);
        if (error) throw new Error('ticks: ' + error.message);
        for (const r of data || []) {
          if (!ticksByToken.has(r.token_address)) ticksByToken.set(r.token_address, []);
          ticksByToken.get(r.token_address).push(r);
        }
        if (!data || data.length < 1000) break;
        from += 1000;
      }
    }
  }

  // ── 4. 逐 token 回放（profile / 假想模拟共用）──────────────────────
  // 回放一遍产出「时间轴档案」：逐 tick 的 (ts, priceBnb, mcapUsd) + 实际卖出事件
  // (ts, bnb, tok, tickPriceBnb)。模拟函数在档案上跑任意阶梯（scan 复用免重拉）。
  const archives = [];
  for (const addr of tokenSet) {
    const m = meta.get(addr);
    const ticks = (ticksByToken.get(addr) || []).filter(t => !t.price_outlier && Number(t.price_bnb) > 0);
    const buys = buyTrades.filter(t => t.token_address === addr);
    const sells = sellTrades.filter(t => t.token_address === addr);
    if (!ticks.length || !buys.length) continue;

    const firstBuyMs = new Date(buys[0].executed_at).getTime();
    const totalTok = buys.reduce((s, t) => s + Number(t.output_amount || 0), 0);
    const bnbIn = buys.reduce((s, t) => s + Number(t.input_amount || 0), 0);
    const actualProceeds = sells.reduce((s, t) => s + Number(t.output_amount || 0), 0);

    const events = [];
    for (const t of ticks) {
      const ms = t.block_time ? new Date(t.block_time).getTime() : null;
      if (ms == null || isNaN(ms)) continue;
      events.push({ kind: 'tick', ms, p: Number(t.price_bnb), usd: Number(t.price_usd) });
    }
    for (const s of sells) events.push({ kind: 'sell', ms: new Date(s.executed_at).getTime(), bnb: Number(s.output_amount || 0), tok: Number(s.input_amount || 0) });
    events.sort((a, b) => a.ms - b.ms || (a.kind === 'tick' ? -1 : 1));

    // 量纲换算因子 k = 实际所得 / Σ(卖 token 数 × 卖时 tick 价)（tick 价缺失的卖出不计入分母，k 用其余样本）
    let theo = 0, theoBnb = 0, lastP = null;
    for (const ev of events) {
      if (ev.kind === 'tick') lastP = ev.p;
      else if (lastP != null && ev.tok > 0) { theo += ev.tok * lastP; theoBnb += ev.bnb; }
    }
    const k = theo > 0 ? theoBnb / theo : 1; // ≈1（fourmeme）或 ≈bnbUsd（flap 成交链 USD 数值）

    archives.push({
      addr, symbol: m.symbol, platform: m.platform, totalSupply: m.totalSupply,
      events, firstBuyMs, totalTok, bnbIn, actualProceeds, k,
    });
  }

  // ── 模拟：给定阶梯 + 峰值利润门槛 → { diff, fired, ... } ────────────
  function simulate(arch, tiers, minPeakProfit) {
    const allowedDd = (mcapUsd) => { for (const t of tiers) if (mcapUsd >= t.mcap) return t.dd; return null; };
    let peak = 0, peakMcapUsd = 0, peakProfitPct = 0, buyTickP = null, lastP = null;
    let tok = arch.totalTok, hyp = 0, fired = null, firstSellDd = null, lastSellDd = null, endDd = null;
    let actualKept = 0; // fire 前已落袋的实际卖出
    for (const ev of arch.events) {
      if (ev.ms < arch.firstBuyMs) continue;
      if (ev.kind === 'tick') {
        lastP = ev.p;
        if (buyTickP == null) buyTickP = ev.p; // 首买后首 tick（买入时刻 tick 链成本锚）
        if (ev.p > peak) {
          peak = ev.p;
          peakMcapUsd = ev.usd > 0 && arch.totalSupply > 0 ? ev.usd * arch.totalSupply : 0;
        }
        if (buyTickP > 0) { const pp = (peak - buyTickP) / buyTickP * 100; if (pp > peakProfitPct) peakProfitPct = pp; }
        if (peak > 0) {
          const dd = (ev.p - peak) / peak * 100;
          endDd = dd;
          if (fired == null && peakProfitPct >= minPeakProfit) {
            const allowed = allowedDd(peakMcapUsd);
            if (allowed != null && dd <= allowed) {
              fired = { ms: ev.ms, p: ev.p, dd, ddAllowed: allowed, tierMcap: peakMcapUsd, heldTok: tok, profitPctAtFire: buyTickP > 0 ? (ev.p - buyTickP) / buyTickP * 100 : null };
              hyp += tok * ev.p * arch.k; // 全清（k 量纲换算回成交链 BNB）
              tok = 0;
            }
          }
        }
      } else { // 实际卖出
        if (fired == null) {
          actualKept += ev.bnb; hyp += ev.bnb;
          if (lastP != null && peak > 0) { const dd = (lastP - peak) / peak * 100; if (firstSellDd == null) firstSellDd = dd; lastSellDd = dd; }
        }
      }
    }
    const diff = hyp - arch.actualProceeds;
    return {
      diff, fired, firstSellDd, lastSellDd, endDd, peakMcapUsd, peakProfitPct,
      buyMcapUsd: null, pnlHyp: hyp - arch.bnbIn, pnlActual: arch.actualProceeds - arch.bnbIn,
    };
  }

  // profile：逐 token（不触发，tiers 空 → 只出档案）
  const results = archives.map(a => {
    const r = simulate(a, [], Infinity);
    r.arch = a; return r;
  });
  // buyMcapUsd 单独取（首买后首 tick usd×totalSupply）
  for (const r of results) {
    for (const ev of r.arch.events) {
      if (ev.ms >= r.arch.firstBuyMs && ev.kind === 'tick') { r.buyMcapUsd = ev.usd > 0 && r.arch.totalSupply > 0 ? ev.usd * r.arch.totalSupply : null; break; }
    }
  }

  results.sort((a, b) => a.arch.symbol.localeCompare(b.arch.symbol));
  const fmtK = (v) => v == null ? 'null' : (v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v.toFixed(0));
  const pct = (v) => v == null ? '  null' : (v >= 0 ? '+' : '') + v.toFixed(1);
  console.log(`\n===== PROFILE（${results.length} tokens；dd/peakProf = tick 链比值；实际 PnL = BNB 真值）=====`);
  console.log(['symbol', 'plat', 'addr', 'buyMcap', 'peakMcap', 'peakProf%', '实际首卖dd', '实际末卖dd', '末tick dd', '实际PnL'].join('\t'));
  for (const r of results) {
    console.log([
      r.arch.symbol, r.arch.platform.slice(0, 4), r.arch.addr.slice(0, 10),
      fmtK(r.buyMcapUsd), fmtK(r.peakMcapUsd), pct(r.peakProfitPct),
      pct(r.firstSellDd), pct(r.lastSellDd), pct(r.endDd), r.pnlActual.toFixed(3),
    ].join('\t'));
  }
  const sum = (f) => results.reduce((s, r) => s + (f(r) || 0), 0);
  console.log(`\n实际 ΣPnL=${sum(r => r.pnlActual).toFixed(3)} BNB | tokens=${results.length}`);

  if (TIERS) {
    console.log(`\n===== TIERS ${JSON.stringify(TIERS.map(t => [t.mcap, t.dd]))} minPeakProfit=${MIN_PEAK_PROFIT} =====`);
    let totDiff = 0, fireCnt = 0, fireBefore = 0;
    for (const a of archives) {
      const r = simulate(a, TIERS, MIN_PEAK_PROFIT);
      if (r.fired) { fireCnt++; if (r.firstSellDd == null) fireBefore++; }
      totDiff += r.diff;
      if (Math.abs(r.diff) > 0.0005 || r.fired) {
        console.log(`  ${a.symbol} ${a.addr.slice(0, 10)} peakMcap=${fmtK(r.peakMcapUsd)} peakProf=${pct(r.peakProfitPct)} fire=${r.fired ? `dd${r.fired.dd.toFixed(1)}<=${r.fired.ddAllowed} @prof${pct(r.fired.profitPctAtFire)}` : '-'} diff=${(r.diff >= 0 ? '+' : '') + r.diff.toFixed(3)} (实际${r.pnlActual.toFixed(3)}→假想${r.pnlHyp.toFixed(3)})`);
      }
    }
    console.log(`净效应=${(totDiff >= 0 ? '+' : '') + totDiff.toFixed(3)} BNB | fire ${fireCnt}/${archives.length}（早于实际首卖 ${fireBefore}）`);
  }

  if (SCAN) {
    console.log('\n===== SCAN 阶梯扫描 =====');
    const CANDIDATES = [
      [[200000, -15], [100000, -20], [50000, -25], [20000, -30], [10000, -35], [0, -45]],
      [[200000, -15], [100000, -20], [50000, -25], [20000, -30], [10000, -40], [0, -50]],
      [[100000, -20], [50000, -25], [20000, -30], [0, -40]],
      [[100000, -20], [50000, -25], [20000, -35], [0, -50]],
      [[50000, -25], [20000, -30], [0, -40]],
      [[50000, -20], [20000, -30], [0, -45]],
      [[20000, -25], [0, -40]],
      [[20000, -30], [0, -50]],
      [[100000, -15], [20000, -25], [0, -35]],
      [[50000, -25], [20000, -35], [0, -50]],
      [[100000, -25], [0, -35]],
      [[50000, -30], [0, -45]],
    ];
    for (const cand of CANDIDATES) {
      const tiers = cand.map(([mc, d]) => ({ mcap: mc, dd: d })).sort((a, b) => b.mcap - a.mcap);
      let totDiff = 0, fireCnt = 0, fireBefore = 0;
      for (const a of archives) {
        const r = simulate(a, tiers, MIN_PEAK_PROFIT);
        if (r.fired) { fireCnt++; if (r.firstSellDd == null) fireBefore++; }
        totDiff += r.diff;
      }
      console.log(`tiers=${JSON.stringify(cand)} 净效应=${(totDiff >= 0 ? '+' : '') + totDiff.toFixed(3)} BNB | fire=${fireCnt} (早于首卖 ${fireBefore})`);
    }
  }
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
