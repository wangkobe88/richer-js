/**
 * 买入点位分析快照构建（BP1，2026-11-03）——纯函数，零 DB 零网络
 *
 * 定位（用户裁定 2026-11-03）：输入同样是 wss_price_ticks，但判的是「**当前点位
 * 是否适合买入**」（入场时机），与反作弊模块（CD）判「盘面是否作弊」分工不同。
 * 判定形态=**Jev 综合判定**（维度题组+一道综合题由 Jev 直接给适合买入程度；
 * 代码只透传不做规则映射——不建 grade）。本期=模块本体+测试集，引擎融合（Service/
 * DB 表/FA 投影/挂点/回测接线）明确不做。
 *
 * 组装路径：内部调 cheat 的 buildSnapshotFromRows（规范化 ticks/wallets/derived
 * **复用不复制**——钱包口径=sender||trader、router 伪钱包剔除、链上真序稳定重排、
 * 资金口径不滤 outlier 全部单点在 cheat-snapshot），再算买点特有 buyDerived。
 * 背景事实（全窗总量/活跃度/价格拱/对敲/持仓分布族）不重算，state 直接读
 * cheatDerived。
 *
 * 口径总则（与 CD 对齐的既定事实，勿改）：
 * - 近窗=以**锚末 tick 时刻** tEnd（=max dt）为终点的 W 秒半开区间 (tEnd−W, tEnd]
 *   （下界exclusive——dt 恰=tEnd−W 不入窗，单测锁死）；dt 基准沿用 cheat：created，
 *   缺失退化 first_tick（snapshot.dtBase 标注）
 * - 资金族不滤 outlier（资金行为照算）；价格族仅 outlier=false 且 price>0（可靠价）
 * - 集中度/参与人数类剔 AGGREGATOR_ROUTER_ADDRS 伪钱包（cheat 同款反偏置方向）
 * - 全部纯函数**禁 Date.now**（防前视；时间全部走 dt 域相对秒）
 * - 缺证据=null（有证据的缺席，不以 0 冒充）；窗内无行=0（有证据零值）
 * - token 域锚（bigHolderSellBnb60/exitSellerCount60）：token_amount 任一行缺失
 *   → null fail-closed（cheat creator 峰值锚同款纪律）
 */

const { buildSnapshotFromRows, isRouterWallet, loadFamousRoster } = require('./cheat-snapshot');
const { resolveLaunchPriceBnb, floorLaunchPriceBnb } = require('./launch-price');

/** 近窗宽度族（秒）：30/60/120 */
const BP_WINDOWS = [30, 60, 120];
/** 大持仓卖压锚的持仓 top N（全窗正净 token 持仓前 N 钱包） */
const BP_TOP_HOLDER_N = 5;
/** burst 滑窗宽度（秒，cheat BURST_WAVE_SEC 同值——买点版按窗内笔数+买入额+钱包数） */
const BP_BURST_SEC = 5;
/** 价格轨迹等份桶数 */
const BP_PRICE_BUCKETS = 20;
/** 发行价覆盖判据容差（秒）：数组最早 dt ≤ 此值 = ticks 含出生段（BP5 发行价锚） */
const BP_LAUNCH_COVER_TOL = 90;
/** 摆动确认阈值（%）：zigzag 反向运动超此值确认峰/谷摆点（BP8 圣诞树原料；初版待校准） */
const BP_SWING_THRESHOLD_PCT = 20;
/** 开盘段宽度（秒）：dt < 此值=开盘段（BP18 盘面分类锚——首段购买力结构度量） */
const BP_OPEN_SEG_SEC = 30;
/** 开盘段大额单判线（BNB）：单笔买入 ≥ 此值计大额（BP18；与 BP16 大户判据「0.3+ BNB 级」同线） */
const BP_OPEN_BIG_BUY_BNB = 0.3;
/** 锚前尾段固定子窗（秒）：锚前最后 5 秒行数/买笔数/买额——「买点时刻即时状态」时序证据（BP28 案四改，S053 三段形状 state 盲区） */
const BP_TAIL_SEC = 5;
/** 点位性质临近段宽度（秒）：锚前 120s 内 5 秒段最大涨/跌幅（BP58 entry_shape——很久以前的急拉/急砸不定义买点当下的点位性质） */
const BP_NEAR_SPEED_SEC = 120;

/** 锚末时刻 tEnd=max dt（ticks 任意序皆稳；无有效 dt → null） */
function bpTEndOf(ticks) {
  let tEnd = null;
  for (const t of ticks || []) {
    if (t.dt === null || t.dt === undefined) continue;
    if (tEnd === null || t.dt > tEnd) tEnd = t.dt;
  }
  return tEnd;
}

/** 窗成员判定：半开区间 (tEnd−W, tEnd]（下界 exclusive，单测锁死） */
function bpInWin(t, tEnd, W) {
  return tEnd !== null && t.dt !== null && t.dt !== undefined && t.dt > tEnd - W && t.dt <= tEnd;
}

/**
 * zigzag 摆动检测（BP8 圣诞树原料）——阈值化峰谷交替，纯事实不判形状。
 * dir=0（未定向）期双向追踪 runningMax/runningMin，反向幅度先触阈者确认首摆点
 * （两阈同点命中时峰确认优先——确定性声明，罕见中间价深震荡形状）；
 * 进段后常规：涨段找峰（自段内高点回落 ≥thr 确认峰）/跌段找谷（反弹 ≥thr 确认谷）。
 * 返回 points=已确认摆点 {dt,price,kind}、ext=当前段极值候选（未完成段暂态，不冒充
 * 树峰）、lastDir=当前段方向（1 涨/-1 跌/0 未定向）、legs=摆点（含末候选）相邻段
 * {fromDt,toDt,amplPct}——树分段/位置判读的原料。
 */
