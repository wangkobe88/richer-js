/**
 * 作弊盘检测快照构建（CD1，2026-10-30）——纯函数，零 DB 零网络
 *
 * 单一组装路径：实时引擎（CheatCheckService）与离线回归工具（scripts/
 * cheat-detection/run.mjs）统一从 wss_price_ticks 拉行 → buildSnapshotFromRows
 * → CheatSnapshot → cheat-state-builder → Jev。两条路径同源 bit-identical，
 * FA 内存（tick 明细仅 5min 滑窗）不参与。
 *
 * 口径（与 FA/回测对齐的既定事实，勿改）：
 * - wallet = COALESCE(sender_address, trader_address)——FA :818 单点同款；
 *   sender 未解析（RPC 回查失败/溢出）时回退 trader，若 trader 又是聚合路由
 *   → 所有 GMGN 用户并成一个巨型伪钱包，故 derived 的 top1/top2 集中度
 *   **剔除 AGGREGATOR_ROUTER_ADDRS 命中的伪钱包**（不剔=向 cheat 方向系统性
 *   偏置），routerPct / unresolvedSenderTickCount 单列让 Jev 知道证据有洞
 * - 资金口径不滤 price_outlier/尘 tick（作弊检测看资金行为，对倒的钱照算）；
 *   priceArc 价格口径**仅 price_outlier=false 行**（尘价一笔打飞 ATH=假事实）
 * - bnb_amount 写入时已换算 BNB 域（flap quote 盘 collector :596 乘 conv.rate），
 *   读侧照抄不再换算；quote 盘换算失败行整行不入表=快照可能静默缺行（宁跳不
 *   冒充），等额簇跨汇率 TTL 刷新窗会碎裂——两洞在 state 侧声明为「近似」
 * - 等额簇口径=T74 evenCluster 同款：四位舍入 0.0001 BNB、桶 size≥3、
 *   ≥earlyUniformDustBnb（此处固定 0.001，快照层无 factorParams）
 * - 排序=链上真序 (block_number, log_index)（回测红线同款；行集由调用方
 *   排序/截窗后传入，本模块只做稳定重排不假设到达序）
 */

const { AGGREGATOR_ROUTER_ADDRS } = require('../trading-engine/pre-check/aggregator-routers');

/** 等额簇金额舍入粒度（0.0001 BNB，T74 口径） */
const EQUAL_AMOUNT_ROUND = 10000;
/** 等额簇最小金额门槛（BNB；earlyUniformDustBnb 快照层固定值） */
const EQUAL_AMOUNT_MIN_BNB = 0.001;
/** 同块簇最小笔数 */
const SAME_BLOCK_CLUSTER_MIN = 3;
/** 近等额带宽度（比例；D3.1 锚：精确等额刻意抖金额逃分组也落入同带） */
const EQUAL_BAND_PCT = 0.02;
/** 快进快出判定窗（秒）：首买→首卖 < 窗即计 churn */
const CHURN_WINDOW_SEC = 60;
/** 活跃度四档切点（笔/分钟；D3.2 用户裁定综合三因子——low/mid/high/ultra） */
const ACTIVITY_LOW_TPM = 15;
const ACTIVITY_HIGH_TPM = 70;
const ACTIVITY_ULTRA_TPM = 140;
/** 活跃度低档伴生线：笔均交易额尘级（BNB）与最长空窗（秒） */
const ACTIVITY_DUST_AVG_BNB = 0.05;
const ACTIVITY_LONG_GAP_SEC = 120;
/** 活跃度不均衡（CV）：30s 物理桶 tick 数变异系数；桶数不足=不可评 null */
const ACTIVITY_BUCKET_SEC = 30;
const ACTIVITY_CV_MIN_BUCKETS = 3;
const ACTIVITY_UNEVEN_CV = 1.0;
/**
 * burst 波强度滑窗宽度（G8 弱 burst 代码臂，2026-11-02 批次六 CD37/CD79 用户裁定
 * 「长期停滞突然涌入一波小流量，依然应该算低活跃度，但是如果涌入流量大，才能推翻
 * 低活跃度 结论」）：最密 BURST_WAVE_SEC 秒滑窗（按笔数取最密）内 Σ买入/独立钱包
 * 数=波强度两键；停滞深度第三维复用 maxGapSec（消费=grade E 通道代码臂）。
 */
const BURST_WAVE_SEC = 5;
/**
 * 著名钱包单极控盘锚（D3.2b，2026-10-31 用户裁定 CD5 语境：「描述盘面上单一著名
 * 钱包以及其跟单在持仓上占据主导的场景」，高/中/低三档）。名单=
 * config/rosters/famous-copy-wallets.json（FA famousCopyWalletCircPct 同源用户点名
 * 集合）；跟单窗=著名钱包某笔买入后 ≤60s 内完成首买（时间耦合跟随痕迹）。
 */
const FAMOUS_FOLLOW_WINDOW_SEC = 60;
/** 控盘三档切点（占正净持仓 %，先验起档——55 票分布校准后调整，D3.2 同流程） */
const FAMOUS_DOM_HIGH_PCT = 50;
const FAMOUS_DOM_MID_PCT = 25;

/** wallet 口径单点：sender 优先，回退 trader（FA :818 同款） */
function walletOf(row) {
  return row.sender_address || row.trader_address || null;
}

/** trader 层聚合路由判定（小写同域） */
function isRouterTrader(row) {
  const t = row.trader_address ? String(row.trader_address).toLowerCase() : null;
  return t !== null && AGGREGATOR_ROUTER_ADDRS.has(t);
}

