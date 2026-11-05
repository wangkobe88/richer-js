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

const { buildSnapshotFromRows, isRouterWallet } = require('./cheat-snapshot');

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
 * 买点派生统计（纯函数；cheat snapshot 形状 → buyDerived）。
 * @param {Object} snapshot - buildSnapshotFromRows 产物（消费 ticks/wallets/derived）
 * @returns {Object} buyDerived（菜单见模块头注；win 嵌套 {30:{…},60:{…},120:{…}}）
 */
function computeBuyPointDerived(snapshot) {
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
  const chg30Pct = chgOf(30), chg60Pct = chgOf(60), chg120Pct = chgOf(120);
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

  // ── 发行价位置族（BP5/绝对价格高低维度锚）：launchPriceBnb=ticks 覆盖出生段时
  // 的全数组首个可靠价（非 outlier/price>0 最早行，链上真序 rel[0]）；出生覆盖
  // 判据=数组最早 dt ≤ BP_LAUNCH_COVER_TOL（首行贴近创建点=数组含出生段；锚窗
  // 截窗的长票不覆盖 → 全族 null fail-closed 截窗不冒充发行价）；
  // currentVsLaunchPct=末可靠价较发行价 %（可破发为负）──
  let launchPriceBnb = null, currentVsLaunchPct = null, launchCovered = null;
  if (rel.length >= 1) {
    const firstDt = dts.length ? Math.min(...dts) : null;
    launchCovered = tEnd !== null && firstDt !== null && firstDt <= BP_LAUNCH_COVER_TOL;
    if (launchCovered && arc && arc.last > 0 && rel[0].priceBnb > 0) {
      launchPriceBnb = +rel[0].priceBnb.toFixed(10);
      currentVsLaunchPct = +(((arc.last / launchPriceBnb) - 1) * 100).toFixed(1);
    }
  }

  return {
    // 时点位置
    tokenAgeSec, spanSec, currentVsAthPct, secSinceAth, madeHigh120,
    // 价格（可靠价口径）
    chg30Pct, chg60Pct, chg120Pct, priceBuckets,
    // 发行价位置族（BP5：截窗未覆盖出生段 → null 不冒充；launchCovered=覆盖判据观测键）
    launchPriceBnb, currentVsLaunchPct, launchCovered,
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
    buyDerived: computeBuyPointDerived(base),
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
};