function detectSwings(rel, thrPct) {
  if (rel.length < 2) return { points: [], legs: [], lastDir: null, ext: null };
  const points = [];
  let dir = 0;
  let ext = rel[0];
  let runMax = rel[0], runMin = rel[0];
  for (let i = 1; i < rel.length; i++) {
    const t = rel[i];
    if (dir === 0) {
      if (t.priceBnb >= runMax.priceBnb) { runMax = t; ext = t; }
      else if (t.priceBnb <= runMin.priceBnb) { runMin = t; ext = t; }
      else {
        const fromMax = (t.priceBnb / runMax.priceBnb - 1) * 100;
        const fromMin = (t.priceBnb / runMin.priceBnb - 1) * 100;
        if (fromMax <= -thrPct) { points.push({ dt: runMax.dt, price: runMax.priceBnb, kind: 'high' }); dir = -1; ext = t; }
        else if (fromMin >= thrPct) { points.push({ dt: runMin.dt, price: runMin.priceBnb, kind: 'low' }); dir = 1; ext = t; }
      }
    } else if (dir === 1) {
      if (t.priceBnb >= ext.priceBnb) ext = t;
      else if ((t.priceBnb / ext.priceBnb - 1) * 100 <= -thrPct) { points.push({ dt: ext.dt, price: ext.priceBnb, kind: 'high' }); dir = -1; ext = t; }
    } else {
      if (t.priceBnb <= ext.priceBnb) ext = t;
      else if ((t.priceBnb / ext.priceBnb - 1) * 100 >= thrPct) { points.push({ dt: ext.dt, price: ext.priceBnb, kind: 'low' }); dir = 1; ext = t; }
    }
  }
  const seq = points.map((p) => ({ dt: p.dt, price: p.price })).concat([{ dt: ext.dt, price: ext.priceBnb }]);
  const legs = [];
  for (let i = 1; i < seq.length; i++) {
    legs.push({ fromDt: seq[i - 1].dt, toDt: seq[i].dt, amplPct: +(((seq[i].price / seq[i - 1].price) - 1) * 100).toFixed(2) });
  }
  return { points, legs, lastDir: dir, ext };
}

/**
 * 买点派生统计（纯函数；cheat snapshot 形状 → buyDerived）。
 * @param {Object} snapshot - buildSnapshotFromRows 产物（消费 ticks/wallets/derived）
 * @param {Set<string>|undefined|null} [famousRoster] - 著名钱包名单注入（单测用；
 *   undefined=读 config 名单（loadFamousRoster），null=模拟名单缺失——famousTraces
 *   整体 null（轴不可评），与 cheatDerived famous 族 null 语义同向
 * @returns {Object} buyDerived（菜单见模块头注；win 嵌套 {30:{…},60:{…},120:{…}}）
 */