/**
 * 著名钱包名单（famous-copy-wallets.json，FA famousCopyWalletCircPct 同源用户点名
 * 集合）——模块级缓存同步读（小文件；FA 侧为 async 惰性加载，本模块纯函数侧同步）。
 * 文件缺失/字段缺失/非数组 → null（缺证据，D3.1 锚 null 语义同向；FA 侧空集合
 * fail-open 是买门放行语义，此处 null=该轴不可评，语义不同刻意分叉）。
 * 测试可经 buildSnapshotFromRows options.famousRoster / computeDerived 第二参注入。
 */
let _famousRosterCache = undefined; // undefined=未加载；null=加载失败；Set=已加载
function loadFamousRoster() {
  if (_famousRosterCache !== undefined) return _famousRosterCache;
  try {
    // eslint-disable-next-line global-require
    const parsed = require('../../config/rosters/famous-copy-wallets.json');
    const arr = parsed && Array.isArray(parsed.wallets) ? parsed.wallets : null;
    _famousRosterCache = arr ? new Set(arr.map((w) => String(w).toLowerCase())) : null;
  } catch (e) {
    _famousRosterCache = null;
  }
  return _famousRosterCache;
}

/**
 * DB 行集 → CheatSnapshot（纯函数）。
 *
 * @param {Array<Object>} rows - wss_price_ticks 行（任意序；字段：trade_type/
 *   trader_address/sender_address/bnb_amount/price_bnb/price_outlier/
 *   block_number/log_index/block_time/token_amount——token_amount 供 D3.20 持仓
 *   集中双锚（缺列=锚 null fail-closed，不冒充）
 * @param {Object} tokenMeta - { address, symbol, name, platform, quoteToken,
 *   createdAt(iso), creatorAddress, totalSupply }（wss_events token_create payload；
 *   createdAt 缺失时 dt 基准退化为首 tick 并在 snapshot 标注；totalSupply 由调用方
 *   注入——four.meme=payload 真值、flap/gang=平台恒 1e9 常量（collector 同款），
 *   D3.20 supply 锚分母）
 * @param {Object} [options] - { capped, anchorTickCount, famousRoster }——capped=
 *   拉数满帽标记（service pull.capped / 回归 runner 锚窗未截断=false）透传 state
 *   [ANCHOR] 截断声明；anchorTickCount=**权威锚（tail 单查询返回行数）**，满帽时
 *   行集=head+tail 多于锚值，锚绝不能从 rows.length 反推（head 补充行不参与锚）；
 *   famousRoster=著名钱包名单 Set 注入口（单测用；缺省读 config 名单，见
 *   loadFamousRoster）
 * @returns {Object} CheatSnapshot { tokenMeta, anchor:{tickCount}, capped, ticks,
 *   wallets, derived }——anchor=单次查询返回行数（防 count/select 撕裂；缺省=
 *   行数，即未满帽时两者相等）
 */
function buildSnapshotFromRows(rows, tokenMeta, options = {}) {
  const sorted = [...(rows || [])].sort((a, b) => {
    const ba = a.block_number ?? 0, bb = b.block_number ?? 0;
    if (ba !== bb) return ba - bb;
    return (a.log_index ?? 0) - (b.log_index ?? 0);
  });

  const createdMs = tokenMeta && tokenMeta.createdAt ? Date.parse(tokenMeta.createdAt) : null;
  const baseMs = Number.isFinite(createdMs) ? createdMs
    : (sorted.length ? Date.parse(sorted[0].block_time) : null);
  const dtBase = Number.isFinite(createdMs) ? 'created' : 'first_tick';

  const ticks = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const ms = Date.parse(r.block_time);
    ticks.push({
      i,
      dt: Number.isFinite(ms) && baseMs !== null ? Math.round((ms - baseMs) / 1000) : null,
      side: r.trade_type === 'buy' ? 'BUY' : 'SELL',
      bnb: r.bnb_amount,
      // D3.20 持仓集中双锚原料：token 数量（与 totalSupply 同域；行缺列=null 容缺）
      tok: r.token_amount ?? null,
      priceBnb: r.price_bnb ?? null,
      wallet: walletOf(r),
      block: r.block_number ?? null,
      txHash: r.tx_hash ?? null, // D3.8 捆绑题原料：同一笔链上交易拆出的多行（state 渲染 tx= 前缀）
      viaRouter: isRouterTrader(r),
      outlier: r.price_outlier === true,
      senderMissing: !r.sender_address,
    });
  }

  const snapshot = {
    tokenMeta: { ...tokenMeta },
    anchor: { tickCount: Number.isFinite(options.anchorTickCount) ? options.anchorTickCount : ticks.length },
    capped: options.capped === true, // 拉数满帽：窗口≠全史，state [ANCHOR] 须声明
    dtBase, // 'created'=dt 相对创建秒；'first_tick'=createdAt 缺失退化为首 tick 基准（state 侧须声明）
    ticks,
    wallets: [],
    derived: null,
  };
  snapshot.wallets = aggregateWallets(snapshot.ticks, snapshot.tokenMeta);
  snapshot.derived = computeDerived(snapshot, options.famousRoster);
  return snapshot;
}

/**
 * 钱包聚合（全量行不滤 outlier——资金口径；伪钱包剔除见 walletOf 注）。
 * computeDerived 的 top1/top2 与 state builder 的 [WALLETS] 段共用本函数=口径单点。
 * @returns {Array<{w,buyBnb,buyN,sellBnb,sellN,firstBuyDt,firstSellDt,lastActDt,isCreator}>}
 *   按买入额降序
 */
