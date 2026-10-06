#!/usr/bin/env node
// ============================================================================
// 拱形止损参数扫描 v2（2026-10-06 用户二轮指令；阶段 2 扩矩阵版）
//
// 与 v1（analyze-arch-sell.cjs）的本质区别：基准集合 = 配对回测 R0 的 109 票
// （非实跑 31 票）——v1 在实跑票上 +3.966 与回测 -2.813 反向的教训：分析集合
// 必须与决策基准一致。R0 买入集合/时刻/数量 = R1 完全配对（已验证），在 R0
// 买入上模拟拱形假想 fire、保留 fire 前实际卖出、fire 后作废 → 差分即净效应。
//
// 快跌门（用户：「快跌不能卖（短线回调），快跌之后一般来讲会跟着一波回升」）：
//   speed = crashSpeedPctPerSec 口径重算（FA 同源）：10s 窗可靠价自窗内高点
//   下跌速度 %/s；现价收复窗内高点（ddW>=0）→ null。门语义：
//   speed > -X（慢跌/阴跌）或 speed IS NULL（已收复=回升中）→ 允许卖；
//   快跌中（speed <= -X）→ 不卖，等回升后同 dd 仍触发时在反弹位卖出。
//
// A5 冷盘快跑（cycle 机制去除后活跃度作参数）：cycleTps30s < 门 且 dd <= 阈值
//   → 全清。tps 同源重算（FA _cycleFactors/_slideTicks）：30s 窗【未过滤】tick
//   密度（FA _slideTicks 不滤尘门——档案可靠 ticks 是滤后的，须另存全量时间戳）；
//   分母 min(存活, 30s)，存活锚用 token 首 tick 近似 createdAt（watcher 自创建
//   起采，首 tick ≈ 创建 + 数秒；仅 <30s 新票有影响）。
//
// 输出（默认全矩阵；--tiers/--act 单跑）：
//   ① 校验档：现役参数无门 → 对照 R1/R0 回测真值 -2.8130（|偏差|>=0.3 模拟器作废）
//   ② A1 独立形状扫（peakProfit 60/100/150 × dd -8/-12/-15 × gate）——脱离 tier 阶梯
//   ③ 主矩阵（peak 门 5/10/20 × LADDERS 9 档 × gate [0.5,1,2,3,∞]）
//   ④ A5 冷盘快跑扫（tps 门 [0.04,0.08,0.15] × dd [-10,-15,-20]，独立腿）
//   ⑤ 裸奔诊断（从未武装 armPeak<10% 票清单 + 净额——A6 是否立档的依据）
//   ⑥ A6 裸奔兜底扫（bareOnly：仅从未武装票假想 fire，peak 门=0；dd × tps 矩阵）
//
// ★口径警示：sim 保留 fire 前 R0 全部实际卖出（含 R2 已弃用的分段卖）→ R2 在
//   fire 点持仓更大，矩阵与 R2 有系统性口径差。矩阵只选参数方向，R2 配对回测
//   才是决策门，两步不可合并。
//
// 用法（182）：
//   node scripts/analyze-arch-sell-v2.cjs                                  # 校验+全矩阵
//   node scripts/analyze-arch-sell-v2.cjs --tiers '[[0,-40]]' --speed-gate 2
//   node scripts/analyze-arch-sell-v2.cjs --act '[0.08,-15]'               # 单跑 A5 形状
//   node scripts/analyze-arch-sell-v2.cjs --bare-only --min-peak-profit 0 --tiers '[[0,-30]]'
//     # 单跑 A6 形状（仅从未武装票；--bare-only 独立用也可——其余票 nofire）
//   node scripts/analyze-arch-sell-v2.cjs --trace-r1 2ff8adeb-6feb-4310-b6d5-70a81a92dd99
//     # 校验档后对拍 R1 真实拱形 fire（sim fire 时机 vs R1 成交 Δt / est vs actual proceeds）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
const argVal = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
const EXP = argVal('--exp') || '57fde778-7a0d-424f-8c5d-fd5f7b7e2fc3'; // R0 基线臂
const SPEED_GATE = parseFloat(argVal('--speed-gate') ?? 'Infinity');   // %/s，Infinity=无门
const MIN_PEAK_PROFIT = parseFloat(argVal('--min-peak-profit') ?? '10');
let TIERS = null;
{
  const t = argVal('--tiers');
  if (t) TIERS = JSON.parse(t).map(([m, d]) => ({ mcap: m, dd: d })).sort((a, b) => b.mcap - a.mcap);
}
let ACT = null; // A5 单跑：[tpsGate, dd]
{
  const t = argVal('--act');
  if (t) { const [g, d] = JSON.parse(t); ACT = { tps: g, dd: d }; }
}
const TRACE_R1 = argVal('--trace-r1'); // 校验档后对拍 R1 真实拱形 fire（est vs actual proceeds/timing）
const BARE_ONLY = args.includes('--bare-only'); // A6 裸奔兜底：仅「从未武装」（armPeak<10%）票允许 fire
const RELIABLE_MIN_BNB = 0.002;  // FA minPriceUpdateBnb 同源（crashSpeed 可靠价链尘门）
const SPEED_WIN_MS = 10 * 1000;  // FA crashSpeedWindowMs 同源
const SPEED_MIN_DT_S = 3;        // FA crashSpeedMinDtMs 同源
const SLIDE_WIN_MS = 30 * 1000;  // FA slideWinMs 同源（A5 tps 窗）
const ARM_MIN_PEAK = 10;         // 武装门（裸奔诊断口径）

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  // ── 1. 基准实验 trades（买入集合 + 实际卖出基准）──────────────────
  const trades = [];
  {
    let from = 0;
    for (;;) {
      // ★created_at=回放事件时间（回测引擎写入），executed_at=进程墙钟（10-06 跑批时刻，
      //   拿它当 firstBuyMs 会把全部 tick 过滤掉——首跑 109/109 全灭的根因）
      const { data, error } = await db.from('trades')
        .select('token_address,token_symbol,trade_direction,input_amount,output_amount,executed_at,created_at')
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
  const actualNet = sellTrades.reduce((s, t) => s + Number(t.output_amount || 0), 0)
    - buyTrades.reduce((s, t) => s + Number(t.input_amount || 0), 0);
  console.log(`基准 ${EXP.slice(0, 8)}: trades=${trades.length} boughtTokens=${tokenSet.size} 实际净额=${actualNet.toFixed(4)}`);

  // ── 2. totalSupply（experiment_tokens → wss_events token_create 兜底）──
  const meta = new Map();
  {
    const addrs = [...tokenSet];
    for (let i = 0; i < addrs.length; i += 100) {
      const { data, error } = await db.from('experiment_tokens')
        .select('token_address,token_symbol,platform,raw_api_data')
        .eq('experiment_id', EXP).in('token_address', addrs.slice(i, i + 100));
      if (error) throw new Error('experiment_tokens: ' + error.message);
      for (const r of data || []) {
        const ts = Number(r.raw_api_data?.totalSupply) || 0;
        if (ts > 0) meta.set(r.token_address, { symbol: r.token_symbol || r.token_address.slice(0, 8), platform: r.platform || 'fourmeme', totalSupply: ts });
      }
    }
    const missing = [...tokenSet].filter(a => !meta.has(a));
    for (let i = 0; i < missing.length; i += 100) {
      const { data, error } = await db.from('wss_events')
        .select('token_address,payload').eq('kind', 'token_create')
        .in('token_address', missing.slice(i, i + 100));
      if (error) throw new Error('wss_events: ' + error.message);
      for (const r of data || []) {
        if (meta.has(r.token_address)) continue;
        const ts = Number(r.payload?.totalSupply) || 0;
        if (ts > 0) meta.set(r.token_address, { symbol: r.token_address.slice(0, 8), platform: r.payload?.platform || 'fourmeme', totalSupply: ts });
      }
    }
    for (const a of tokenSet) if (!meta.has(a)) meta.set(a, { symbol: a.slice(0, 8), platform: 'fourmeme', totalSupply: 0 });
  }

  // ── 3. ticks per bought token（id 升序 = 回放序；30/批防 statement timeout）──
  const ticksByToken = new Map();
  {
    const addrs = [...tokenSet];
    const COLS = 'id,token_address,block_time,price_bnb,price_usd,bnb_amount,price_outlier';
    for (let i = 0; i < addrs.length; i += 30) {
      let from = 0;
      for (;;) {
        const { data, error } = await db.from('wss_price_ticks').select(COLS)
          .in('token_address', addrs.slice(i, i + 30)).order('id', { ascending: true }).range(from, from + 999);
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

  // ── 4. 档案构建（回放序事件流：id 序 tick + 定位插入的 trade；allMs 全量 tick 供 A5 tps）──
  const archives = [];
  let tailTrades = 0; // 落在末 tick 窗口之外的 trade 数（截窗/数据缺；理想 0——间隙定位本身不再计入）
  for (const addr of tokenSet) {
    const m = meta.get(addr);
    const rawTicks = ticksByToken.get(addr) || [];
    // ★拱形链 = 任意接受价（FA pos.highestSinceBuy/currentPriceBnb 仅滤离群，不滤尘门——
    //   dd/peakMcap 分子分母全在此链）；crashSpeed/peakProfit 才是可靠价链（rel 标记区分）
    const ticks = rawTicks
      .filter(t => !t.price_outlier && Number(t.price_bnb) > 0);
    const buys = buyTrades.filter(t => t.token_address === addr);
    const sells = sellTrades.filter(t => t.token_address === addr);
    if (!ticks.length || !buys.length) continue;
    const firstBuyMs = new Date(buys[0].created_at).getTime();
    // 【run3 事故根因】buyUnit=input/output 是 trades 成交口径（USD，比 BNB 价链大 ~700×
    //   =BNB/USD 汇率）——只留作诊断，永不作锚。
    const b0 = buys[0];
    const buyUnit = (Number(b0.input_amount) > 0 && Number(b0.output_amount) > 0)
      ? Number(b0.input_amount) / Number(b0.output_amount) : null;
    // ★run5 回放序修正（run4 校验档偏差 4.51 根因）：引擎回放按 tick id 升序，而
    //   block_time 因 watcher 双写者竞态可回跳 2-4s（币安世界 0xcc722b1e 实锤：R1 拱形
    //   卖 created_at 比买入早 2s——引擎序「先峰（id 前的晚块 tick）后谷（id 后的早块
    //   tick）」的深 dd 在按 ms 排序的时间序里不存在）。→ evs 按 id 序推进（不排序）；
    //   trade 事件插在首个同 ms tick 之后（trades.created_at = 触发 tick block_time，
    //   同 ms 多 tick 位置误差毫秒级；未精确匹配尾插兜底）；买入锚 = buy ev 紧邻前一
    //   tick 价（= FA setBuyState 的 currentPriceBnb 口径），每笔买入重置锚/峰
    //   （FA 每笔买入覆写 pos：peakProfitPct 归零、峰自新买价重爬）。
    const evs = [];
    {
      // ★run6 定位算法：run5 同 ms 精确匹配 94/382 笔失败尾插（去抖窗到期 fire 落在
      //   tick 间隙 / outlier tick 触发的评估不在接受价集）→ 尾插流末锚全错。改为二分
      //   定位「最后一个 ms <= tradeMs 的已接受 tick」插入其后——评估时刻的 FA 状态
      //   ≈ 前一 tick 处理完的状态，精确同 ms 匹配是其特例。
      const tickMs = [];
      for (const t of ticks) {
        const ms = t.block_time ? new Date(t.block_time).getTime() : null;
        if (ms == null || isNaN(ms)) continue;
        evs.push({ kind: 'tick', ms, p: Number(t.price_bnb), usd: Number(t.price_usd), rel: Number(t.bnb_amount) >= RELIABLE_MIN_BNB });
        tickMs.push(ms);
      }
      const items = [];
      {
        let i = 0;
        for (const b of buys) items.push({ kind: 'buy', ms: new Date(b.created_at).getTime(), _i: i++ });
        for (const s of sells) items.push({ kind: 'sell', ms: new Date(s.created_at).getTime(), bnb: Number(s.output_amount || 0), tok: Number(s.input_amount || 0), _i: i++ });
        items.sort((a, b) => (a.ms - b.ms) || (a._i - b._i));
      }
      const insertAfter = new Map(); // tick 下标 → 该位置后的 trade 序列（-1 = 首个 tick 前）
      for (const it of items) {
        if (!isFinite(it.ms)) { tailTrades++; continue; }
        let lo = 0, hi = tickMs.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (tickMs[mid] <= it.ms) lo = mid + 1; else hi = mid; }
        const idx = lo - 1;
        if (idx === tickMs.length - 1 && it.ms > tickMs[tickMs.length - 1]) tailTrades++; // 超末 tick 窗口（截窗/数据缺）
        if (!insertAfter.has(idx)) insertAfter.set(idx, []);
        insertAfter.get(idx).push(it);
      }
      const out = [];
      for (let i = 0; i < evs.length; i++) {
        out.push(evs[i]);
        const q = insertAfter.get(i);
        if (q) out.push(...q);
      }
      const head = insertAfter.get(-1);
      if (head) out.unshift(...head);
      evs.length = 0; evs.push(...out);
      let last = null;
      for (const ev of evs) {
        if (ev.kind === 'buy') { ev.anchorP = last ? last.p : null; ev.anchorUsd = last ? last.usd : 0; }
        else if (ev.kind === 'tick') last = ev;
      }
    }
    const firstBuy = evs.find(e => e.kind === 'buy') || null;
    const buyPFa = firstBuy ? firstBuy.anchorP : null;
    const buyPUsd = firstBuy ? firstBuy.anchorUsd : 0;
    const totalTok = buys.reduce((s, t) => s + Number(t.output_amount || 0), 0);
    const bnbIn = buys.reduce((s, t) => s + Number(t.input_amount || 0), 0);
    const actualProceeds = sells.reduce((s, t) => s + Number(t.output_amount || 0), 0);
    // A5 tps 原料：全量 tick 时间戳（未过滤——FA _slideTicks 不滤尘门/离群）
    const allMs = rawTicks
      .map(t => (t.block_time ? new Date(t.block_time).getTime() : NaN))
      .filter(x => !isNaN(x)).sort((a, b) => a - b);
    // 量纲换算因子 k（flap 成交链 USD → BNB；est 兜底用——est 首选 fire tick usd 直估）
    let theo = 0, theoBnb = 0, lastP = null;
    for (const ev of evs) {
      if (ev.kind === 'tick') lastP = ev.p;
      else if (lastP != null && ev.tok > 0) { theo += ev.tok * lastP; theoBnb += ev.bnb; }
    }
    archives.push({
      addr, symbol: m.symbol, totalSupply: m.totalSupply, evs, allMs, buyUnit, buyPFa, buyPUsd,
      firstMs: allMs.length ? allMs[0] : firstBuyMs,
      firstBuyMs, totalTok, bnbIn, actualProceeds,
      k: theo > 0 ? theoBnb / theo : 1,
    });
  }
  const tsZero = archives.filter(a => !a.totalSupply).length;
  console.log(`档案 ${archives.length} 票（totalSupply=0: ${tsZero}——peakMcap 恒 0 = FA null 口径等价，走兜底档；尾插 trade: ${tailTrades}）`);

  // ── 4.5 armPeak 预计算：全程「曾达最高峰利润 %」（每笔买入重置后重爬，取全程最大；
  //   与引擎 peakProfitPct 同源——pos 级 running max，setBuyState 归零。<ARM_MIN_PEAK = 从未武装）
  for (const a of archives) {
    let buyP = null, relPeak = 0, armPeak = 0, bought = false;
    for (const ev of a.evs) {
      if (ev.kind === 'buy') { buyP = ev.anchorP; relPeak = 0; bought = true; continue; }
      if (!bought || ev.kind !== 'tick') continue;
      if (ev.rel && ev.p > relPeak) relPeak = ev.p;
      if (buyP > 0 && relPeak > 0) { const pp = (relPeak - buyP) / buyP * 100; if (pp > armPeak) armPeak = pp; }
    }
    a.armPeak = armPeak;
  }

  // ── 5. A5 tps 同源重算（FA _cycleFactors：30s 窗全量 tick 密度，分母 min(存活,30s)）──
  function tpsAt(arch, ms) {
    const a = arch.allMs;
    let lo = 0, hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= ms - SLIDE_WIN_MS) lo = mid + 1; else hi = mid; }
    const first = lo;
    lo = first; hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= ms) lo = mid + 1; else hi = mid; }
    const cnt = lo - first;
    const ageMs = ms - arch.firstMs;
    const denomMs = ageMs < SLIDE_WIN_MS ? Math.max(ageMs, 1000) : SLIDE_WIN_MS;
    return cnt / (denomMs / 1000);
  }

  // ── 6. 模拟（tier 阶梯 + 快跌门 + 可选 A5 activity 腿；单 fire 全清）──
  // ★三链分离（FA 真实口径，保真度核心）：
  //   peak/dd/peakMcap → 任意接受价链（pos.highestPriceSinceBuyBnb/currentPriceBnb，仅滤离群）
  //   peakProfitPct    → 可靠价链（_buildFactorMap 用 state._relPriceBnb 推进，尘 tick 不进）
  //   crashSpeed       → 可靠价 10s 窗（含当前 tick——FA _recentTicks.push 先于读取）+ 现价=最近可靠价
  function simulate(arch, cfg) {
    // cfg: { tiers, minPeakProfit, speedGate, actTps?, actDd?, bareOnly? }
    const { tiers, minPeakProfit, speedGate, actTps = null, actDd = 0, bareOnly = false } = cfg;
    // A6 裸奔兜底 gate：仅「全程从未武装」（armPeak < ARM_MIN_PEAK）的票允许假想 fire
    const archAllowsFire = !bareOnly || arch.armPeak < ARM_MIN_PEAK;
    const allowedDd = (mcapUsd) => { for (const t of tiers) if (mcapUsd >= t.mcap) return t.dd; return null; };
    // run5 回放序口径：evs 即引擎回放序（tick id 升序）。锚/峰在每笔 buy ev 处重置
    // （FA setBuyState 覆写 pos：highestSinceBuy = max(buyP, currentPrice)=买价本身、
    //  peakProfitPct 归零自新买价重爬）；首笔 buy 之前的 tick 不进价链（引擎侧 pos 尚
    // 不存在）。peakMcap 对齐 FA 读取时刻语义 = peak × totalSupply × lastFx（当前 tick
    // 隐含汇率——峰 tick 缺 usd 不再归零，FA lastImpliedBnbUsd 同源）；est 首选 fire
    // tick usd 直估（镜像 BacktestEngine 成交 output = tok × signal.price = tok × p_bnb
    // × 触发 tick 汇率），usd 缺失回退 p×k。
    let buyP = null, peak = 0, peakMcapUsd = 0, lastFx = 0;
    let relPeak = 0, peakProfitPct = 0;
    let tok = arch.totalTok, hyp = 0, fired = null, heldAtFire = 0;
    let bought = false;
    const rel = []; // 10s 可靠价窗 {ms, p}（FA _recentTicks 回放序写入、ts 窗过滤——乱序 tick ts 早仍在窗内）
    let lastRelP = null;
    for (const ev of arch.evs) {
      if (ev.kind === 'buy') {
        bought = true;
        buyP = ev.anchorP; peak = buyP > 0 ? buyP : 0;
        relPeak = 0; peakProfitPct = 0;
        if (ev.anchorUsd > 0 && buyP > 0) lastFx = ev.anchorUsd / buyP;
        peakMcapUsd = (peak > 0 && arch.totalSupply > 0 && lastFx > 0) ? peak * arch.totalSupply * lastFx : 0;
        continue;
      }
      const isTick = ev.kind === 'tick';
      const p = isTick ? ev.p : 0, ms = ev.ms;
      // ── token 级链（FA state 与 pos 无关，买前 tick 也推进）：汇率 + crashSpeed 可靠价窗
      //   （FA _recentTicks 买前 tick 同样入窗——买前高点可作窗内高点 wh，不可丢）
      if (isTick) {
        if (p > 0 && ev.usd > 0) lastFx = ev.usd / p;
        if (ev.rel) { rel.push({ ms, p }); lastRelP = p; }
        while (rel.length && ms - rel[0].ms > SPEED_WIN_MS) rel.shift();
      }
      if (!bought) continue;
      if (!isTick) { // 实际卖出
        if (fired == null) { hyp += ev.bnb; tok = Math.max(0, tok - ev.tok); } // fire 前保留
        continue;
      }
      // ── pos 级链（FA pos 买后才存在）：任意接受价 peak/dd/peakMcap + 可靠价 relPeak/peakProfit
      if (p > peak) peak = p;
      peakMcapUsd = (peak > 0 && arch.totalSupply > 0 && lastFx > 0) ? peak * arch.totalSupply * lastFx : 0;
      if (ev.rel && p > relPeak) relPeak = p;
      if (buyP > 0 && relPeak > 0) { const pp = (relPeak - buyP) / buyP * 100; if (pp > peakProfitPct) peakProfitPct = pp; }
      // crashSpeed 同源重算（FA crashSpeedPctPerSec）：窗含当前 tick，现价=最近可靠价
      let wh = 0, whT = 0;
      for (const r of rel) if (r.p > wh) { wh = r.p; whT = r.ms; }
      let speed = null;
      if (wh > 0 && whT > 0 && ms > whT && lastRelP != null) {
        const ddW = (lastRelP - wh) / wh * 100;
        if (ddW < 0) speed = ddW / Math.max((ms - whT) / 1000, SPEED_MIN_DT_S);
      }
      // 拱形判定（tier 阶梯 + A5 activity 腿并行，首触即全清）
      if (fired == null && archAllowsFire && peak > 0 && peakProfitPct >= minPeakProfit) {
        const dd = (p - peak) / peak * 100;
        const allowed = allowedDd(peakMcapUsd);
        let why = null, ddAllowed = null;
        if (allowed != null && dd <= allowed) { why = 'tier'; ddAllowed = allowed; }
        else if (actTps != null && dd <= actDd && tpsAt(arch, ms) < actTps) { why = 'act'; ddAllowed = actDd; }
        if (why) {
          const speedOk = speed == null || speed > -speedGate; // 快跌中不卖；收复(null)放行
          if (speedOk) {
            const est = ev.usd > 0 ? tok * ev.usd : tok * p * arch.k;
            fired = { ms, p, dd, ddAllowed, tierMcap: peakMcapUsd, speed, why, tps: why === 'act' ? tpsAt(arch, ms) : null, est, tokAtFire: tok };
            hyp += est; tok = 0;
          }
        }
      }
    }
    return {
      diff: hyp - arch.actualProceeds, fired, heldAtFire,
      pnlHyp: hyp - arch.bnbIn, pnlActual: arch.actualProceeds - arch.bnbIn,
    };
  }

  const fmtK = (v) => v == null ? 'null' : (v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v.toFixed(0));
  const cells = []; // {label, net, fire} 全表收集 → 末尾最优汇总
  function runSet(label, cfg) {
    let tot = 0, fireCnt = 0;
    for (const a of archives) { const r = simulate(a, cfg); if (r.fired) fireCnt++; tot += r.diff; }
    cells.push({ label, net: tot, fire: fireCnt });
    return { net: tot, fireCnt };
  }

  // ── trace：校验档 sim fire vs R1 真实拱形 fire（时机配对 + proceeds 估值误差）──
  async function traceR1(rows) {
    console.log(`\n[trace] R1=${TRACE_R1.slice(0, 8)} 现役参数 sim vs R1 真实 fire 对拍`);
    const sigs = [];
    {
      let from = 0;
      for (;;) {
        const { data, error } = await db.from('strategy_signals')
          .select('id,token_address,created_at,reason').eq('experiment_id', TRACE_R1).eq('action', 'sell')
          .order('created_at', { ascending: true }).range(from, from + 499);
        if (error) throw new Error('signals: ' + error.message);
        sigs.push(...(data || []));
        if (!data || data.length < 500) break;
        from += 500;
      }
    }
    const sigIds = new Set(sigs.filter(s => /P1\.5/.test(s.reason || '')).map(s => s.id));
    const r1trades = [];
    {
      let from = 0;
      for (;;) {
        const { data, error } = await db.from('trades')
          .select('token_address,signal_id,input_amount,output_amount,created_at')
          .eq('experiment_id', TRACE_R1).order('executed_at', { ascending: true }).range(from, from + 499);
        if (error) throw new Error('r1 trades: ' + error.message);
        r1trades.push(...(data || []));
        if (!data || data.length < 500) break;
        from += 500;
      }
    }
    const r1Fire = new Map(); // token → 首笔拱形卖单（created_at=回放事件时间）
    for (const t of r1trades) {
      if (t.signal_id && sigIds.has(t.signal_id) && !r1Fire.has(t.token_address)) r1Fire.set(t.token_address, t);
    }
    let match = 0, simOnly = 0, r1Only = 0, estErrSum = 0;
    const dtArr = [], lines = [];
    for (const { a, r } of rows) {
      const r1t = r1Fire.get(a.addr);
      const r1ms = r1t ? new Date(r1t.created_at).getTime() : null;
      if (r.fired && r1t) {
        match++;
        const actual = Number(r1t.output_amount || 0);
        const est = r.fired.est;
        const err = est - actual;
        estErrSum += err;
        const dt = (r.fired.ms - r1ms) / 1000;
        dtArr.push(dt);
        lines.push(`  M ${a.symbol} ${a.addr} Δt=${dt.toFixed(1)}s simP=${r.fired.p.toExponential(2)} est=${est.toFixed(3)} act=${actual.toFixed(3)} err=${(err >= 0 ? '+' : '') + err.toFixed(3)} k=${a.k.toFixed(3)} dd=${r.fired.dd.toFixed(0)}`);
      } else if (r.fired) {
        simOnly++;
        lines.push(`  S(simOnly) ${a.symbol} ${a.addr} est=${r.fired.est.toFixed(3)} dd=${r.fired.dd.toFixed(0)} @${new Date(r.fired.ms).toISOString()}`);
      } else if (r1t) {
        r1Only++;
        lines.push(`  O(r1Only) ${a.symbol} ${a.addr} act=${Number(r1t.output_amount || 0).toFixed(3)} @${r1t.created_at}`);
      }
    }
    for (const l of lines.slice(0, 100)) console.log(l);
    if (lines.length > 100) console.log(`  …（${lines.length - 100} 行省略）`);
    dtArr.sort((x, y) => x - y);
    const med = dtArr.length ? dtArr[Math.floor(dtArr.length / 2)] : null;
    console.log(`  matched=${match} simOnly=${simOnly} r1Only=${r1Only} | estErrSum=${estErrSum.toFixed(3)}（正=sim 高估 proceeds）| Δt中位=${med == null ? '-' : med.toFixed(1) + 's'}（正=sim 晚于 R1）`);
  }

  // ── ① 校验档：现役参数无 speed 门 → 期望 ≈ 回测 -2.8130 ──
  {
    const CUR = [[100000, -20], [20000, -25], [0, -35]].map(([m, d]) => ({ mcap: m, dd: d }));
    const rows = archives.map(a => ({ a, r: simulate(a, { tiers: CUR, minPeakProfit: 10, speedGate: Infinity }) }));
    let tot = 0, fireCnt = 0;
    for (const { r } of rows) { if (r.fired) fireCnt++; tot += r.diff; }
    cells.push({ label: '校验:现役无门', net: tot, fire: fireCnt });
    console.log(`\n[①校验] 现役 [[100K,-20],[20K,-25],[0,-35]] peakProf>=10 无speed门: 模拟净效应=${tot.toFixed(4)} fire=${fireCnt}/${archives.length}`);
    console.log(`       （回测真值 -2.8130；|偏差| >= 0.3 则模拟器作废，矩阵结论不可用）`);
    if (Math.abs(tot - (-2.8130)) >= 0.3) {
      console.log('       ⚠️ 偏差超公差——先查 totalSupply 缺失票/卖出事件归并，再谈矩阵');
    }
    if (TRACE_R1) await traceR1(rows);
  }

  // ── 单跑模式（--tiers / --act 任一给出即单跑后退出）──
  if (TIERS || ACT) {
    const cfg = {
      tiers: TIERS || [],
      minPeakProfit: MIN_PEAK_PROFIT,
      speedGate: SPEED_GATE,
      actTps: ACT ? ACT.tps : null,
      actDd: ACT ? ACT.dd : 0,
      bareOnly: BARE_ONLY,
    };
    console.log(`\n[单跑] tiers=${JSON.stringify((TIERS || []).map(t => [t.mcap, t.dd]))} speedGate=${SPEED_GATE === Infinity ? '无' : SPEED_GATE + '%/s'} peakProf>=${MIN_PEAK_PROFIT}${ACT ? ` A5{tps<${ACT.tps}, dd<=${ACT.dd}}` : ''}`);
    const rows = [];
    for (const a of archives) rows.push({ a, r: simulate(a, cfg) });
    rows.sort((x, y) => x.r.diff - y.r.diff);
    let tot = 0, fireCnt = 0;
    for (const { r } of rows) { tot += r.diff; if (r.fired) fireCnt++; }
    for (const { a, r } of rows) {
      if (Math.abs(r.diff) > 0.05 || r.fired) {
        console.log(`  ${a.symbol} ${a.addr} diff=${(r.diff >= 0 ? '+' : '') + r.diff.toFixed(3)} ${r.fired ? `fire(${r.fired.why}) dd${r.fired.dd.toFixed(0)}<=${r.fired.ddAllowed} mcap${fmtK(r.fired.tierMcap)} speed=${r.fired.speed == null ? 'null' : r.fired.speed.toFixed(1)}${r.fired.tps != null ? ' tps=' + r.fired.tps.toFixed(3) : ''}` : 'nofire'}`);
      }
    }
    console.log(`净效应=${(tot >= 0 ? '+' : '') + tot.toFixed(4)} BNB | fire=${fireCnt}/${archives.length}`);
    process.exit(0);
  }

  const GATES = [Infinity, 3, 2, 1, 0.5];
  const gateHead = (g) => g === Infinity ? '无门' : `spd>${g}`;

  // ── ② A1 独立形状扫（超高利润浅回撤，脱离 tier 阶梯）──
  {
    console.log(`\n[②A1独立扫] peakProfit 60/100/150 × dd -8/-12/-15（纯兜底单档）× speed 门`);
    console.log(['peak\\dd', ...[-8, -12, -15].flatMap(d => GATES.map(g => `dd${d} ${gateHead(g)}`))].join('\t'));
    for (const peak of [60, 100, 150]) {
      const row = [`${peak}%`];
      for (const dd of [-8, -12, -15]) for (const g of GATES) {
        const r = runSet(`A1 p${peak} dd${dd} g${g}`, { tiers: [{ mcap: 0, dd }], minPeakProfit: peak, speedGate: g });
        row.push(`${r.net >= 0 ? '+' : ''}${r.net.toFixed(2)}(${r.fireCnt})`);
      }
      console.log(row.join('\t'));
    }
  }

  // ── ③ 主矩阵：LADDERS × gate × peak 门 ──
  const LADDERS = [
    ['现役', [[100000, -20], [20000, -25], [0, -35]]],
    ['深一档', [[100000, -25], [20000, -30], [0, -40]]],
    ['深两档', [[100000, -30], [20000, -35], [0, -45]]],
    ['撤100K', [[20000, -30], [0, -45]]],
    ['撤100K深', [[20000, -35], [0, -50]]],
    ['纯兜底45', [[0, -45]]],
    ['纯兜底50', [[0, -50]]],
    ['纯兜底60', [[0, -60]]],
    ['双档深', [[50000, -40], [0, -55]]],
  ];
  for (const peakGate of [5, 10, 20]) {
    console.log(`\n[③主矩阵 peakProf>=${peakGate}] 基准=R0 实际卖出（净额=${actualNet.toFixed(3)}）`);
    console.log(['dd阶梯', ...GATES.map(gateHead)].join('\t'));
    for (const [name, ladder] of LADDERS) {
      const tiers = ladder.map(([m, d]) => ({ mcap: m, dd: d }));
      const row = [name];
      for (const g of GATES) {
        const r = runSet(`主 p${peakGate} ${name} g${g}`, { tiers, minPeakProfit: peakGate, speedGate: g });
        row.push(`${r.net >= 0 ? '+' : ''}${r.net.toFixed(2)}(${r.fireCnt})`);
      }
      console.log(row.join('\t'));
    }
  }

  // ── ④ A5 冷盘快跑扫（独立腿：tps < 门 且 dd <= 阈值，armed peak>=10）──
  {
    console.log(`\n[④A5冷盘快跑] 独立腿 tps<门 AND dd<=阈值 AND peakProf>=10（无 speed 门——冷盘稀 tick crashSpeed 自动 null）`);
    console.log(['tps门\\dd', ...[-10, -15, -20].map(d => `dd${d}`)].join('\t'));
    for (const tpsG of [0.04, 0.08, 0.15]) {
      const row = [`${tpsG}`];
      for (const dd of [-10, -15, -20]) {
        const r = runSet(`A5 tps${tpsG} dd${dd}`, { tiers: [], minPeakProfit: 10, speedGate: Infinity, actTps: tpsG, actDd: dd });
        row.push(`${r.net >= 0 ? '+' : ''}${r.net.toFixed(2)}(${r.fireCnt})`);
      }
      console.log(row.join('\t'));
    }
  }

  // ── ⑤ 裸奔诊断：从未武装（armPeak < 10%）票清单——A6 立档依据 ──
  const bareList = archives.filter(a => a.armPeak < ARM_MIN_PEAK);
  {
    const bare = bareList.map(a => ({ a, peakProfitPct: a.armPeak, pnl: a.actualProceeds - a.bnbIn }));
    const net = bare.reduce((s, x) => s + x.pnl, 0);
    console.log(`\n[⑤裸奔诊断] 从未武装（peakProf<${ARM_MIN_PEAK}%）票 ${bare.length}/${archives.length}，R0 实际净额合计=${net.toFixed(4)} BNB`);
    bare.sort((x, y) => x.pnl - y.pnl);
    for (const { a, peakProfitPct, pnl } of bare) {
      console.log(`  ${a.symbol} ${a.addr} peakProf=${peakProfitPct.toFixed(1)}% R0净额=${pnl.toFixed(3)}`);
    }
  }

  // ── ⑥ A6 裸奔兜底扫（bareOnly：仅从未武装票 fire；peak 门=0——这些票本就到不了 10%）──
  //   行 = dd 阈值；列 = 纯 dd 门 / 带 tps 门（act 腿：tps < 门 AND dd <= 阈值）
  {
    console.log(`\n[⑥A6裸奔兜底] 仅 ${bareList.length} 张从未武装票；peak门=0（对照组=⑤ R0 实际净额）`);
    console.log(['dd\\tps', '纯dd门', 'tps<0.04', 'tps<0.08', 'tps<0.15'].join('\t'));
    const fmt = (r) => `${r.net >= 0 ? '+' : ''}${r.net.toFixed(2)}(${r.fireCnt})`;
    for (const dd of [-15, -20, -30, -45]) {
      const row = [`dd${dd}`];
      row.push(fmt(runSet(`A6 dd${dd}`, { tiers: [{ mcap: 0, dd }], minPeakProfit: 0, speedGate: Infinity, bareOnly: true })));
      for (const tps of [0.04, 0.08, 0.15]) {
        row.push(fmt(runSet(`A6 dd${dd} tps${tps}`, { tiers: [], minPeakProfit: 0, speedGate: Infinity, bareOnly: true, actTps: tps, actDd: dd })));
      }
      console.log(row.join('\t'));
    }
  }

  // ── 最优汇总（全表 top8）──
  {
    console.log(`\n[最优 top8]（全部格子按净效应降序；括号=fire 数）`);
    cells.sort((a, b) => b.net - a.net);
    for (const c of cells.slice(0, 8)) console.log(`  ${(c.net >= 0 ? '+' : '') + c.net.toFixed(3)}(${c.fire})  ${c.label}`);
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