function computeBuyPointDerived(snapshot, famousRoster) {
  const ticks = snapshot.ticks || [];
  const tEnd = bpTEndOf(ticks);
  const dts = ticks.map((t) => t.dt).filter((v) => v !== null && v !== undefined);
  const arc = snapshot.derived && snapshot.derived.priceArc ? snapshot.derived.priceArc : null;

  // ── 时点位置族 ──
  const tokenAgeSec = tEnd;
  const spanSec = dts.length >= 2 ? Math.max(...dts) - Math.min(...dts) : null;
  const currentVsAthPct = arc && arc.ath > 0 ? +(((arc.last / arc.ath) - 1) * 100).toFixed(2) : null;
  const secSinceAth = arc && arc.athDt !== null && arc.athDt !== undefined && tEnd !== null
    ? tEnd - arc.athDt : null;
  const madeHigh120 = arc && arc.athDt !== null && arc.athDt !== undefined && tEnd !== null
    ? (arc.athDt > tEnd - 120 && arc.athDt <= tEnd) : null;

  // ── 价格族（仅可靠价：outlier=false 且 price>0；含 dt 才能进窗）──
  const rel = ticks.filter((t) => !t.outlier && t.priceBnb !== null && t.priceBnb !== undefined
    && t.priceBnb > 0 && t.dt !== null && t.dt !== undefined);
  const chgOf = (W) => {
    if (rel.length < 2) return null;
    const lastPrice = rel[rel.length - 1].priceBnb;
    let prev = null;
    for (const t of rel) { if (t.dt <= tEnd - W) prev = t.priceBnb; }
    if (prev === null) prev = rel[0].priceBnb; // 窗起点前无可靠价 → 全窗首可靠价
    return +(((lastPrice / prev) - 1) * 100).toFixed(2);
  };
  // BP6 用户裁定：价格动量短窗 5/10/30s（近窗趋势判定，30/60/120 太大——秒级狙击视角）
  const chg5Pct = chgOf(5), chg10Pct = chgOf(10), chg30Pct = chgOf(30);
  // BP10 回看速度锚：锚窗内任意 5 秒段最大涨幅（当前时点 chg5 测不到「此前段的暴涨」——
  // SB 案 S022 锚落脉冲后平台 chg5 仅 +9.1 但此前 5 秒段 +58.3）。纯事实（代码只组数据，
  // 快慢判读归 Jev）；滑动窗最低价单调队列 O(n)：对每个终点 j 取 5 秒窗内最低价为起点。
  let maxChg5Pct = null;
  if (rel.length >= 2) {
    const dq = []; // 存 idx，价格单调递增（队头=窗内最低）
    for (let j = 0; j < rel.length; j++) {
      while (dq.length && rel[dq[dq.length - 1]].priceBnb >= rel[j].priceBnb) dq.pop();
      dq.push(j);
      while (dq.length && rel[j].dt - rel[dq[0]].dt > 5) dq.shift();
      if (dq.length && dq[0] < j) {
        const chg = (rel[j].priceBnb / rel[dq[0]].priceBnb - 1) * 100;
        if (maxChg5Pct === null || chg > maxChg5Pct) maxChg5Pct = chg;
      }
    }
    if (maxChg5Pct !== null) maxChg5Pct = +maxChg5Pct.toFixed(2);
  }
  // BP58 点位性质速度锚三键：maxDn5Pct=锚窗任意 5 秒段最大跌幅（maxChg5Pct 对称
  // 跌方向——「直线砸盘」直接度量，单调队列队头=窗内最高价为起点）；nearMaxUp5/
  // nearMaxDn5=**锚前 120s 临近段**（BP_NEAR_SPEED_SEC）内 5 秒段最大涨/跌幅——很久
  // 以前的急拉/急砸不定义买点当下的点位性质（全窗 maxChg5 对长票锚不住「此刻正在
  // 尖刺/砸盘」）；起点可略早于段界（5 秒滑窗自身限界），终点须落在段内；<2 可靠价
  // 全族 null；纯事实（代码只组数据，形状判读归 Jev entry_shape 题）
  let maxDn5Pct = null, nearMaxUp5Pct = null, nearMaxDn5Pct = null;
  if (rel.length >= 2) {
    const dqLo = []; // 涨：队头=窗内最低
    const dqHi = []; // 跌：队头=窗内最高
    for (let j = 0; j < rel.length; j++) {
      while (dqLo.length && rel[dqLo[dqLo.length - 1]].priceBnb >= rel[j].priceBnb) dqLo.pop();
      dqLo.push(j);
      while (dqHi.length && rel[dqHi[dqHi.length - 1]].priceBnb <= rel[j].priceBnb) dqHi.pop();
      dqHi.push(j);
      while (dqLo.length && rel[j].dt - rel[dqLo[0]].dt > 5) dqLo.shift();
      while (dqHi.length && rel[j].dt - rel[dqHi[0]].dt > 5) dqHi.shift();
      if (dqHi.length && dqHi[0] < j) {
        const chg = (rel[j].priceBnb / rel[dqHi[0]].priceBnb - 1) * 100;
        if (maxDn5Pct === null || chg < maxDn5Pct) maxDn5Pct = chg;
      }
      if (tEnd !== null && rel[j].dt >= tEnd - BP_NEAR_SPEED_SEC) {
        if (dqLo.length && dqLo[0] < j) {
          const chg = (rel[j].priceBnb / rel[dqLo[0]].priceBnb - 1) * 100;
          if (nearMaxUp5Pct === null || chg > nearMaxUp5Pct) nearMaxUp5Pct = chg;
        }
        if (dqHi.length && dqHi[0] < j) {
          const chg = (rel[j].priceBnb / rel[dqHi[0]].priceBnb - 1) * 100;
          if (nearMaxDn5Pct === null || chg < nearMaxDn5Pct) nearMaxDn5Pct = chg;
        }
      }
    }
    if (maxDn5Pct !== null) maxDn5Pct = +maxDn5Pct.toFixed(2);
    if (nearMaxUp5Pct !== null) nearMaxUp5Pct = +nearMaxUp5Pct.toFixed(2);
    if (nearMaxDn5Pct !== null) nearMaxDn5Pct = +nearMaxDn5Pct.toFixed(2);
  }
  // 价格轨迹：全窗可靠价等笔距 20 桶（桶价=桶内末笔可靠价；<20 行时空桶自然缺席）
  const priceBuckets = [];
  if (rel.length >= 2) {
    const n = rel.length;
    const per = n / BP_PRICE_BUCKETS;
    for (let b = 0; b < BP_PRICE_BUCKETS; b++) {
      const start = Math.floor(b * per), end = Math.floor((b + 1) * per);
      if (end <= start) continue;
      const lastTick = rel[Math.min(end, n) - 1];
      priceBuckets.push({ dt: lastTick.dt, price: lastTick.priceBnb });
    }
  }

  // ── 摆动结构族（BP8 圣诞树原料）：zigzag 阈值化峰谷检测（纯事实，形状与位置
  // 判读归 Jev——「代码只组数据」纪律）；<2 可靠价全族 null；secSince/currentVs
  // 族锚定**最近已确认**摆点（当前段极值候选是未完成段暂态，不冒充树峰）；
  // swingLastDir=当前段方向（1=涨段/-1=跌段/0=未定向）；swingMaxAmplPct=段序列
  // （含当前未完成段）最大幅度绝对值；swingPoints/swingLegs=state 渲染原料不进锚 ──
  let swing = null;
  if (rel.length >= 2) {
    const s = detectSwings(rel, BP_SWING_THRESHOLD_PCT);
    const lastPrice = rel[rel.length - 1].priceBnb;
    const lastHigh = [...s.points].reverse().find((p) => p.kind === 'high') || null;
    const lastLow = [...s.points].reverse().find((p) => p.kind === 'low') || null;
    swing = {
      points: s.points,
      legs: s.legs,
      lastDir: s.lastDir,
      highCount: s.points.filter((p) => p.kind === 'high').length,
      lowCount: s.points.filter((p) => p.kind === 'low').length,
      secSinceHigh: lastHigh !== null && tEnd !== null ? tEnd - lastHigh.dt : null,
      secSinceLow: lastLow !== null && tEnd !== null ? tEnd - lastLow.dt : null,
      vsHighPct: lastHigh !== null && lastHigh.price > 0 ? +(((lastPrice / lastHigh.price) - 1) * 100).toFixed(2) : null,
      vsLowPct: lastLow !== null && lastLow.price > 0 ? +(((lastPrice / lastLow.price) - 1) * 100).toFixed(2) : null,
      maxAmplPct: s.legs.length ? Math.max(...s.legs.map((l) => Math.abs(l.amplPct))) : null,
    };
  }

  // ── win[W] 族（资金口径不滤 outlier；人数类剔伪钱包；无钱包行计量不计人）──
  const win = {};
  for (const W of BP_WINDOWS) {
    let buyBnb = 0, sellBnb = 0, buyN = 0, sellN = 0;
    const buyers = new Set(), sellers = new Set();
    for (const t of ticks) {
      if (!bpInWin(t, tEnd, W)) continue;
      const bnb = t.bnb || 0;
      const isBuy = t.side === 'BUY';
      if (isBuy) { buyBnb += bnb; buyN++; } else { sellBnb += bnb; sellN++; }
      if (t.wallet && !isRouterWallet(t.wallet)) (isBuy ? buyers : sellers).add(t.wallet);
    }
    win[W] = {
      buyBnb: +buyBnb.toFixed(4), sellBnb: +sellBnb.toFixed(4),
      buyN, sellN, netBnb: +(buyBnb - sellBnb).toFixed(4),
      buySharePct: buyBnb + sellBnb > 0 ? +((buyBnb / (buyBnb + sellBnb)) * 100).toFixed(1) : null,
      ticksPerMin: +(((buyN + sellN) / W) * 60).toFixed(2),
      buyers: buyers.size, sellers: sellers.size,
    };
  }
  // 全窗首见买入钱包（剔伪钱包）→ newBuyers=首买 dt 落在窗内的钱包数
  const firstBuyDtOf = new Map();
  for (const t of ticks) {
    if (t.side !== 'BUY' || !t.wallet || isRouterWallet(t.wallet)) continue;
    if (!firstBuyDtOf.has(t.wallet)) firstBuyDtOf.set(t.wallet, t.dt);
  }
  for (const W of BP_WINDOWS) {
    let n = 0;
    for (const dt of firstBuyDtOf.values()) {
      if (dt !== null && dt !== undefined && dt > tEnd - W && dt <= tEnd) n++;
    }
    win[W].newBuyers = n;
  }

  // ── 动能族（集中度剔伪钱包；routerBuyPct 是散户通道代理=纯事实）──
  const win60 = win[60];
  let top1BuyPct60 = null, top1SellPct60 = null, routerBuyPct60 = null;
  {
    const buyBy = new Map(), sellBy = new Map();
    let routerBuyBnb60 = 0;
    for (const t of ticks) {
      if (!bpInWin(t, tEnd, 60)) continue;
      if (t.side === 'BUY') {
        if (t.viaRouter) routerBuyBnb60 += t.bnb || 0;
        if (t.wallet && !isRouterWallet(t.wallet)) {
          buyBy.set(t.wallet, (buyBy.get(t.wallet) || 0) + (t.bnb || 0));
        }
      } else if (t.wallet && !isRouterWallet(t.wallet)) {
        sellBy.set(t.wallet, (sellBy.get(t.wallet) || 0) + (t.bnb || 0));
      }
    }
    const maxOf = (m) => (m.size ? Math.max(...m.values()) : null);
    const mb = maxOf(buyBy), ms = maxOf(sellBy);
    top1BuyPct60 = win60.buyBnb > 0 && mb !== null ? +((mb / win60.buyBnb) * 100).toFixed(1) : null;
    top1SellPct60 = win60.sellBnb > 0 && ms !== null ? +((ms / win60.sellBnb) * 100).toFixed(1) : null;
    routerBuyPct60 = win60.buyBnb > 0 ? +((routerBuyBnb60 / win60.buyBnb) * 100).toFixed(1) : null;
  }

  // ── 节奏趋势：近 120s 对半两段（early=(tEnd−120,tEnd−60] / late=(tEnd−60,tEnd]）
  // 笔/分（60s 半窗 tpm=行数）；late/early>1.2='up'、<0.8='down'、其余='flat'；
  // early=0∧late>0='up'（从静默启动）；两段皆 0 → null（窗内无行=轴不可评）──
  let halfTpmEarly = null, halfTpmLate = null, rateTrend = null;
  {
    let nE = 0, nL = 0;
    for (const t of ticks) {
      if (!bpInWin(t, tEnd, 120)) continue;
      if (t.dt > tEnd - 60) nL++; else nE++;
    }
    if (nE > 0 || nL > 0) {
      halfTpmEarly = nE;
      halfTpmLate = nL;
      rateTrend = nE === 0 ? 'up' : (nL / nE > 1.2 ? 'up' : nL / nE < 0.8 ? 'down' : 'flat');
    }
  }

  // ── burst5In120：近 120s 最密 BP_BURST_SEC 秒滑窗（照 cheat burstWave 双指针；
  // 窗内行按 dt 稳定排序防 block_time 倒退行扰动指针）──
  let burst5In120 = null;
  {
    const wave = ticks.filter((t) => bpInWin(t, tEnd, 120))
      .sort((a, b) => a.dt - b.dt);
    if (wave.length >= 2) {
      let j = 0, curN = 0, curBuy = 0, bestN = 0, bestBuy = 0, bestWalletN = 0;
      const curWallets = new Map(); // wallet → 窗内笔数（同钱包多笔逐出时不误删）
      for (let i = 0; i < wave.length; i++) {
        const t = wave[i];
        curN++;
        if (t.side === 'BUY') curBuy += t.bnb || 0;
        if (t.wallet) curWallets.set(t.wallet, (curWallets.get(t.wallet) || 0) + 1);
        while (t.dt - wave[j].dt > BP_BURST_SEC) {
          const u = wave[j];
          curN--;
          if (u.side === 'BUY') curBuy -= u.bnb || 0;
          if (u.wallet) {
            const n = (curWallets.get(u.wallet) || 1) - 1;
            if (n <= 0) curWallets.delete(u.wallet); else curWallets.set(u.wallet, n);
          }
          j++;
        }
        if (curN > bestN) { bestN = curN; bestBuy = curBuy; bestWalletN = curWallets.size; }
      }
      burst5In120 = { n: bestN, buyBnb: +bestBuy.toFixed(4), wallets: bestWalletN };
    }
  }

  // ── 卖压族（token 域；token_amount 任一行缺失 → 全族 null fail-closed）──
  const tokMissing = ticks.some((t) => t.tok === null || t.tok === undefined);
  let bigHolderSellBnb60 = null, exitSellerCount60 = null;
  if (!tokMissing) {
    // 全窗正净 token 持仓 top N（剔伪钱包）
    const netTok = new Map();
    for (const t of ticks) {
      if (!t.wallet || isRouterWallet(t.wallet)) continue;
      const e = netTok.get(t.wallet) || 0;
      netTok.set(t.wallet, e + (t.side === 'BUY' ? (t.tok || 0) : -(t.tok || 0)));
    }
    const posSorted = [...netTok.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (posSorted.length > 0) {
      const topSet = new Set(posSorted.slice(0, BP_TOP_HOLDER_N).map(([w]) => w));
      let s = 0;
      for (const t of ticks) {
        if (t.side !== 'SELL' || !bpInWin(t, tEnd, 60)) continue;
        if (t.wallet && topSet.has(t.wallet)) s += t.bnb || 0;
      }
      bigHolderSellBnb60 = +s.toFixed(4);
    }
    // 清仓式卖出：近 60s 有卖出 ∧ 全窗净持仓 ≤0 的钱包数（含零买入纯卖方）
    const exited = new Set();
    for (const t of ticks) {
      if (t.side !== 'SELL' || !bpInWin(t, tEnd, 60)) continue;
      if (!t.wallet || isRouterWallet(t.wallet)) continue;
      const net = netTok.get(t.wallet) || 0;
      if (net <= 0) exited.add(t.wallet);
    }
    exitSellerCount60 = exited.size;
  }

  // ── 市值位置族（BP2/T117 2026-11-05）：priceArc × tokenMeta.totalSupply
  // snapshot 自算（引擎/runner 单点同源，as-of 窗自洽——BP 窗=拉数窗，短龄票
  // ≈全史、长票=窗口内位置）；totalSupply 缺失 → 全族 null fail-closed
  //（FA mcapFromPeakPct 同向纪律——市值锚无 supply 不冒充）──
  const supply = snapshot.tokenMeta && Number(snapshot.tokenMeta.totalSupply) > 0
    ? Number(snapshot.tokenMeta.totalSupply) : null;
  let mcapBnb = null, mcapPeakBnb = null, mcapFromPeakPct = null;
  if (arc && supply !== null && arc.last > 0 && arc.ath > 0) {
    mcapBnb = +(arc.last * supply).toFixed(2);
    mcapPeakBnb = +(arc.ath * supply).toFixed(2);
    mcapFromPeakPct = +((1 - arc.last / arc.ath) * 100).toFixed(2);
  }

  // ── holder 流向族（BP2/T117）：holdersNow=全窗末正净持仓钱包数（剔伪钱包）；
  // holdersDelta60=末点与 60s 前同口径计数之差（两遍重放：净持仓=Σ买−Σ卖
  // 求和交换律与序无关，pass1 只取 dt≤tEnd−60 行/pass2 全行——dt 缺失行末点
  // 计入、时点计数排除）；token_amount 任一行缺失 → 全族 null fail-closed
  //（与卖压族同一 tokMissing 纪律）──
  let holdersNow = null, holdersDelta60 = null;
  if (!tokMissing) {
    const holdersAt = (untilDt) => {
      const net = new Map();
      for (const t of ticks) {
        if (untilDt !== null && (t.dt === null || t.dt === undefined || t.dt > untilDt)) continue;
        if (!t.wallet || isRouterWallet(t.wallet)) continue;
        net.set(t.wallet, (net.get(t.wallet) || 0) + (t.side === 'BUY' ? (t.tok || 0) : -(t.tok || 0)));
      }
      let n = 0;
      for (const v of net.values()) if (v > 0) n++;
      return n;
    };
    holdersNow = holdersAt(null);
    if (tEnd !== null) holdersDelta60 = holdersNow - holdersAt(tEnd - 60);
  }

  // ── 发行价位置族（BP5/绝对价格高低维度锚）——锚=平台 curve 初始价（2026-11-08
  // 发行价口径修正：four.meme 主流档 P₀=4.496173469e-9 / flap BNB 盘主力档
  // 5.546e-9 常量，用户裁定「主流档即可」；出处与全档实证=launch-price.js 头注）。
  // 常量平台锚**恒有效不依赖 launchCovered**（锚窗截窗的长票/首行远离创建点照样有
  // 真发行价——旧口径「首笔成交价」对首单滑点/高价模板票的结构性失真就此消除）；
  // quote 盘（flap 非 BNB 计价）2026-11-09 起同 FL 常量（实证 11/11 首 tick=1.00x）；
  // gang/未知平台=null 走旧口径=launchCovered 门下
  // 的全数组首个可靠价（非 outlier/price>0 最早行，链上真序 rel[0]）；出生覆盖
  // 判据=数组最早 dt ≤ BP_LAUNCH_COVER_TOL（首行贴近创建点=数组含出生段；锚窗
  // 截窗的长票不覆盖 → 全族 null fail-closed 截窗不冒充发行价）；launchCovered
  // 键两口径下照落（观测：窗口是否覆盖出生段）；
  // currentVsLaunchPct=末可靠价较发行价 %（可破发为负）；athVsLaunchPct=锚窗最高
  // 可靠价（arc.ath）较发行价 %（BP39/案号 BP34「开盘拉得过高」直接度量锚——Jev
  // 结构性组合不了 currentVsLaunch+currentVsAth 两数，直供；launchCovered 域内
  // arc.ath≤0 时 null fail-closed）；minVsLaunchPct=锚窗**涨起后最低**可靠价较发行价 %
  //（BP43 restart 重启盘「涨起来→又跌回 almost_launch」往返轨迹直供锚——**涨起后**
  // 而非整窗最低：launchCovered 窗含出生段，整窗最低恒=发行价本身 → ≤+10 恒真=判据腿
  // 结构性失效；涨起后段=**首个突破 almost_launch 上界（>+10%，严格大于——+10 恰在
  // almost_launch 桶界内不算离开）的可靠价之后**的全段；BP44（案号 BP39）锚定义修正：
  // BP43 首版「首个最高价之后」对「回落→重新拉起创新高」的重启形状结构性失明——ATH
  // 被新一轮拉起推到锚窗末位 → 峰后段空 → null 不冒充 → 判据腿材料缺席（bt-s01
  // 0x28ad2c7d 对拍 0/9 实证：07:15:41 回到 almost_launch 后 07:16 重新拉起创新高，锚 null，
  // Jev 看不到「回到过」证据判④）；涨起后定义下创新高不遮蔽回落（突破点之后的最低
  // 覆盖全部回落段）；从未 >+10%（整窗都在 almost_launch 内没离开过）或突破点即末位
  // （刚离开无回落证据）→ null 不冒充；Jev 组合不了涨起后最低与发行价两数故直供；
  // BP 侧 rel 自算零 CD 改动；破发为负）──
  let launchPriceBnb = null, currentVsLaunchPct = null, launchCovered = null, athVsLaunchPct = null;
  let minVsLaunchPct = null, curVsMinGapPct = null;
  if (rel.length >= 1) {
    const firstDt = dts.length ? Math.min(...dts) : null;
    launchCovered = tEnd !== null && firstDt !== null && firstDt <= BP_LAUNCH_COVER_TOL;
    // 常量锚解析：platform 缺席（旧夹具/旧档）或 gang/未知 → null=旧口径 bit 不变；
    // quote 判定=rows 行 quote_token（flap collector write 行级标记，2026-11-09 起
    // quote 盘同 FL 常量不再分流，传参保留）
    const quoteToken = ticks.some((t) => t.quote) ? 'quote' : null;
    const constLaunch = resolveLaunchPriceBnb(
      snapshot.tokenMeta ? snapshot.tokenMeta.platform : null, quoteToken);
    // 常量锚保原值精度（4.496173469e-9 量级 toFixed(10) 只剩 1 位有效数字不可磨）；
    // 旧口径锚保 toFixed(10) bit 不变
    let launchAnchor = null;
    if (constLaunch !== null) {
      // T130 地板补丁（2026-11-09，67ad68e0/6efa11ce 低开票案）：首笔买入可靠价低于
      // 平台常量时地板改为首买价（launch 锚=min(常量, 首买价)，floorLaunchPriceBnb）。
      // launchCovered 保护——窗不含出生段时窗内首买≠全局首买（截窗长票首买被裁，
      // 窗内首笔 buy 冒充全局首买=错锚，宁用常量）；首买=窗内首笔可靠 BUY 行价
      const firstBuyRel = launchCovered
        ? (rel.find((t) => t.side === 'BUY') || {}).priceBnb || 0 : 0;
      launchAnchor = floorLaunchPriceBnb(constLaunch, firstBuyRel); // 常量平台锚恒有效（不看 launchCovered）
    } else if (launchCovered && rel[0].priceBnb > 0) {
      launchAnchor = +rel[0].priceBnb.toFixed(10); // 旧口径：覆盖出生段时的首可靠价
    }
    if (launchAnchor !== null && arc && arc.last > 0) {
      launchPriceBnb = launchAnchor;
      currentVsLaunchPct = +(((arc.last / launchPriceBnb) - 1) * 100).toFixed(1);
      if (arc.ath > 0) athVsLaunchPct = +(((arc.ath / launchPriceBnb) - 1) * 100).toFixed(1);
      // 涨起后最低：首个突破 almost_launch 上界（严格 > 1.1×发行价）的可靠价起
      //（含离开那一笔——突破点本身必然 >+10 不影响「≤+10」判定）全段的最低——
      // 多轮回落/再拉起全覆盖（ATH 位置无关）；从未突破（整窗未离开 almost_launch）
      // 或突破点为末位（刚离开无后续）→ null 不冒充「回到过」；
      // 2026-11-09 用户裁定 almost 上界 20→10「基本再次归零」——1.2→1.1 同步
      const exitThreshold = launchPriceBnb * 1.1;
      let exitIdx = -1;
      for (let i = 0; i < rel.length; i++) {
        if (rel[i].priceBnb > exitThreshold) { exitIdx = i; break; }
      }
      if (exitIdx >= 0 && exitIdx < rel.length - 1) {
        let minRel = rel[exitIdx].priceBnb;
        for (let i = exitIdx + 1; i < rel.length; i++) if (rel[i].priceBnb < minRel) minRel = rel[i].priceBnb;
        if (minRel > 0) minVsLaunchPct = +(((minRel / launchPriceBnb) - 1) * 100).toFixed(1);
      }
      // BP58 点位性质：现价距涨起后最低的差值（curVs−minVs，pp）——「正在创新低 /
      // 已从低点回升」直接度量锚（Jev 结构性组合不了两数差，直供）；minVs null
      //（从未离开 almost_launch/刚离开无回落）→ null 不冒充
      if (minVsLaunchPct !== null) curVsMinGapPct = +(currentVsLaunchPct - minVsLaunchPct).toFixed(1);
    }
  }

  // ── 活跃度锚族透传（BP13/案号 BP12：CD activity_level 七要素判法搬运——数值在
  // cheat-snapshot 单点计算（D3.49/D3.55/D3.59/D3.61 演进产物）BP 不重算照抄；
  // BP 锚窗=买入点位之前的窗口（锚=买点信号时刻），临近段 nearSeg=锚窗末端
  // 30s=买点前最后 30 秒——「活跃度检测倾向于买点之前」的判读原料全在此族；
  // dt 缺失全族 null（cheat 同款绝不冒充）；spanSec/tickCount=D3.55 开盘极早窗
  // 反锚两原料（窗 <60s 且笔 <30 双腿）──
  const cd = snapshot.derived || {};

  // ── 锚前尾段三键（BP28 案四改：S053 三段形状 state 时序盲区）——nearSeg 30s
  // 段 totals 无时序：「中段静默占比 54.5% + 段内最大间隔 24s」整体呈现为临近
  // 死寂，锚前最后数秒的集中涌入被段 totals 稀释、Jev 结构性看不到（BP30 纯
  // 题面三段形状句三连跑稳定 low 0.58/0.54/0.61 证实救不动——判读锚定「买点
  // 时刻即时状态」却无时序原料可判）。尾段=锚前最后 BP_TAIL_SEC（5s）固定子窗
  // 行数/买笔数/买额，BP 侧自算（CD 层零改动）；末行 dt=tEnd 恒在窗内=尾段最少
  // 1 笔（「0 笔」不存在）——判读看行数与买额：仅末行 1 笔且尘级=锚点即静默边界
  // （买点时刻死寂），多笔大额=涌入波内（双向锚）；dt 缺失全族 null（tEnd null
  // 即 null 绝不冒充）──
  let nearTail5TickN = null, nearTail5BuyN = null, nearTail5BuyBnb = null, nearTail5BuySharePct = null;
  if (tEnd !== null) {
    let tn5 = 0, bn5 = 0, bb5 = 0;
    for (const t of ticks) {
      if (!bpInWin(t, tEnd, BP_TAIL_SEC)) continue;
      tn5++;
      if (t.side === 'BUY') { bn5++; bb5 += t.bnb || 0; }
    }
    nearTail5TickN = tn5;
    nearTail5BuyN = bn5;
    nearTail5BuyBnb = +bb5.toFixed(4);
    // BP41 真庄反锚腿②机械锚：尾段买 ÷ 全窗买 ×100（「与拉升同量级」的占比口径
    // ——拉升进行时=买量仍占全窗流量实质份额；资金口径不滤 outlier 同 openSeg。
    // 有证据零值：tEnd 在场即数值（全窗零买=0），tEnd 缺失才 null 族语义）
    let winBuyBnb = 0;
    for (const t of ticks) if (t.side === 'BUY') winBuyBnb += t.bnb || 0;
    nearTail5BuySharePct = winBuyBnb > 0 ? +((bb5 / winBuyBnb) * 100).toFixed(1) : 0;
  }
  const activity = {
    spanSec: cd.spanSec ?? null,
    tickCount: cd.tickCount ?? null,
    idlePct: cd.idlePct ?? null,
    buyMedianBnb: cd.buyMedianBnb ?? null,
    throughputBnbPerMin: cd.throughputBnbPerMin ?? null,
    maxDrawdownPct: cd.maxDrawdownPct ?? null,
    nearSegTickN: cd.nearSegTickN ?? null,
    nearSegTicksPerMin: cd.nearSegTicksPerMin ?? null,
    nearSegBuyMedianBnb: cd.nearSegBuyMedianBnb ?? null,
    nearSegBnbPerMin: cd.nearSegBnbPerMin ?? null,
    nearSegMaxGapSec: cd.nearSegMaxGapSec ?? null,
    nearSegBuyN: cd.nearSegBuyN ?? null,
    nearSegSellN: cd.nearSegSellN ?? null,
    // CD394 尾窗键透传（act 题定档主锚判读原料——cheat-snapshot 单点计算，BP 不
    // 重算照抄，与 nearSeg 族同款；短窗票照出=临近段内部趋势判读）
    nearTail10TickN: cd.nearTail10TickN ?? null,
    nearTail10BnbPerMin: cd.nearTail10BnbPerMin ?? null,
    nearPre20BnbPerMin: cd.nearPre20BnbPerMin ?? null,
    nearTail10SellWallets: cd.nearTail10SellWallets ?? null, // CD394 出货臂判读线（末 10s 独立卖侧钱包数）
    nearTail5TickN,
    nearTail5BuyN,
    nearTail5BuyBnb,
    nearTail5BuySharePct,
  };

  // ── 筹码结构锚族透传（BP14/案号 BP14：CD famous 控盘+持仓集中判法搬运——
  // BEM Miner 案 0x75d5…7777 用户裁定「全部搬过来直接用于判定」：①famous 控盘
  // （famousDominancePct=famous+跟单正净÷全场正净，CD D3.2 三档切点 50/25；
  // D 通道联立臂原料 followerTop3/groupBuy）②持仓集中分层（CD240 案用户裁定
  // 分层线：持有者 ≥10 单一 >45%/前二 >55%/前三 >70% 任一过线=垄断证据坐实，
  // ≤5=筹码少豁免）③参与/持有分叉（buyersTotal=买过钱包数 vs posHolderCount
  // =正净持有者数——「买过的人不少、拿货的只有两三个」=拉高出货温床直接度量；
  // buyersTotal 为 BP 侧新增计数，其余全部 cheatDerived 同名单点照抄零重算，
  // top1HoldCircPct 自 holdingsProfile[0] 切片派生）──
  const hp = Array.isArray(cd.holdingsProfile) ? cd.holdingsProfile : [];
  const buyersTotal = (snapshot.wallets || []).reduce((n, e) => n + ((e.buyN || 0) > 0 ? 1 : 0), 0);
  const chip = {
    famousDominancePct: cd.famousDominancePct ?? null,
    famousFollowerTop3Pct: cd.famousFollowerTop3Pct ?? null,
    famousGroupBuyPct: cd.famousGroupBuyPct ?? null,
    posHolderCount: cd.posHolderCount ?? null,
    top1HoldCircPct: hp.length > 0 ? hp[0].circPct ?? null : null,
    top1Top2HoldCircPct: cd.top1Top2HoldCircPct ?? null,
    top3HoldCircPct: cd.top3HoldCircPct ?? null,
    sameBlockHoldPct: cd.sameBlockHoldPct ?? null,
    equalBandHoldPct: cd.equalBandHoldPct ?? null,
    buyersTotal,
  };

  // ── 开盘段结构族（BP18 盘面分类锚：判「强庄开盘进入 / 开盘狙击衰竭」的直接
  // 度量）：开盘段=dt < 30s；资金口径不滤 outlier；大额线 0.3 BNB 与 BP16 大户
  // 判据同线；截窗未覆盖开盘段（首行 dt > BP_LAUNCH_COVER_TOL 同款判据）全族
  // null 不冒充；窗口 ≤30s 无后段 → late 族 null 无对比语义（开盘段内锚照出——
  // 判「强庄在场」只需开盘段大额单在场，不需后段对照）──
  const openSeg = (() => {
    const firstDtAll = dts.length ? Math.min(...dts) : null;
    if (firstDtAll === null || firstDtAll > BP_LAUNCH_COVER_TOL) {
      return { buyBnb: null, buyN: null, buySharePct: null, bigBuyN: null, bigBuyBnb: null, lateBuyBnb: null, lateTicksPerMin: null };
    }
    let openBuyBnb = 0, openBuyN = 0, bigBuyN = 0, bigBuyBnb = 0;
    let totalBuyBnb = 0, lateBuyBnb = 0, lateN = 0;
    for (const t of ticks) {
      if (t.dt === null || t.dt === undefined) continue;
      const bnb = t.bnb || 0;
      const isBuy = t.side === 'BUY';
      if (isBuy) totalBuyBnb += bnb;
      if (t.dt < BP_OPEN_SEG_SEC) {
        if (isBuy) {
          openBuyBnb += bnb; openBuyN++;
          if (bnb >= BP_OPEN_BIG_BUY_BNB) { bigBuyN++; bigBuyBnb += bnb; }
        }
      } else {
        lateN++;
        if (isBuy) lateBuyBnb += bnb;
      }
    }
    const hasLate = spanSec !== null && spanSec > BP_OPEN_SEG_SEC;
    return {
      buyBnb: +openBuyBnb.toFixed(4),
      buyN: openBuyN,
      buySharePct: totalBuyBnb > 0 ? +((openBuyBnb / totalBuyBnb) * 100).toFixed(1) : null,
      bigBuyN,
      bigBuyBnb: +bigBuyBnb.toFixed(4),
      lateBuyBnb: hasLate ? +lateBuyBnb.toFixed(4) : null,
      lateTicksPerMin: hasLate ? +((lateN / (spanSec - BP_OPEN_SEG_SEC)) * 60).toFixed(2) : null,
    };
  })();

  // ── famous 痕迹族（BP53 二修/案号 BP61：S053→BP31 state 补行路线）──
  // ③桶收割完臂/退出臂前提「famous 还在场吗」的时序证据直供：名单钱包各自
  // 首买/首卖时刻+买卖额+全窗净持仓。此前 Jev 只有筹码结构行的聚合数（控盘
  // 占比/集团买入占比），[WALLETS] 前列行不标名单身份——在场性无从判定，实测
  // 四票（147d/0432/59f5/米338a）dom 81~100 groupBuy 71~100 全 high 仍判 none
  // （走厚度退出臂归 none），题面判据 BP53/BP57 句不被执行。纯事实：代码只组
  // 时间线不产「收割完」结论（D3.5 同哲学），在场性判读句在题面。
  // null 语义：roster 缺失 → 键整体 null（轴不可评，与 cheatDerived famous 族
  // 同向）；窗内无名单命中 → wallets=[] / inCustodyCount=0（有证据的缺席）。
  // 占比分母=cheatDerived totalBuy/totalSell（与 famousGroupBuyPct 同源口径，
  // 但分子只计 famous 本人不含跟单——跟单者归 followers 轴不冒充 famous 痕迹）。
  const famousTraces = (() => {
    const rosterFt = famousRoster !== undefined ? famousRoster : loadFamousRoster();
    if (!rosterFt) return null;
    const fam = new Map();
    for (const t of ticks) {
      if (!t.wallet) continue;
      const w = t.wallet.toLowerCase();
      if (!rosterFt.has(w)) continue;
      const e = fam.get(w) || {
        w, buyBnb: 0, buyN: 0, firstBuyDt: null, sellBnb: 0, sellN: 0, firstSellDt: null, netBnb: 0,
      };
      const bnb = t.bnb || 0;
      if (t.side === 'BUY') {
        e.buyBnb += bnb; e.buyN++; e.netBnb += bnb;
        if (t.dt !== null && t.dt !== undefined && (e.firstBuyDt === null || t.dt < e.firstBuyDt)) e.firstBuyDt = t.dt;
      } else {
        e.sellBnb += bnb; e.sellN++; e.netBnb -= bnb;
        if (t.dt !== null && t.dt !== undefined && (e.firstSellDt === null || t.dt < e.firstSellDt)) e.firstSellDt = t.dt;
      }
      fam.set(w, e);
    }
    const wallets = [...fam.values()].sort((a, b) => b.buyBnb - a.buyBnb)
      .map((e) => ({
        ...e,
        buyBnb: +e.buyBnb.toFixed(4), sellBnb: +e.sellBnb.toFixed(4), netBnb: +e.netBnb.toFixed(4),
      }));
    const groupBuyBnb = +wallets.reduce((s, e) => s + e.buyBnb, 0).toFixed(4);
    const groupSellBnb = +wallets.reduce((s, e) => s + e.sellBnb, 0).toFixed(4);
    return {
      wallets,
      groupBuyBnb,
      groupBuyPct: cd.totalBuyBnb > 0 ? +((groupBuyBnb / cd.totalBuyBnb) * 100).toFixed(1) : null,
      groupSellBnb,
      groupSellPct: cd.totalSellBnb > 0 ? +((groupSellBnb / cd.totalSellBnb) * 100).toFixed(1) : null,
      netSumBnb: +wallets.reduce((s, e) => s + e.netBnb, 0).toFixed(4),
      inCustodyCount: wallets.filter((e) => e.netBnb > 0).length,
    };
  })();

  return {
    // 时点位置
    tokenAgeSec, spanSec, currentVsAthPct, secSinceAth, madeHigh120,
    // 价格（可靠价口径；BP6 短窗 5/10/30s；BP10 maxChg5=回看速度锚；BP58 跌方向
    // 对称键 maxDn5 + 临近段速度双键——entry_shape 判读原料）
    chg5Pct, chg10Pct, chg30Pct, maxChg5Pct, maxDn5Pct, nearMaxUp5Pct, nearMaxDn5Pct, priceBuckets,
    // 摆动结构族（BP8 圣诞树原料；<2 可靠价全族 null；points/legs=state 渲染原料）
    swingPoints: swing ? swing.points : null,
    swingLegs: swing ? swing.legs : null,
    swingHighCount: swing ? swing.highCount : null,
    swingLowCount: swing ? swing.lowCount : null,
    swingLastDir: swing ? swing.lastDir : null,
    secSinceSwingHigh: swing ? swing.secSinceHigh : null,
    secSinceSwingLow: swing ? swing.secSinceLow : null,
    currentVsSwingHighPct: swing ? swing.vsHighPct : null,
    currentVsSwingLowPct: swing ? swing.vsLowPct : null,
    swingMaxAmplPct: swing ? swing.maxAmplPct : null,
    // 发行价位置族（BP5：截窗未覆盖出生段 → null 不冒充；launchCovered=覆盖判据观测键；
    // athVsLaunchPct=锚窗最高可靠价较发行价 %，BP39「开盘拉高出货盘」度量锚；
    // minVsLaunchPct=锚窗涨起后最低可靠价较发行价 %，BP43 restart 重启盘轨迹锚——
    // BP44 修正为「首个突破 almost 上界之后」定义（创新高不遮蔽回落）；2026-11-09 上界 20→10））
    launchPriceBnb, currentVsLaunchPct, athVsLaunchPct, minVsLaunchPct, curVsMinGapPct, launchCovered,
    // 市值位置族（BP2：supply 缺失全族 null）
    mcapBnb, mcapPeakBnb, mcapFromPeakPct,
    // holder 流向族（BP2：tok 缺失全族 null）
    holdersNow, holdersDelta60,
    // 近窗族（W∈{30,60,120}：buyBnb/sellBnb/buyN/sellN/netBnb/buySharePct/
    // ticksPerMin/buyers/sellers/newBuyers）
    win,
    // 动能族
    top1BuyPct60, top1SellPct60, routerBuyPct60,
    halfTpmEarly, halfTpmLate, rateTrend, burst5In120,
    // 卖压族
    bigHolderSellBnb60, exitSellerCount60,
    // 活跃度锚族透传（BP13：cheatDerived 同名单点照抄——判读归 Jev activity_level 题）
    activity,
    // 筹码结构锚族透传（BP14：famous 控盘+持仓集中分层+参与/持有分叉——famous 判读
    // 归 market_pattern ③独食桶+互斥检查（famous_domination 题已随 BP49 退役）；
    // holder_concentration 题照旧、门桶由 mapper 硬消费）
    chip,
    // 开盘段结构族（BP18 盘面分类锚：首 30s 买入占比/大额单/后段密度——判读归
    // Jev market_pattern 题，strong_backer/retail_pvp 桶判据直接原料）
    openSeg,
    // famous 痕迹族（BP53 二修/案号 BP61：名单钱包时间线+在场性——③桶收割完臂/
    // 退出臂前提的证据行；roster 缺失整体 null）
    famousTraces,
  };
}

/**
 * DB 行集 → BuyPointSnapshot（纯函数；rows/tokenMeta/options 口径同
 * buildSnapshotFromRows——见 cheat-snapshot 头注）。options 额外：
 * - signalInfo：{ signalId, createdAt, firePriceBnb, strategyName }——买点信号
 *   溯源（state [ANCHOR] 渲染；runner 透传），可选
 * @returns {Object} { tokenMeta, anchor, capped, dtBase, ticks, wallets,
 *   cheatDerived, buyDerived, signalInfo }——cheatDerived=cheat 快照 derived 原样
 *   （背景事实不重算）；buyDerived=computeBuyPointDerived 产物
 */
function buildBuyPointSnapshot(rows, tokenMeta, options = {}) {
  const base = buildSnapshotFromRows(rows, tokenMeta, options);
  return {
    tokenMeta: base.tokenMeta,
    anchor: base.anchor,
    capped: base.capped,
    dtBase: base.dtBase,
    ticks: base.ticks,
    wallets: base.wallets,
    cheatDerived: base.derived,
    buyDerived: computeBuyPointDerived(base, options.famousRoster),
    signalInfo: options.signalInfo || null,
  };
}

module.exports = {
  buildBuyPointSnapshot,
  computeBuyPointDerived,
  bpTEndOf,
  bpInWin,
  BP_WINDOWS,
  BP_TOP_HOLDER_N,
  BP_BURST_SEC,
  BP_PRICE_BUCKETS,
  BP_SWING_THRESHOLD_PCT,
  BP_OPEN_SEG_SEC,
  BP_OPEN_BIG_BUY_BNB,
  BP_TAIL_SEC,
  detectSwings,
};