function aggregateWallets(ticks, tokenMeta) {
  const byWallet = new Map();
  for (const t of ticks || []) {
    if (!t.wallet) continue;          // 无钱包行计量不计人
    if (isRouterWallet(t.wallet)) continue; // 伪钱包不进 wallets（见 walletOf 注）
    let e = byWallet.get(t.wallet);
    if (!e) { e = { w: t.wallet, buyBnb: 0, buyN: 0, sellBnb: 0, sellN: 0, buyTok: 0, sellTok: 0, firstBuyDt: null, firstSellDt: null, lastActDt: null, isCreator: false }; byWallet.set(t.wallet, e); }
    const isBuy = t.side === 'BUY';
    const bnb = t.bnb || 0;
    const tok = t.tok || 0; // D3.20：token 数累计（行缺列按 0 容缺——锚在缺列数据上失真时 fail-closed 于键层）
    if (isBuy) { e.buyBnb += bnb; e.buyN++; e.buyTok += tok; if (e.firstBuyDt === null) e.firstBuyDt = t.dt; }
    else { e.sellBnb += bnb; e.sellN++; e.sellTok += tok; if (e.firstSellDt === null) e.firstSellDt = t.dt; }
    if (t.dt !== null && t.dt !== undefined && (e.lastActDt === null || t.dt > e.lastActDt)) e.lastActDt = t.dt;
  }
  const creator = tokenMeta && tokenMeta.creatorAddress
    ? String(tokenMeta.creatorAddress).toLowerCase() : null;
  return [...byWallet.values()]
    .map((e) => ({ ...e, isCreator: creator !== null && e.w.toLowerCase() === creator }))
    .sort((a, b) => b.buyBnb - a.buyBnb);
}

/**
 * 派生统计（纯函数，从 ticks 单点计算=口径唯一；公式由
 * _test_cheat_detection_lib.cjs 用 ZERODAY 66-tick 事故现场锁定）。
 *
 * @param {Object} snapshot - 仅消费其 ticks（wallets 由本函数产出原料）
 * @param {Set<string>|undefined|null} [famousRoster] - 著名钱包名单注入（单测用）；
 *   undefined=读 config 名单（loadFamousRoster），null=模拟名单缺失（null 语义臂）
 * @returns {Object} derived
 */
function computeDerived(snapshot, famousRoster) {
  const roster = famousRoster !== undefined ? famousRoster : loadFamousRoster();
  const ticks = snapshot.ticks || [];

  // ── 全量行计量（不滤 outlier——资金口径；伪钱包剔除只影响 wallets/集中度）──
  let totalBuyBnb = 0, totalSellBnb = 0, buyN = 0, sellN = 0;
  let routerBuyBnb = 0, routerBuyN = 0, unresolvedSenderTickCount = 0;
  for (const t of ticks) {
    const isBuy = t.side === 'BUY';
    const bnb = t.bnb || 0;
    if (isBuy) { totalBuyBnb += bnb; buyN++; } else { totalSellBnb += bnb; sellN++; }
    if (t.viaRouter && isBuy) { routerBuyBnb += bnb; routerBuyN++; }
    if (t.senderMissing) unresolvedSenderTickCount++; // 证据洞计数（全量行，含被剔伪钱包行）
  }

  // 钱包聚合单点（[WALLETS] 段与集中度同源；buildSnapshotFromRows 已回填则复用）
  const wallets = snapshot.wallets && snapshot.wallets.length ? snapshot.wallets
    : aggregateWallets(ticks, snapshot.tokenMeta);

  // ── 集中度（剔除 router 伪钱包后的买入 top1/top2 占总买）──
  const top1BuyPct = totalBuyBnb > 0 && wallets.length ? (wallets[0].buyBnb / totalBuyBnb) * 100 : null;
  const top2BuyPct = totalBuyBnb > 0 && wallets.length > 1
    ? ((wallets[0].buyBnb + wallets[1].buyBnb) / totalBuyBnb) * 100 : null;

  // ── routerPct：Σ(router 行买入 BNB) ÷ Σ买入 ×100（T70 tradesRouterPct 同口径）──
  const routerPct = totalBuyBnb > 0 ? (routerBuyBnb / totalBuyBnb) * 100 : null;

  // ── 快进快出：首买→首卖间隔 < CHURN_WINDOW_SEC 的钱包数 ──
  let churn60sWalletCount = 0;
  for (const e of wallets) {
    if (e.firstBuyDt === null || e.firstSellDt === null) continue;
    if (e.firstSellDt - e.firstBuyDt < CHURN_WINDOW_SEC) churn60sWalletCount++;
  }

  // ── 零买入纯卖方锚（G8 K/L 通道，2026-11-02 批次六 CD5 用户裁定「创建者已经
  // 卖了，而且应该是通过代币转入的方式卖的，你检查下，这也是一个明显的作弊行为」
  // ——链上实锤=创建块同块 Transfer(from=creator) 7 笔 ≈3.18 亿 token 分光、6 接收
  // 户零买入同块各卖一笔 Σ2.09 BNB 占锚窗总卖 45%）：Transfer 事件不在 collector
  // 订阅范围，分仓接收户在 swap 域只呈现「无买入来源的卖方」形状，本锚=该形状的
  // 代码量化——零买入纯卖出钱包（buyBnb=0 ∧ sellBnb>0）合计卖出占全窗总卖 %。
  // wallet 口径=wallets 聚合单点（router 伪钱包已剔——未解析 GMGN 行并包成巨型
  // 纯卖方会虚增分子，剔除=保守方向）；总卖=0 → null（无卖出证据不评）。
  // 定线（tmp-nobuysell-calibrate@182 128 票）：≥40 触发 14 票（13 人工
  // cheat/unhealthy+1 unclear）零误伤 healthy；30 线误伤 CD45(37.7) 挡住下探；
  // insider 联立 ≥25（∧ insider moderate/strong）五票全对、CD60（insider strong
  // 人工 healthy、纯卖 24.8）恰被排除——消费见 cheat-grade K/L 通道。──
  let noBuySellBnb = 0, noBuySellWallets = 0;
  for (const e of wallets) {
    if ((e.buyBnb || 0) > 0) continue;
    const sell = e.sellBnb || 0;
    if (sell > 0) { noBuySellBnb += sell; noBuySellWallets++; }
  }
  const noBuySellPct = totalSellBnb > 0 ? +((noBuySellBnb / totalSellBnb) * 100).toFixed(1) : null;

  // ── 同块买入簇（≥SAME_BLOCK_CLUSTER_MIN 笔买同块）──
  const blockBuys = new Map();
  for (const t of ticks) {
    if (t.side !== 'BUY' || t.block === null) continue;
    if (!blockBuys.has(t.block)) blockBuys.set(t.block, []);
    blockBuys.get(t.block).push(t);
  }
  const sameBlockClusters = [...blockBuys.entries()]
    .filter(([, a]) => a.length >= SAME_BLOCK_CLUSTER_MIN)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([block, a]) => ({
      block,
      n: a.length,
      wallets: new Set(a.map((t) => t.wallet)).size,
      sumBnb: a.reduce((s, t) => s + (t.bnb || 0), 0),
      firstDt: a[0].dt,
    }));

  // ── 等额买入簇（四位舍入同额 ≥3 且 ≥EQUAL_AMOUNT_MIN_BNB；T74 口径）──
  const evenBuckets = new Map();
  for (const t of ticks) {
    if (t.side !== 'BUY') continue;
    const bnb = t.bnb || 0;
    if (bnb < EQUAL_AMOUNT_MIN_BNB) continue;
    const k = Math.round(bnb * EQUAL_AMOUNT_ROUND);
    if (!evenBuckets.has(k)) evenBuckets.set(k, []);
    evenBuckets.get(k).push(t);
  }
  const equalClusters = [...evenBuckets.entries()]
    .filter(([, a]) => a.length >= SAME_BLOCK_CLUSTER_MIN)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([k, a]) => ({
      amt: k / EQUAL_AMOUNT_ROUND,
      n: a.length,
      wallets: new Set(a.map((t) => t.wallet)).size,
      firstDt: a[0].dt,
    }));

  // ── 持仓占比锚（D3.1：买侧簇结构的代码侧量化）──
  // D3.0 实测 Jev 眼估「流量份额」类现象（同块/等额/配额梯 moderate 档）在 55 票全
  // 饱和零分离——占比数字必须代码算。口径（T91a 哲学）：
  //   分母=全场 Σ正净持仓（router 伪钱包已在 wallets 层剔除）；分子=簇成员正净持仓
  //   合计（⊆分母恒 ≤100）；分母 0（无人正净持仓）→ null（无可主导的持仓）。
  //   sameBlockHoldPct =「≥3 笔买同块」全部块（不截 top10 展示帽）的买入钱包去重并集
  //   equalBandHoldPct = ±2% 对数金额带（带内 ≥3 个不同钱包；精确等额自然落同带）
  //   null=无合格簇（有证据的缺席，进 [PRECOMPUTED] 与 mapper 锚臂）
  const posNet = new Map();
  for (const e of wallets) {
    const net = (e.buyBnb || 0) - (e.sellBnb || 0);
    if (net > 0) posNet.set(e.w, net);
  }
  const posTotal = [...posNet.values()].reduce((s, v) => s + v, 0);
  const holdPctOf = (memberSet) => {
    if (!memberSet.size || posTotal <= 0) return null;
    let m = 0;
    for (const w of memberSet) m += posNet.get(w) || 0;
    return (m / posTotal) * 100;
  };
  const sbMembers = new Set();
  for (const [block, arr] of blockBuys) {
    if (arr.length >= SAME_BLOCK_CLUSTER_MIN) {
      for (const t of arr) if (t.wallet) sbMembers.add(t.wallet);
    }
  }
  const sameBlockHoldPct = holdPctOf(sbMembers);
  const bandBase = Math.log(1 + EQUAL_BAND_PCT);
  const bands = new Map();
  for (const t of ticks) {
    if (t.side !== 'BUY' || !t.wallet) continue;
    const bnb = t.bnb || 0;
    if (bnb < EQUAL_AMOUNT_MIN_BNB) continue;
    const k = Math.round(Math.log(bnb) / bandBase);
    if (!bands.has(k)) bands.set(k, new Set());
    bands.get(k).add(t.wallet);
  }
  const eqMembers = new Set();
  for (const ws of bands.values()) {
    if (ws.size >= SAME_BLOCK_CLUSTER_MIN) for (const w of ws) eqMembers.add(w);
  }
  const equalBandHoldPct = holdPctOf(eqMembers);

  // ── 组织买入占比锚（G6 豁免前提，2026-11-02 用户补充裁定「著名/绑定钱包的
  // 豁免还是要有一个前提，就是它们砸跑了是砸跑了，但是盘面正常用户流量涌入
  // 依然要比较明显，否则如果整个盘面全部是它们的砸盘，盘子也死了」）──
  // 买侧承接视角：豁免形状里组织方在撤退，卖侧占比高是必然；健康与否的区分度
  // 在正常用户有没有在买。分母=全量行总买（router 伪钱包行=GMGN 散户聚合买入
  // 计入「正常用户」侧）；分子=组织成员买入合计（wallets 层聚合）：
  //   bundleBuyPct      = sb∪eq 簇成员买入合计 ÷ Σ买 ×100（G 通道豁免前提）
  //   famousGroupBuyPct = famous∪跟单 买入合计 ÷ Σ买 ×100（D 通道豁免前提）
  // 组织成员集空（无合格簇/无著名命中）/Σ买≤0 → null（有证据的缺席）；豁免层
  // null → 不豁免 fail-closed（无承接证据不给豁免，与 sbw null 同哲学）。
  const buyOf = new Map(wallets.map((e) => [e.w, e.buyBnb || 0]));
  const sumBuyOf = (memberSet) => {
    let s = 0;
    for (const w of memberSet) s += buyOf.get(w) || 0;
    return s;
  };
  const bundleMembers = new Set([...sbMembers, ...eqMembers]);
  const bundleBuyPct = bundleMembers.size > 0 && totalBuyBnb > 0
    ? +((sumBuyOf(bundleMembers) / totalBuyBnb) * 100).toFixed(1) : null;

  // ── 同块卖→买等额对敲锚（D3.28，2026-11-01 用户裁定 CD27 语境「对倒交易非常
  // 严重，如有必要可能需要增加锚」）：同一 block 内一笔 SELL 与一笔 BUY 金额落
  // ±2% 对数带（与 eqHold 同带宽，精确等额自然落带）配对，每笔卖出至多配一次
  // （splice 防重配）；配对数与配对额为「左手换右手」对倒换手的直接度量。
  // CD27 实证形状=对内等额、对外不等额（9 轮买回金额互相各异）→ 等额簇/同块
  // 买入波锚均失明，本锚为唯一载体。128 票锚窗分布（tmp-wash-pair-dist@182）：
  // 126 票零配对、唯一 ≥3 对票 CD27 卖占 95.1%（断层稀有，自然发生率≈0）。
  // 尘门下限对齐 EQUAL_AMOUNT_MIN_BNB；无配对（count=0）→ 三键全 null
  // （D3.1「有证据的缺席」同语义：该轴不适用，非 0%）。
  let washPairCount = null, washPairSellPct = null, washPairBuyPct = null;
  {
    const washBand = Math.log(1 + EQUAL_BAND_PCT);
    const blks = new Map();
    for (const t of ticks) {
      if (t.block === null) continue;
      if ((t.bnb || 0) < EQUAL_AMOUNT_MIN_BNB) continue;
      const o = blks.get(t.block) || { sells: [], buys: [] };
      o[t.side === 'BUY' ? 'buys' : 'sells'].push(t);
      blks.set(t.block, o);
    }
    let pairN = 0, pairBnb = 0;
    for (const [, o] of blks) {
      const sells = [...o.sells];
      for (const b of o.buys) {
        const si = sells.findIndex((s) => Math.abs(Math.log((b.bnb || 0) / (s.bnb || 1))) <= washBand);
        if (si >= 0) { sells.splice(si, 1); pairN++; pairBnb += b.bnb || 0; }
      }
    }
    if (pairN > 0) {
      washPairCount = pairN;
      washPairSellPct = totalSellBnb > 0 ? (pairBnb / totalSellBnb) * 100 : null;
      washPairBuyPct = totalBuyBnb > 0 ? (pairBnb / totalBuyBnb) * 100 : null;
    }
  }

  // ── 单一钱包持仓集中双锚（D3.20，2026-11-01 用户裁定 CD69 语境：「持仓极不
  // 均衡，一个钱包持有总额度占比过大肯定不行；合理评判=看占总供应量的大小、也看
  // 占总流通量的大小，前者低后者高可以豁免」）──
  // 口径（token 数域，与 totalSupply 同域——D3.1 簇占比锚是 BNB 域，两域并存勿混）：
  //   分子 = top1 正净 token 持仓（buyTok−sellTok 取最大者；router 伪钱包已剔）
  //   top1HoldSupplyPct = 分子 ÷ meta.totalSupply ×100（totalSupply 缺失/≤0 → null
  //                       fail-closed 绝不以常数冒充——flap/gang 恒 1e9 由调用方注入）
  //   top1HoldCircPct   = 分子 ÷ Σ正净 token 持仓 ×100（在场流通=T91a Σ正净同哲学；
  //                       Σ=0 → null）
  //   豁免判读（题面/锚行教 Jev）：supply 低 + circ 高 ⟺ 在场筹码少（Σ正净 <<
  //   totalSupply）→ top1 占场内比例天然大，不算控盘；两键同分子异分母，差异
  //   全部来自「多少筹码不在场」，比较严格成立。
  const posNetTok = new Map();
  for (const e of wallets) {
    const netTok = (e.buyTok || 0) - (e.sellTok || 0);
    if (netTok > 0) posNetTok.set(e.w, netTok);
  }
  const posTokTotal = [...posNetTok.values()].reduce((s, v) => s + v, 0);
  // D3.32 持仓分布按正净 token 降序取前二/前三（与 D3.20 top1 同域同分母）
  const posSorted = [...posNetTok.entries()].sort((a, b) => b[1] - a[1]);
  const top1NetTok = posSorted.length > 0 ? posSorted[0][1] : 0;
  const top2NetTok = posSorted.length > 1 ? posSorted[1][1] : 0;
  const metaForSupply = snapshot.tokenMeta || {};
  const totalSupply = Number(metaForSupply.totalSupply) > 0 ? Number(metaForSupply.totalSupply) : null;
  const top1HoldSupplyPct = totalSupply !== null && top1NetTok > 0 ? (top1NetTok / totalSupply) * 100 : null;
  const top1HoldCircPct = posTokTotal > 0 && top1NetTok > 0 ? (top1NetTok / posTokTotal) * 100 : null;

  // ── 持仓分布锚族（D3.32，2026-11-02 批次五 CD122 用户裁定「给 Jev 增加持仓
  // 均衡门吧。注意总供应量占比最重要，第二 CD122 的 top2 不是单一钱包，而是
  // 捆绑簇。需要利用 Jev 的能力处理复杂情况」——单锚硬线（top2≥N∧紧邻）128 票
  // 仅 2 例支撑过拟合，组合形状（大户+簇+首买时序+快进快出）交 Jev 综合判档）──
  // 口径（token 数域 ÷ totalSupply，与 D3.20 双锚同域）：
  //   top2HoldSupplyPct        = 第二大正净持仓 ÷ totalSupply ×100（<2 正净持有人
  //                              → null：无第二大户=该轴不适用，与 D3.28 零配对
  //                              同「有证据的缺席」语义）
  //   top1Top2HoldSupplyPct    = 前二合计 ÷ totalSupply ×100（同上 null 语义）
  //   top1Top2FirstBuyGapSec   = 前二首买时间差绝对值（dt 域秒；任一 firstBuyDt
  //                              缺失 → null）
  //   clusterHoldSupplyPct     = sb∪eq 簇成员正净合计 ÷ totalSupply ×100（sbHold
  //                              是在场流通分母——本键给总量分母版；无合格簇 null）
  //   holdingsProfile          = 前三钱包行为摘要（state 叙事原料：净持/占总量%/
  //                              买卖笔额/首买块/首卖距首买秒——行为叙事 Jev 综合用，
  //                              不进数值锚键）
  const top2HoldSupplyPct = totalSupply !== null && top2NetTok > 0 ? (top2NetTok / totalSupply) * 100 : null;
  const top1Top2HoldSupplyPct = totalSupply !== null && top2NetTok > 0
    ? ((top1NetTok + top2NetTok) / totalSupply) * 100 : null;
  const walletOf = new Map(wallets.map((e) => [e.w, e]));
  let top1Top2FirstBuyGapSec = null;
  {
    const w1 = posSorted.length > 0 ? walletOf.get(posSorted[0][0]) : null;
    const w2 = posSorted.length > 1 ? walletOf.get(posSorted[1][0]) : null;
    if (w1 && w2 && w1.firstBuyDt !== null && w1.firstBuyDt !== undefined
      && w2.firstBuyDt !== null && w2.firstBuyDt !== undefined) {
      top1Top2FirstBuyGapSec = Math.abs(w1.firstBuyDt - w2.firstBuyDt);
    }
  }
  let clusterHoldSupplyPct = null;
  if (totalSupply !== null && bundleMembers.size > 0) {
    let m = 0;
    for (const w of bundleMembers) m += posNetTok.get(w) || 0;
    if (m > 0) clusterHoldSupplyPct = (m / totalSupply) * 100;
  }
  // 第1大∪簇并集合计占总供应（CD122 形状主锚：单大户+捆绑簇组合垄断度——组合
  // 数值代码算好，Jev 心算不可靠 D3.29 教训；簇缺席（<3 笔不成簇）=并集轴缺席
  // null——退化成 top1 自身会与单一口径重复且无组合语义）
  let t1PlusClusterSupplyPct = null;
  if (totalSupply !== null && bundleMembers.size > 0 && posSorted.length > 0) {
    const t1W = posSorted[0][0];
    let m = top1NetTok;
    for (const w of bundleMembers) if (w !== t1W) m += posNetTok.get(w) || 0;
    t1PlusClusterSupplyPct = (m / totalSupply) * 100;
  }
  const firstBuyBlockOf = new Map();
  for (const t of ticks) {
    if (t.side !== 'BUY' || !t.wallet) continue;
    if (!firstBuyBlockOf.has(t.wallet)) firstBuyBlockOf.set(t.wallet, t.block);
  }
  const holdingsProfile = posSorted.slice(0, 3).map(([w, netTok]) => {
    const e = walletOf.get(w) || {};
    return {
      w,
      netTok,
      supplyPct: totalSupply !== null ? (netTok / totalSupply) * 100 : null,
      buyBnb: e.buyBnb || 0, buyN: e.buyN || 0,
      sellBnb: e.sellBnb || 0, sellN: e.sellN || 0,
      firstBuyDt: e.firstBuyDt ?? null, firstSellDt: e.firstSellDt ?? null,
      firstBuyBlock: firstBuyBlockOf.get(w) ?? null,
    };
  });

  // ── 著名钱包单极控盘锚（D3.2b 用户裁定 2026-10-31 CD5 语境：「描述盘面上单一
  // 著名钱包以及其跟单在持仓上占据主导的场景」，高/中/低三档；mapper 消费方式
  // 待裁定同 D3.2）──
  // 口径（复用 posNet/posTotal 分母，T91a 哲学同 D3.1）：
  //   famous 集 = wallets ∩ famous-copy-wallets 名单（任意活动命中即算——只卖不买
  //              的著名钱包 posNet 非正自然不计持仓，其在场=该轴适用）
  //   跟单集   = 非 famous 钱包中，首 BUY 落在某笔 famous BUY 同秒或其后
  //              ≤FAMOUS_FOLLOW_WINDOW_SEC 秒内（首买=此前无买入；dt 缺失不入选）
  //   famousDominancePct =（famous Σ + 跟单 Σ）正净持仓 ÷ posTotal×100（⊆分母恒 ≤100）
  //   三档：high ≥FAMOUS_DOM_HIGH_PCT / mid ≥FAMOUS_DOM_MID_PCT / low 其余
  //   null=名单缺失（缺证据）∨ 窗内无著名钱包命中（该轴不适用）∨ posTotal≤0
  //   （无可主导持仓）——D3.1「有证据的缺席」同语义
  let famousHoldPct = null, famousTop1Pct = null, famousFollowerPct = null;
  let famousDominancePct = null, famousDominanceLevel = null;
  let famousFollowerTop3Pct = null;
  let famousGroupBuyPct = null;
  if (roster && roster.size > 0 && posTotal > 0) {
    const famousInWin = wallets.filter((e) => roster.has(e.w.toLowerCase()));
    if (famousInWin.length > 0) {
      let fSum = 0, fTop1 = 0;
      for (const e of famousInWin) {
        const net = posNet.get(e.w) || 0;
        fSum += net;
        if (net > fTop1) fTop1 = net;
      }
      const famousBuyDts = ticks
        .filter((t) => t.side === 'BUY' && t.dt !== null && t.wallet
          && roster.has(t.wallet.toLowerCase()))
        .map((t) => t.dt);
      const followers = new Set();
      for (const e of wallets) {
        if (roster.has(e.w.toLowerCase())) continue;
        if (e.firstBuyDt === null || e.firstBuyDt === undefined) continue;
        for (const fd of famousBuyDts) {
          if (e.firstBuyDt >= fd && e.firstBuyDt - fd <= FAMOUS_FOLLOW_WINDOW_SEC) {
            followers.add(e.w);
            break;
          }
        }
      }
      let folSum = 0;
      for (const w of followers) folSum += posNet.get(w) || 0;
      // G5 跟单集中度锚（2026-11-02 批次四用户裁定「它们的跟单量是不是高估了？因为
      // 聪明钱的跟单一定程度也不算完全不健康的」+「也不能把所有的后续买入全看成
      // famous 的跟单」——dom=high 16 票研究：跟单窗 60s 覆盖买家数中位 80%+，分子
      // 主体是跟单者而非 famous 本人（本人持中位 ~10%）；跟单 top3 合计占跟单正净
      // Σ <45%=分散形（几十个散户小额跟进、最大单钱包 <10%）→ D 通道豁免，≥45%
      // =集中形（少数大户贴身重仓，疑似分仓/协同）→ 维持触发。分母=跟单正净持仓
      // 合计（负净持仓钱包不计入，防 top3/Σ>100）；无跟单/跟单正净 Σ=0 → null
      // （无跟单时 dom 分子全靠 famous 本人=直接控盘，通道层 null → 触发不豁免）
      if (followers.size > 0) {
        const folPosNets = [...followers]
          .map((w) => Math.max(posNet.get(w) || 0, 0))
          .sort((a, b) => b - a);
        const folPosSum = folPosNets.reduce((s, v) => s + v, 0);
        if (folPosSum > 0) {
          famousFollowerTop3Pct = +((folPosNets.slice(0, 3).reduce((s, v) => s + v, 0) / folPosSum) * 100).toFixed(1);
        }
      }
      // G6 D 通道豁免前提锚（用户补充裁定，见 sb/eq 段 G6 注）：famous∪跟单买入
      // 合计占锚窗总买 %——组织买入 ≥80%（正常用户承接不足两成）=「整个盘面
      // 全部是它们的」死盘形状，豁免不成立。dom=high 前提下 famousInWin 非空，
      // 此处必产出数值（null 仅旧档断代/Σ买=0）
      famousGroupBuyPct = totalBuyBnb > 0
        ? +((sumBuyOf(new Set([...famousInWin.map((e) => e.w), ...followers])) / totalBuyBnb) * 100).toFixed(1)
        : null;
      famousHoldPct = +((fSum / posTotal) * 100).toFixed(1);
      famousTop1Pct = +((fTop1 / posTotal) * 100).toFixed(1);
      famousFollowerPct = +((folSum / posTotal) * 100).toFixed(1);
      famousDominancePct = +(((fSum + folSum) / posTotal) * 100).toFixed(1);
      famousDominanceLevel = famousDominancePct >= FAMOUS_DOM_HIGH_PCT ? 'high'
        : famousDominancePct >= FAMOUS_DOM_MID_PCT ? 'mid' : 'low';
    }
  }

  // ── 活跃度锚（D3.2 用户裁定：「增加活跃度低的锚，分超高/高/中/低四档」「综合考虑
  // 交易额/空窗期」「另给活跃度不均衡结论=高低起伏很大」；mapper 消费方式待裁定）──
  // 三因子：密度 ticksPerMin（笔/分钟）· 笔均交易额 avgTradeBnb（资金口径全量行）·
  // 最长空窗 maxGapSec（相邻 tick 最大间隔）。四档判定序（每条独立可调）：
  //   low   = 长空窗 ≥ACTIVITY_LONG_GAP_SEC ∨ 密度 <ACTIVITY_LOW_TPM ∨ 笔均 <ACTIVITY_DUST_AVG_BNB
  //   ultra = 密度 ≥ACTIVITY_ULTRA_TPM（对倒级机器节奏）
  //   high  = 密度 ≥ACTIVITY_HIGH_TPM；其余 mid
  // 切点=55 票锚窗实测（tmp-d32-activity@182）：长空窗 >120s 全场 3 票（低活跃
  // unhealthy 子形状 CD7/CD37 + CD17 反例）；超高档 11 票=7 cheat+4 unhealthy+0
  // healthy；笔均 <0.05 全场仅 CD3/CD44（低活跃 unhealthy / 慢速吸筹 cheat）。
  // 不均衡 activityCv=锚窗 30s 物理桶 tick 数变异系数 std/mean（burst+断流起伏→大）；
  // 桶数 <ACTIVITY_CV_MIN_BUCKETS → null（不可评）。dt 缺失全族 null（绝不冒充）。
  const dts = ticks.map((t) => t.dt).filter((v) => v !== null && v !== undefined);
  let ticksPerMin = null, avgTradeBnb = null, maxGapSec = null;
  let activityLevel = null, activityCv = null, activityUneven = null;
  if (dts.length >= 2) {
    const spanSec = Math.max(1, dts[dts.length - 1] - dts[0]);
    ticksPerMin = +((dts.length / spanSec) * 60).toFixed(2);
    for (let i = 1; i < dts.length; i++) {
      const g = dts[i] - dts[i - 1];
      if (g > maxGapSec) maxGapSec = g;
    }
    avgTradeBnb = +((totalBuyBnb + totalSellBnb) / ticks.length).toFixed(4);
    if (maxGapSec >= ACTIVITY_LONG_GAP_SEC || ticksPerMin < ACTIVITY_LOW_TPM || avgTradeBnb < ACTIVITY_DUST_AVG_BNB) {
      activityLevel = 'low';
    } else if (ticksPerMin >= ACTIVITY_ULTRA_TPM) {
      activityLevel = 'ultra';
    } else if (ticksPerMin >= ACTIVITY_HIGH_TPM) {
      activityLevel = 'high';
    } else {
      activityLevel = 'mid';
    }
    const bucketN = Math.ceil(spanSec / ACTIVITY_BUCKET_SEC);
    if (bucketN >= ACTIVITY_CV_MIN_BUCKETS) {
      const cnt = new Array(bucketN).fill(0);
      for (const dt of dts) {
        cnt[Math.min(bucketN - 1, Math.floor((dt - dts[0]) / ACTIVITY_BUCKET_SEC))]++;
      }
      const mean = dts.length / bucketN;
      const std = Math.sqrt(cnt.reduce((s, v) => s + (v - mean) ** 2, 0) / bucketN);
      activityCv = +(std / mean).toFixed(2);
      activityUneven = activityCv >= ACTIVITY_UNEVEN_CV;
    }
  }

  // ── burst 波强度两键（G8 弱 burst 代码臂，头注见 BURST_WAVE_SEC）：定线研究
  // （tmp-burst-strength@182 17 票 sbw=burst）——豁免挡住的全是自己人（14 票 Jev
  // act 已判 low），豁免资格须由波强度承接；人工 healthy 4 票中 3 票 maxGap 仅
  // 19~43s（无停滞=开盘密集正常形状）→ 停滞深度是必要第三维（复用 maxGapSec，
  // grade 侧锚名 burstMaxGapSec）。算法=最密 BURST_WAVE_SEC 秒滑窗双指针（按窗内
  // 笔数取最密），窗内钱包计数 map 精确去重（同钱包多笔逐出时不误删）；dt 缺失
  // 全族 null（绝不冒充）；<2 有效 dt 行波形状不可评同 null。──
  let burstWaveBuyBnb = null, burstWaveWallets = null;
  const waveTicks = ticks.filter((t) => t.dt !== null && t.dt !== undefined);
  if (waveTicks.length >= 2) {
    let j = 0, curN = 0, curBuy = 0, bestN = 0, bestBuy = 0, bestWalletN = 0;
    const curWallets = new Map(); // wallet → 窗内笔数
    for (let i = 0; i < waveTicks.length; i++) {
      const t = waveTicks[i];
      curN++;
      if (t.side === 'BUY') curBuy += t.bnb || 0;
      if (t.wallet) curWallets.set(t.wallet, (curWallets.get(t.wallet) || 0) + 1);
      while (t.dt - waveTicks[j].dt > BURST_WAVE_SEC) {
        const u = waveTicks[j];
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
    burstWaveBuyBnb = +bestBuy.toFixed(4);
    burstWaveWallets = bestWalletN;
  }

  // ── 价格拱（仅 price_outlier=false 行——价格口径滤，资金口径不滤）──
  let first = null, ath = null, athDt = null, last = null;
  for (const t of ticks) {
    if (t.outlier || t.priceBnb === null || t.priceBnb === undefined) continue;
    if (first === null) first = t.priceBnb;
    if (ath === null || t.priceBnb > ath) { ath = t.priceBnb; athDt = t.dt; }
    last = t.priceBnb;
  }

  return {
    totalBuyBnb, totalSellBnb, buyN, sellN,
    walletCount: wallets.length,
    top1BuyPct, top2BuyPct,
    routerPct, routerBuyN,
    unresolvedSenderTickCount,
    churn60sWalletCount,
    sameBlockClusters, equalClusters,
    sameBlockHoldPct, equalBandHoldPct, bundleBuyPct,
    washPairCount, washPairSellPct, washPairBuyPct,
    top1HoldSupplyPct, top1HoldCircPct,
    top2HoldSupplyPct, top1Top2HoldSupplyPct, top1Top2FirstBuyGapSec,
    clusterHoldSupplyPct, t1PlusClusterSupplyPct, holdingsProfile,
    famousHoldPct, famousTop1Pct, famousFollowerPct, famousDominancePct, famousDominanceLevel, famousFollowerTop3Pct, famousGroupBuyPct,
    ticksPerMin, avgTradeBnb, maxGapSec,
    burstWaveBuyBnb, burstWaveWallets,
    noBuySellPct, noBuySellBnb, noBuySellWallets,
    activityLevel, activityCv, activityUneven,
    priceArc: first !== null ? { first, ath, athDt, last } : null,
  };
}

/** 伪钱包判定（wallet 命中聚合路由地址——未解析 sender 的 GMGN 行回退产物） */
function isRouterWallet(wallet) {
  return wallet !== null && AGGREGATOR_ROUTER_ADDRS.has(String(wallet).toLowerCase());
}

module.exports = {
  buildSnapshotFromRows,
  computeDerived,
  aggregateWallets,
  walletOf,
  isRouterWallet,
  loadFamousRoster,
  EQUAL_AMOUNT_MIN_BNB,
  EQUAL_BAND_PCT,
  SAME_BLOCK_CLUSTER_MIN,
  CHURN_WINDOW_SEC,
  FAMOUS_FOLLOW_WINDOW_SEC,
  FAMOUS_DOM_HIGH_PCT,
  FAMOUS_DOM_MID_PCT,
  ACTIVITY_LOW_TPM,
  ACTIVITY_HIGH_TPM,
  ACTIVITY_ULTRA_TPM,
  ACTIVITY_DUST_AVG_BNB,
  ACTIVITY_LONG_GAP_SEC,
  ACTIVITY_BUCKET_SEC,
  ACTIVITY_CV_MIN_BUCKETS,
  ACTIVITY_UNEVEN_CV,
};
