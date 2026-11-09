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
const { resolveLaunchPriceBnb } = require('./launch-price');

/** 等额簇金额舍入粒度（0.0001 BNB，T74 口径） */
const EQUAL_AMOUNT_ROUND = 10000;
/** 等额簇最小金额门槛（BNB；earlyUniformDustBnb 快照层固定值） */
const EQUAL_AMOUNT_MIN_BNB = 0.001;
/** 同块簇最小笔数 */
const SAME_BLOCK_CLUSTER_MIN = 3;
/** 精确等额同块簇最小钱包数（D3.53：两钱包成对也是「挤入」形状，与同块簇 ≥3 笔口径刻意不同） */
const EXACT_EQUAL_BLOCK_MIN_WALLETS = 2;
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
// D3.49 无交易期占比静默段门槛：间隔 ≥此值才算「完全静默段」（题①操作化）。
const ACTIVITY_IDLE_GAP_SEC = 20;
/** 活跃度不均衡（CV）：30s 物理桶 tick 数变异系数；桶数不足=不可评 null */
const ACTIVITY_BUCKET_SEC = 30;
const ACTIVITY_CV_MIN_BUCKETS = 3;
const ACTIVITY_UNEVEN_CV = 1.0;
// D3.59（CD184）临近买点段窗口长（秒）：锚窗末端固定 30s（BSC 0.75s 出块≈40 块）。
// 「开盘密集→临近只剩尘单滴答」形状里尘单不断打破时间静默，idlePct/maxGap 对临近
// 死盘失明，须段内中位/吞吐单独度量；spanSec ≤本值不出临近段（临近=全窗无对比
// 语义，极短窗另有 act ④极早窗豁免臂管）。
const NEAR_SEG_SEC = 30;
/**
 * D3.62 聚合路由入口占比最小样本（笔）：锚窗买入 <此值 → routerEntryBuyPct
 * null 不评（G17 N 通道 fail-open 同数）。样本薄时占比噪声大（12 笔里 1 笔
 * 路由=8.3% 已在门内抖动）。363 票分布里 <15 笔买入的低占比票仅 CD161(11)/
 * CD164(13) 两张（expect 已判），漏拦代价可接受换稳定。
 */
const ROUTER_ENTRY_MIN_BUYS = 15;
/**
 * burst 波强度滑窗宽度（G8 弱 burst 代码臂，2026-11-02 批次六 CD37/CD79 用户裁定
 * 「长期停滞突然涌入一波小流量，依然应该算低活跃度，但是如果涌入流量大，才能推翻
 * 低活跃度 结论」）：最密 BURST_WAVE_SEC 秒滑窗（按笔数取最密）内 Σ买入/独立钱包
 * 数=波强度两键；停滞深度第三维复用 maxGapSec（消费=grade E 通道代码臂）。
 */
const BURST_WAVE_SEC = 5;
/**
 * burst 波临近段（D3.56，2026-11-04 用户裁定 0xc0a6…7777 案：「burst 是指临近
 * 购买点位的 burst，不是整体的，前面有不算」）：波两键搜索段从「全窗最密 5s」
 * 收窄为「锚前 BURST_NEAR_SEC 秒内最密 5s」——开盘波（窗首抢筹，每票自然现象，
 * 大小反映开盘热度不反映持续流量）与中段波不再计入「涌入流量大推翻低活跃度」
 * 的判断（G8 语义脱节修复：sbw 题面排除项早已排除开盘首波，数值锚此前仍收
 * 全窗）。窗不足 BURST_NEAR_SEC=临近段退化为全窗（短窗信号票语义不变）；
 * 临近段 <2 有效 dt 行 → 波两键 null（有证据缺席不冒充）；burstMaxGapSec
 * 维持全窗 maxGapSec（停滞深度=低活跃度佐证，方向不受波位置影响）。
 */
const BURST_NEAR_SEC = 120;
/**
 * burst 尖刺簇常量（D3.51，2026-11-03 CD157 가나/CD102 SAFU 两票用户裁定立项
 * ——原话「burst 没有问题，但是这里的burst明显是一个尖刺。单独这一个 block
 * 持仓比例多少呢？这一个block 在这个burst中流动性占比多少？一算就知道这是
 * 作弊行为」）：burst 涌入本身是中性节奏（sbw 题只判有无），作弊形状=波内的
 * 秒级尖刺。口径（与 25 票分离度探针 tmp-spike-sep@182 bit 一致）：
 *   簇   = 窗内最大笔间 gap ≥SPIKE_CLUSTER_GAP_SEC → 该 gap 之后全部行；
 *          无此大 gap → 簇=整个窗口（开盘连续活跃盘形状，state 侧声明）
 *   尖刺 = 簇内 BUY 行最密 SPIKE_SEC 秒滑窗（Σ买入最大；平手取钱包多者）
 *   spikeBuyPctInBurst = 尖刺买入 ÷ 簇总买 ×100（用户问句②：块在 burst 中
 *                        流动性占比）
 *   spikeHoldPctAll    = 尖刺钱包正净持仓(BNB 域) ÷ 全窗 Σ正净 ×100（用户问句
 *                        ①：单块持仓比例；钱包域=wallets 剔路由伪钱包）
 * 25 票分离度定论（data/tmp-spike-sep.json@182）：cheat 9 票尖刺持仓 46.1-96.7
 * 全过 46 线，但 healthy CD104(54.6)/CD98(48.8) 数值孪生落群=**硬门不可行**
 * （与 G9/G10/G11 死指标退役同构）——结构分界在尖刺位置/户均金额/前停滞深度/
 * 尖刺后行为，判读交 Jev（题面 burst_spike_concentration，A 主判 strong→cheat）。
 */
const SPIKE_SEC = 3;
const SPIKE_CLUSTER_GAP_SEC = 60;
/**
 * 断流重启段分段门槛（D3.58，2026-11-04 CD183 立项——0xdee305bc…7777 案用户
 * 裁定：断流阈值「取 300 秒吧」；立项语境=「前期的用户行为混淆了 burst 的用户
 * 行为？……计算指标的时候，可以只取一个时间窗口，burst 的指标单独自己算」+
 * 「给Jev判断的时候也可以说明这个问题」）：锚窗内最大 tick 间隙 ≥300 秒 →
 * 该间隙之后的全部行=「断流重启段」，段内集中度单独量化。动机=全窗占比分母
 * 被前期流量稀释（立项票实形：断流 741s 后 11 笔全是全新钱包同块等额簇三波，
 * 等额簇占全窗买入 17.5% 但占段内买入 42.6%——全窗口径停在 moderate、段内
 * 口径才是重启段集中度的度量）；切分点=全窗最大间隙（与 SPIKE 簇 60s 线各自
 * 独立——spike 是尖刺簇切分、postStall 是分段锚切分，阈值语义不同勿合并）。
 * 全族 null=无 ≥300s 间隙（正常连续盘不产分段，D3.1「有证据的缺席」同语义）。
 */
const POST_STALL_GAP_SEC = 300;
/**
 * pump 数值锚族常量（D3.57，2026-11-04 用户判据立项——CD166 火龙果树/CD165 币安
 * 分红/CD175 pump 专项「pump 盘的识别要加强一下」）：用户原话「从K线上看，它的
 * 斜率非常稳定（或者是某一个长阶段斜率稳定），这根本不可能是正常用户参与搞出
 * 来的」「通过很少的流动性拉升价格，价格上涨跟流动性也就是买量不匹配，卖方
 * 长期缺失」。四判据分离度验证（tmp-pump-*@182 三正样本×六反例锚窗+全史双
 * 视角）：①整窗 R² 无分离度（立项票 CD166 锚窗 0.649 反低于部分反例）——分离
 * 键=最长稳定子段点数：pump 票锚窗 21-57 点直线（CD166 锚45=34 点/809s/0.951/
 * 2.5%/分，CD175 锚36/55/75=34/54/57 点）vs 反例锚窗 ≤10 点波段（CD167=3 点
 * 且斜率负）；②log 涨幅÷锚窗总买 BNB（perBnb）：pump 票 0.18-0.23 vs 反例
 * 全史 ≤0.11（2 倍分离）；③卖笔占比：pump 票锚窗 3-19% vs 反例 ≥20%；④单笔
 * 买额度无独立分离度（tmp-pump-buy-size 归档）只作题面佐证不作锚。本族=纯现象
 * 数值不产结论（判读教学=slow_grind_pump 题面单一载体，grade G15 零新增消费）。
 * 口径=锚窗可靠价序列（price_outlier=false 且 dt 非 null 且价 >0 行）O(n²)
 * 枚举连续子段（起点固定增量扩展，回归 O(1) 更新），log 价线性回归 R²≥
 * PUMP_STABLE_R2 取 span 最长（span 平手取先到——与探针 tmp-pump-signal3@182
 * bit 一致）；可靠价 <PUMP_STABLE_MIN_POINTS 点全族 null（绝不冒充）。
 */
const PUMP_STABLE_R2 = 0.95;
const PUMP_STABLE_MIN_POINTS = 4;
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
      // D3.54（CD161）creator 三域匹配原料：原始域小写保留——w=sender||trader
      // 归一后另一域的 creator 出现会被顶走（创建者经自有合约买入形状）
      tr: r.trader_address ? String(r.trader_address).toLowerCase() : null,
      se: r.sender_address ? String(r.sender_address).toLowerCase() : null,
      block: r.block_number ?? null,
      txHash: r.tx_hash ?? null, // D3.8 捆绑题原料：同一笔链上交易拆出的多行（state 渲染 tx= 前缀）
      viaRouter: isRouterTrader(r),
      outlier: r.price_outlier === true,
      // flap 非 BNB 计价盘行级标记（wss_price_ticks.quote_token：quote 地址|null=BNB 盘）——
      // 发行价常量锚的 quote 盘判定源（2026-11-09 起 quote 盘同 FL 常量，不再分流）
      quote: r.quote_token ?? null,
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

  // ── D3.62 聚合路由入口占比（G17 N 通道源锚，CD350 侦察立项——用户提案「把
  // GMGN 路由的流量占比给过去，如果太低就不行」）：锚窗买入**笔数**走聚合路由
  // （viaRouter，AGGREGATOR_ROUTER_ADDRS 9 址全集）占比。笔数≠金额口径
  // （routerPct）：金额被直连单笔大户稀释，笔数=散户入场通道份额。样本薄保护
  // ——买入 <ROUTER_ENTRY_MIN_BUYS 笔 null 不评（fail-open 方向与门小样本保护
  // 同数；363 票分布：healthy 52 票 min 23.8 / strongbacked min 50 零误伤，
  // <10% 全在 cheat 17+unhealthy 4）；零买入同 null。viaRouter 判 trader 层
  // （sender 解析无关，回测同构）。──
  const routerEntryBuyPct = buyN >= ROUTER_ENTRY_MIN_BUYS
    ? +((routerBuyN / buyN) * 100).toFixed(1) : null;

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
  // ── D3.50 总交易量占比（零买纯卖 ÷ 买+卖合计）：insider 题⑤「单钱包隐藏筹码」
  // 豁免的伤害量级标尺——用户裁定「看老鼠仓卖出在总交易量中比例吧，如果占比小，
  // 没事」（2026-11-03 CD73 边界案：单一钱包两笔 0.65 BNB 占总卖 77.1% 扎眼、
  // 但占买+卖合计仅 13.6%=买盘正常吸收；÷总卖口径在死卖盘天然虚高，÷买+卖才
  // 是对盘面的实际分量）。总交易量=0 → null（同 noBuySellPct 语义；总卖>0 ⟹
  // 总量>0，行渲染时恒有值）。──
  const totalVolumeBnb = totalBuyBnb + totalSellBnb;
  const noBuySellVolumePct = totalVolumeBnb > 0 ? +((noBuySellBnb / totalVolumeBnb) * 100).toFixed(1) : null;

  // ── D3.52 强庄持续买压·锚窗买卖比（strong_backer_pressure 题判读原料——
  // CD159 立项观察期键，grade 零消费只进 FA 投影攒分布）：窗口买入合计÷卖出合计，
  // 方向性事实（大户是否持续净买推价由题档判读）；卖=0 → null 比值不适用
  // （纯买盘按笔数与金额判读，题面已锚）。──
  const anchorBuySellRatio = totalSellBnb > 0 ? +(totalBuyBnb / totalSellBnb).toFixed(2) : null;

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

  // ── D3.53 精确等额同块簇（CD160：0xf5e642bc…7777 七钱包 0.0615 同块案——
  // 「完全相等金额挤入同一 block」的时间+金额双协同形状代码量化；Jev 判档
  // 原料（equal_amount_split/same_block_buy_wave 题消费，D3.5 边界不变——
  // 2026-11-04 用户裁定「把这个现象描述出来给 Jev」：代码只算事实占比与簇
  // 结构，不做门）──
  // 口径：同一 block 内买入金额 toFixed(4) 完全相等、不同钱包数 ≥
  // EXACT_EQUAL_BLOCK_MIN_WALLETS(2) 成簇（对/簇都算「挤入」；撞块的独立
  // 买家金额通常各异不进簇（RAM 7746 实形 0.2500/0.1037/0.1086）、前端默认
  // 档跟风是跨块长尾不聚同块（MAI 0.1 档 62 钱包 80 分钟实形）；尘门与
  // 等额簇锚同款 EQUAL_AMOUNT_MIN_BNB）：
  //   exactEqualBlockBuyPct       = 全部合格簇内那批等额买入行金额合计（笔级
  //     ——簇成员钱包的其余买入不计分子）÷ 窗口总买入 ×100（分母含 router
  //     行=GMGN 散户聚合侧，bundleBuyPct 同哲学）；无合格簇/总买≤0 → null
  //   router 聚合行天然不成簇：GMGN 多散户同块同档买入在 tick 层 wallet 同为
  //   router 地址，去重后 1 钱包 < 2 不成簇（无需显式剔除）
  //   exactEqualBlockClusterCount = 合格簇总数（未截帽）
  //   exactEqualBlockMaxWallets   = 最大簇去重钱包数（档位判读的簇标尺）
  //   exactEqualBlockClusters     = 叙事数组（block/amt/wallets/n/sumBnb/
  //     firstDt，按 sumBnb 降序 cap 5——仅 state 渲染不进 observation anchors，
  //     clusterRoundTrips 同款）
  let exactEqualBlockBuyPct = null, exactEqualBlockClusterCount = 0, exactEqualBlockMaxWallets = 0;
  const exactEqualBlockClusters = [];
  {
    const clusters = [];
    for (const [block, arr] of blockBuys) {
      const buckets = new Map(); // toFixed(4) 档 -> 行数组
      for (const t of arr) {
        if (t.wallet === null || t.wallet === undefined) continue;
        const bnb = t.bnb || 0;
        if (bnb < EQUAL_AMOUNT_MIN_BNB) continue;
        const k = Number(bnb).toFixed(4);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(t);
      }
      for (const [k, a] of buckets) {
        const wallets = new Set(a.map((t) => t.wallet)).size;
        if (wallets < EXACT_EQUAL_BLOCK_MIN_WALLETS) continue;
        clusters.push({
          block,
          amt: Number(k),
          wallets,
          n: a.length,
          sumBnb: a.reduce((s, t) => s + (t.bnb || 0), 0),
          firstDt: a[0].dt,
        });
      }
    }
    if (clusters.length > 0) {
      clusters.sort((a, b) => b.sumBnb - a.sumBnb);
      exactEqualBlockClusterCount = clusters.length;
      exactEqualBlockMaxWallets = clusters.reduce((m, c) => Math.max(m, c.wallets), 0);
      if (totalBuyBnb > 0) {
        const sum = clusters.reduce((s, c) => s + c.sumBnb, 0);
        exactEqualBlockBuyPct = +((sum / totalBuyBnb) * 100).toFixed(1);
      }
      exactEqualBlockClusters.push(...clusters.slice(0, 5));
    }
  }

  // ── D3.54 同块脉冲节拍（CD161：MAX 0xbe0d62b9…7777 创建者+捆绑簇垄断案——
  // 2026-11-04 用户裁定立项，原话「sameBlockHoldCircPct 还是跟之前说的，活跃度
  // 高的时候，它容易误伤。但是在这个币上，我认为不是误伤，它的block之间间隔
  // 时间很久，但是单个block又挤了好多交易，诶，我认为这是一个异常现象，是不是
  // 可以单独立个锚，或者在异常行为里头立个锚」）──
  // 「≥SAME_BLOCK_CLUSTER_MIN 笔 buy 同块」的脉冲块（与 sb 簇同门槛同源
  // blockBuys，不截 top10 展示帽）的**节拍维度**量化。分布探针（182 十二票）
  // 实证两键硬组合在高活跃盘孪生（RAM@41 活跃块占比 9.8%/脉冲买入占比 71.5%
  // 与立项票 9.8%/62.3% 完全孪生——占比数字分不开，G10 sbHold 活跃度函数问题
  // 同款）；结构性分界=脉冲孤立性：立项票三脉冲块间 16/11 个空块整段空窗
  // （孤立脉冲节拍=协同迹象），RAM/CD60/CD98 脉冲块背靠背相邻（连续活跃带，
  // 高活跃盘撞块常态 CD133 反锚）。孤立性判读归 Jev（abnormal_behavior_ratio
  // 题判读要点①，数值行只给间隔事实），代码不立门（D3.5 哲学）：
  //   pulseBlockCount   = 脉冲块数（无合格脉冲块 → null 有证据缺席）
  //   pulseBlockBuyPct  = 脉冲块买入金额合计 ÷ 窗口总买入 ×100（无脉冲块/
  //                       总买≤0 → null）
  //   pulseMaxGapBlocks = 相邻脉冲块间最大空块数（块差-1；<2 个脉冲块 → null
  //                       =无节拍间隔证据；pulseGapBlocks 升块序数组仅渲染）
  //   pulseBlockClusters= 叙事数组（block/dt/n/wallets/sumBnb 升块序 cap 5，
  //                       exactEqualBlockClusters 同哲学不进 observation anchors）
  let pulseBlockCount = null, pulseBlockBuyPct = null, pulseMaxGapBlocks = null;
  const pulseGapBlocks = [];
  const pulseBlockClusters = [];
  {
    const pulseAll = [...blockBuys.entries()]
      .filter(([, a]) => a.length >= SAME_BLOCK_CLUSTER_MIN)
      .map(([block, a]) => ({
        block,
        dt: a[0].dt,
        n: a.length,
        wallets: new Set(a.map((t) => t.wallet)).size,
        sumBnb: a.reduce((s, t) => s + (t.bnb || 0), 0),
      }))
      .sort((x, y) => x.block - y.block);
    if (pulseAll.length > 0) {
      pulseBlockCount = pulseAll.length;
      if (totalBuyBnb > 0) {
        pulseBlockBuyPct = +((pulseAll.reduce((s, c) => s + c.sumBnb, 0) / totalBuyBnb) * 100).toFixed(1);
      }
      for (let i = 1; i < pulseAll.length; i++) {
        pulseGapBlocks.push(pulseAll[i].block - pulseAll[i - 1].block - 1);
      }
      if (pulseGapBlocks.length > 0) pulseMaxGapBlocks = Math.max(...pulseGapBlocks);
      pulseBlockClusters.push(...pulseAll.slice(0, 5));
    }
  }

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
  //                              占在场流通%（D3.35）/买卖笔额/首买块/首卖距首买秒
  //                              ——行为叙事 Jev 综合用，不进数值锚键）
  const top2HoldSupplyPct = totalSupply !== null && top2NetTok > 0 ? (top2NetTok / totalSupply) * 100 : null;
  const top1Top2HoldSupplyPct = totalSupply !== null && top2NetTok > 0
    ? ((top1NetTok + top2NetTok) / totalSupply) * 100 : null;
  // ── D3.60 持有者基数三锚（2026-11-04 CD240 立项 BOSS 0x6b9b…7777：23 个正净
  // 持有者的盘创建者一人垄断在场流通 73% 仅判 moderate 放行——判读链从头到尾
  // 没有「持有者数」这个维度，「在场筹码少所致」豁免无数据可依。用户裁定原话
  // 「要是 3 个持有者还好说，现在 10 个持有者，显然不能容忍这种现象」+「如果
  // 有十个以上的持有者，单个持有 4 成也足够足够多了，为了避免误伤，可以先定
  // 最多 4 成半」+「2 个钱包最多 5 成半，3 个钱包最多 7 成，大概先这么定吧」
  // ——分层表（流通口径，题面 holdings_balance 单一载体判读）：持有者 ≥10 时
  // 单一 >45% / 前二合计 >55% / 前三合计 >70% 任一过线=垄断证据腿坐实直接高档
  // （免协同迹象腿；创建者身份不豁免）；持有者 ≤5 维持「筹码少」豁免；6-9 维持
  // 原判读。口径：posHolderCount=正净持有者数（与 posNetTok 分母同域，有证据
  // 零值）；前二/前三合计占在场流通%（<2/<3 持有人 → null 与 top2HoldSupplyPct
  // 同「有证据的缺席」语义——持有者不足时该轴不适用而非 0）──
  const posHolderCount = posSorted.length;
  const top3NetTok = posSorted.length > 2 ? posSorted[2][1] : 0;
  const top1Top2HoldCircPct = posTokTotal > 0 && top2NetTok > 0
    ? ((top1NetTok + top2NetTok) / posTokTotal) * 100 : null;
  const top3HoldCircPct = posTokTotal > 0 && top3NetTok > 0
    ? ((top1NetTok + top2NetTok + top3NetTok) / posTokTotal) * 100 : null;
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
  // holdingsProfile（D3.35 补腿版）在 burst 波段之后统一构建（circPct 在场流通
  // 口径 + 原料 firstBuyBlockOf 在此备齐——见下方 D3.35 段）

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
  let ticksPerMin = null, avgTradeBnb = null, maxGapSec = null, idlePct = null;
  let activityLevel = null, activityCv = null, activityUneven = null;
  // D3.55（CD162 v70 首信号 15s 翻正案）：窗口时长/总笔数两原料键——act 题④开盘
  // 极早窗反锚（窗 <60s ∨ 总笔数 <30）的阈值事实，代码算好进数值行（D3.49 同款
  // 「Jev 心算不可靠、组合数值代码算好」）；spanSec=首末 tick 真差不 clamp（展示值
  // 与 ticksPerMin 的 clamp 分母口径分离），dt 缺失同族 null 绝不冒充
  let spanSec = null, tickCount = null;
  if (dts.length >= 2) {
    spanSec = dts[dts.length - 1] - dts[0];
    tickCount = dts.length;
    const spanClamped = Math.max(1, spanSec);
    ticksPerMin = +((dts.length / spanClamped) * 60).toFixed(2);
    let idleSec = 0;
    for (let i = 1; i < dts.length; i++) {
      const g = dts[i] - dts[i - 1];
      if (g > maxGapSec) maxGapSec = g;
      // D3.49 无交易期占比：间隔 ≥IDLE_GAP_SEC 的静默段合计 ÷ 窗长（题①「完全
      // 静默段」的操作化——短暂间歇不算静默）。切点=14 票锚窗分布（tmp-idlepct@182）：
      // CD110 71%（冲 18s→静 49s→砸，用户质询「购买前大多数时间是空的」）、CD7/CD37/
      // CD98/CD99 83-96%；匀速 CD57 maxGap 13s=0%、高活跃 CD84/41/92/87/90/100/101 全 0%。
      // IDLE_GAP_SEC=20 与 CD57 最大间隔 13s 隔离（BSC 0.75s 出块 20s≈27 块无交易）。
      if (g >= ACTIVITY_IDLE_GAP_SEC) idleSec += g;
    }
    idlePct = +((idleSec / spanClamped) * 100).toFixed(1);
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
    const bucketN = Math.ceil(spanClamped / ACTIVITY_BUCKET_SEC);
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

  // ── D3.59 全窗金额三锚+临近买点段七键（CD184 暴力雪球 0x15583f…7777 立案：开盘
  // 30s 真实买流 1.2 BNB 单调 +13.9% → t+29s 后 43s 只剩 <0.002 尘单滴答维持价格，
  // 全窗 20 笔/分+笔均 0.0535 被开盘段与单笔 0.8 拉高，Jev act=high@0.50 vs low 0.35
  // 惜败放行 → 锚后 -30%。用户裁定「应该强调下临近买入时间窗口的活跃度吧，得提供
  // 临近买入的活跃度数据」——D3.29/D3.49「Jev 心算不可靠、组合数值代码算好」先例：
  // act ④③⑤ 判读原料（买卖笔数、买盘中位、金额吞吐、窗内最大回撤）代码算好进数值
  // 行，另加临近段（锚窗末端 NEAR_SEG_SEC 秒固定窗）独立口径——尘单滴答不断打破
  // 时间静默使 ① 的静默占比对「开盘密集→临近尘单」形状失明，临近死寂由段内中位/
  // 吞吐暴露。dt 缺失全族 null（绝不冒充）；spanSec ≤ NEAR_SEG_SEC 临近段全 null
  // （无对比语义）；买盘中位=全量行不滤 outlier（与笔均同口径），偶数个取下中位
  // （尘埃判读方向保守）；最大回撤=可靠价序列运行峰回撤（≥2 可靠价才有证据，
  // 单调序列=0 有证据零值）。grade 零新增消费。──
  let buyMedianBnb = null, throughputBnbPerMin = null, maxDrawdownPct = null;
  let nearSegTickN = null, nearSegTicksPerMin = null, nearSegBuyMedianBnb = null;
  let nearSegBnbPerMin = null, nearSegMaxGapSec = null, nearSegBuyN = null, nearSegSellN = null;
  if (dts.length >= 2) {
    const spanClampedAmt = Math.max(1, spanSec);
    const buyAmts = [];
    for (const t of ticks) {
      if (t.side === 'BUY') buyAmts.push(t.bnb || 0);
    }
    buyAmts.sort((a, b) => a - b);
    if (buyAmts.length) buyMedianBnb = +(buyAmts[Math.floor((buyAmts.length - 1) / 2)].toFixed(6));
    throughputBnbPerMin = +(((totalBuyBnb + totalSellBnb) / spanClampedAmt) * 60).toFixed(2);
    const relPx = [];
    for (const t of ticks) {
      if (t.outlier || t.priceBnb === null || t.priceBnb === undefined || !(t.priceBnb > 0)) continue;
      relPx.push(t.priceBnb);
    }
    if (relPx.length >= 2) {
      let pk = relPx[0], dd = 0;
      for (const p of relPx) {
        if (p > pk) pk = p;
        const d = (pk - p) / pk;
        if (d > dd) dd = d;
      }
      maxDrawdownPct = +(dd * 100).toFixed(1);
    }
    if (spanSec > NEAR_SEG_SEC) {
      const fromDt = dts[dts.length - 1] - NEAR_SEG_SEC;
      let segN = 0, segBuyN = 0, segSellN = 0, segBnbSum = 0;
      const segBuyAmts = [];
      const segDts = [];
      for (const t of ticks) {
        if (t.dt === null || t.dt === undefined || t.dt <= fromDt) continue;
        segN++;
        segDts.push(t.dt);
        segBnbSum += t.bnb || 0;
        if (t.side === 'BUY') { segBuyN++; segBuyAmts.push(t.bnb || 0); }
        else segSellN++;
      }
      nearSegTickN = segN;
      nearSegTicksPerMin = +((segN / NEAR_SEG_SEC) * 60).toFixed(2);
      nearSegBnbPerMin = +((segBnbSum / NEAR_SEG_SEC) * 60).toFixed(2);
      nearSegBuyN = segBuyN;
      nearSegSellN = segSellN;
      segBuyAmts.sort((a, b) => a - b);
      if (segBuyAmts.length) nearSegBuyMedianBnb = +(segBuyAmts[Math.floor((segBuyAmts.length - 1) / 2)].toFixed(6));
      let sg = 0;
      for (let i = 1; i < segDts.length; i++) sg = Math.max(sg, segDts[i] - segDts[i - 1]);
      nearSegMaxGapSec = sg;
    }
  }

  // ── burst 波强度两键（G8 弱 burst 代码臂，头注见 BURST_WAVE_SEC/BURST_NEAR_SEC）：
  // 定线研究（tmp-burst-strength@182 17 票 sbw=burst）——豁免挡住的全是自己人（14 票
  // Jev act 已判 low），豁免资格须由波强度承接；人工 healthy 4 票中 3 票 maxGap 仅
  // 19~43s（无停滞=开盘密集正常形状）→ 停滞深度是必要第三维（复用 maxGapSec，
  // grade 侧锚名 burstMaxGapSec）。算法=最密 BURST_WAVE_SEC 秒滑窗双指针（按窗内
  // 笔数取最密），窗内钱包计数 map 精确去重（同钱包多笔逐出时不误删）；dt 缺失
  // 全族 null（绝不冒充）；<2 有效 dt 行波形状不可评同 null。D3.56 起搜索段=
  // 锚前 BURST_NEAR_SEC 临近段（头注见 BURST_NEAR_SEC——开盘/中段波「前面有不算」）。──
  let burstWaveBuyBnb = null, burstWaveWallets = null;
  const waveTicksAll = ticks.filter((t) => t.dt !== null && t.dt !== undefined);
  if (waveTicksAll.length >= 2) {
    const nearFrom = waveTicksAll[waveTicksAll.length - 1].dt - BURST_NEAR_SEC;
    const waveTicks = nearFrom <= 0 ? waveTicksAll : waveTicksAll.filter((t) => t.dt >= nearFrom);
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
  }

  // ── burst 尖刺族（D3.51，头注见 SPIKE_SEC）：簇内最密 3s 滑窗两占比+结构
  // 事实（簇大小/跨度/位置/停滞深度），state「burst 尖刺集中度」行与
  // burst_spike_concentration 题的判读原料；dt 缺失（<2 有效行）全族 null、
  // 簇内无买入尖刺子族 null、Σ正净=0 持仓占比 null——绝不冒充（tmp-spike-sep
  // 口径 bit 一致：平手取钱包多者的双指针、正净域=wallets 剔路由）──
  let spikePreGapSec = null, spikeClusterSplit = null, spikeClusterN = null;
  let spikeClusterSpanSec = null, spikeClusterBuyBnb = null;
  let spikeBuyBnb = null, spikeBuyN = null, spikeWallets = null;
  let spikeFromDt = null, spikeToDt = null, spikePosPct = null;
  let spikeBuyPctInBurst = null, spikePosNetBnb = null, spikeHoldPctAll = null;
  {
    const dtTicks = ticks.filter((t) => t.dt !== null && t.dt !== undefined);
    if (dtTicks.length >= 2) {
      let maxGap = 0, gapIdx = -1;
      for (let i = 1; i < dtTicks.length; i++) {
        const g = dtTicks[i].dt - dtTicks[i - 1].dt;
        if (g > maxGap) { maxGap = g; gapIdx = i; }
      }
      spikePreGapSec = maxGap;
      spikeClusterSplit = maxGap >= SPIKE_CLUSTER_GAP_SEC;
      const cluster = spikeClusterSplit ? dtTicks.slice(gapIdx) : dtTicks;
      spikeClusterN = cluster.length;
      spikeClusterSpanSec = cluster.length ? cluster[cluster.length - 1].dt - cluster[0].dt : null;
      const clusterBuyRows = cluster.filter((t) => t.side === 'BUY');
      let clusterBuy = 0;
      for (const t of clusterBuyRows) clusterBuy += t.bnb || 0;
      spikeClusterBuyBnb = +clusterBuy.toFixed(4);
      // 正净持仓域（BNB 域；wallets 聚合单点已剔路由伪钱包）
      const posNetByWallet = new Map();
      let denomPosNet = 0;
      for (const e of wallets) {
        const net = (e.buyBnb || 0) - (e.sellBnb || 0);
        if (net > 0) { posNetByWallet.set(String(e.w).toLowerCase(), net); denomPosNet += net; }
      }
      if (clusterBuyRows.length > 0 && clusterBuy > 0) {
        // 双指针最密 SPIKE_SEC 秒滑窗：Σ买入最大；平手取钱包多者
        const buys = clusterBuyRows.slice().sort((a, b) => a.dt - b.dt);
        let j = 0, curBuy = 0, curN = 0; const curW = new Map();
        let best = null;
        for (let i = 0; i < buys.length; i++) {
          const t = buys[i];
          curBuy += t.bnb || 0; curN++;
          if (t.wallet) curW.set(String(t.wallet).toLowerCase(), (curW.get(String(t.wallet).toLowerCase()) || 0) + 1);
          while (t.dt - buys[j].dt > SPIKE_SEC) {
            const u = buys[j];
            curBuy -= u.bnb || 0; curN--;
            if (u.wallet) {
              const k = String(u.wallet).toLowerCase();
              const n = (curW.get(k) || 1) - 1;
              if (n <= 0) curW.delete(k); else curW.set(k, n);
            }
            j++;
          }
          if (!best || curBuy > best.buy + 1e-12
            || (Math.abs(curBuy - best.buy) <= 1e-12 && curW.size > best.walletN)) {
            best = { buy: curBuy, buyN: curN, walletN: curW.size, fromDt: buys[j].dt, toDt: t.dt, wallets: new Set(curW.keys()) };
          }
        }
        // 尖刺钱包正净合计（路由伪钱包/净≤0 钱包不在 posNet 域 → 贡献 0）
        let numPosNet = 0;
        for (const w of best.wallets) numPosNet += posNetByWallet.get(w) || 0;
        spikeBuyBnb = +best.buy.toFixed(4);
        spikeBuyN = best.buyN;
        spikeWallets = best.walletN;
        spikeFromDt = best.fromDt;
        spikeToDt = best.toDt;
        spikeBuyPctInBurst = +((best.buy / clusterBuy) * 100).toFixed(1);
        spikePosNetBnb = +numPosNet.toFixed(4);
        spikeHoldPctAll = denomPosNet > 0 ? +((numPosNet / denomPosNet) * 100).toFixed(1) : null;
        if (spikeClusterSpanSec !== null && spikeClusterSpanSec > 0) {
          spikePosPct = Math.max(0, Math.min(100, Math.round(((best.fromDt - cluster[0].dt) / spikeClusterSpanSec) * 100)));
        } else {
          spikePosPct = 0; // 单点簇：尖刺即簇本身
        }
      }
    }
  }

  // ── D3.58 断流重启段锚族（CD183：0xdee305bc…7777 断流 741s 后全新钱包等额
  // 簇三波重启案立项，头注见 POST_STALL_GAP_SEC——用户裁定「计算指标的时候，
  // 可以只取一个时间窗口，burst 的指标单独自己算」：全窗占比分母被前期流量
  // 稀释（立项票段内等额簇占比 42.6% vs 全窗 17.5%），段内口径单独量化。
  // 段=锚窗内最大 tick 间隙 ≥POST_STALL_GAP_SEC(300s) 之后的全部行；切分口径
  // 与 spike 簇（60s 线）各自独立。六键（事实数值非门槛，判读教学在
  // same_block_buy_wave/equal_amount_split 题面分段口径句）：
  //   postStallSpanSec        = 段时长（段首末 dt 差；段 1 行 → 0）
  //   postStallBuyBnb         = 段内买入合计 BNB
  //   postStallBuyerCount     = 段内买入钱包去重数（wallet 域 sender||trader 不剔
  //                              router——「买家数」事实与 [TICKS] w= 同域）
  //   postStallFreshBuyerPct  = 段内买入钱包中断流前段从未出现过的占比 ×100
  //                              （「断流前出现过」=前段全部行钱包集，买卖都算在场）
  //   postStallEqualClusterPct= 段内精确等额同块簇买入 ÷ 段内总买 ×100
  //                              （D3.53 同口径段内版：同块∧toFixed(4) 全等∧
  //                              ≥2 钱包∧尘门 EQUAL_AMOUNT_MIN_BNB）
  //   postStallMaxBlockBuyPct = 段内最大单块买入 ÷ 段内总买 ×100
  // null 语义：无 ≥300s 间隙（含 <2 有效 dt 行）→ 全族 null；段内无买入 →
  // buyBnb=0/buyerCount=0、占比三键与 freshBuyerPct null（无段内买入证据）──
  let postStallSpanSec = null, postStallBuyBnb = null, postStallBuyerCount = null;
  let postStallFreshBuyerPct = null, postStallEqualClusterPct = null, postStallMaxBlockBuyPct = null;
  {
    const dtTicks2 = ticks.filter((t) => t.dt !== null && t.dt !== undefined);
    if (dtTicks2.length >= 2) {
      let maxGap2 = 0, gapIdx2 = -1;
      for (let i = 1; i < dtTicks2.length; i++) {
        const g = dtTicks2[i].dt - dtTicks2[i - 1].dt;
        if (g > maxGap2) { maxGap2 = g; gapIdx2 = i; }
      }
      if (maxGap2 >= POST_STALL_GAP_SEC) {
        const seg = dtTicks2.slice(gapIdx2);
        const pre = dtTicks2.slice(0, gapIdx2);
        postStallSpanSec = seg[seg.length - 1].dt - seg[0].dt;
        const segBuys = seg.filter((t) => t.side === 'BUY');
        postStallBuyBnb = +segBuys.reduce((s, t) => s + (t.bnb || 0), 0).toFixed(4);
        const segBuyerSet = new Set();
        for (const t of segBuys) if (t.wallet) segBuyerSet.add(String(t.wallet).toLowerCase());
        postStallBuyerCount = segBuyerSet.size;
        if (segBuyerSet.size > 0 && postStallBuyBnb > 0) {
          const preWallets = new Set();
          for (const t of pre) if (t.wallet) preWallets.add(String(t.wallet).toLowerCase());
          let fresh = 0;
          for (const w of segBuyerSet) if (!preWallets.has(w)) fresh++;
          postStallFreshBuyerPct = +((fresh / segBuyerSet.size) * 100).toFixed(1);
          // 段内精确等额同块簇（D3.53 段内版：同块∧toFixed(4) 全等∧≥2 钱包∧尘门）
          const segBlockBuys = new Map();
          for (const t of segBuys) {
            if (t.block === null || t.block === undefined) continue;
            if (!segBlockBuys.has(t.block)) segBlockBuys.set(t.block, []);
            segBlockBuys.get(t.block).push(t);
          }
          let clusterBnb = 0;
          let maxBlkBnb = 0;
          for (const [, arr] of segBlockBuys) {
            const blkBnb = arr.reduce((s, t) => s + (t.bnb || 0), 0);
            if (blkBnb > maxBlkBnb) maxBlkBnb = blkBnb;
            const buckets = new Map();
            for (const t of arr) {
              if (t.wallet === null || t.wallet === undefined) continue;
              const bnb = t.bnb || 0;
              if (bnb < EQUAL_AMOUNT_MIN_BNB) continue;
              const k = Number(bnb).toFixed(4);
              if (!buckets.has(k)) buckets.set(k, []);
              buckets.get(k).push(t);
            }
            for (const [, a] of buckets) {
              if (new Set(a.map((t) => t.wallet)).size >= EXACT_EQUAL_BLOCK_MIN_WALLETS) {
                clusterBnb += a.reduce((s, t) => s + (t.bnb || 0), 0);
              }
            }
          }
          postStallEqualClusterPct = +((clusterBnb / postStallBuyBnb) * 100).toFixed(1);
          postStallMaxBlockBuyPct = +((maxBlkBnb / postStallBuyBnb) * 100).toFixed(1);
        }
      }
    }
  }

  // ── 协同买入参考四键（D3.35，2026-11-02 用户裁定「将 Jev 转化为一个真实的
  // 交易者……一些指标也可以作为参考，但是不要有非常硬的标准，尽量从交易者
  // 角度，去看看交易信息是否正常」：买侧节奏四事实进 [PRECOMPUTED] 供
  // abnormal_behavior_ratio 题（D3.39 前 real_participation）参考判读——**参考数值非门槛**，判读交 Jev 交易者角色
  // 综合；口径与 128 票分布研究（tmp-coop-buy-stats@182）bit 一致：全量 BUY 行
  // 不滤 outlier（资金口径）、钱包=sender||trader 原样小写**不去 router**
  // （与 [TICKS] w= 同域，未解析行证据洞由 unresolvedSenderTickCount 承载）──
  //   maxBlockBuyCount    = 最大单块买入笔数（并列取买入额大者；无买入=0）
  //   maxBlockBuyPct      = 该块买入额 ÷ 窗总买 ×100（总买≤0 → null）
  //   maxBlockPreGapSec   = 最大块与前一买块（块序）的时间差秒（dt 域）——
  //                         最大块=首个买块 → null（开盘首块无前摇证据，非 0 秒）；
  //                         block_number 缺失行不进单块统计（sameBlockClusters 同款）
  //   sameAmountWalletPct = 最大同档金额（四位小数档，T78 粒度）钱包去重数 ÷
  //                         窗内买入钱包去重数 ×100（**无尘门**——尘埃档整档聚集
  //                         本身也是流量形状信号；档=toFixed(4) 与 128 票研究同款）
  // 分布事实（healthy 24 票 vs 人工 cheat 组）：最大单块占比 P50=14.1 vs 17.9、
  // P90=26.0 vs 46.1；同档钱包% healthy max=21.2 vs cheat P75=35.3；联合形状
  // 「最大块笔数 ≥4 ∧ 占比 ≥30%」healthy 24 票零命中——参考性判读素材非硬线。
  let maxBlockBuyCount = 0, maxBlockBuyPct = null, maxBlockPreGapSec = null, sameAmountWalletPct = null;
  {
    const buyBlocks = new Map(); // block -> {n, bnb, firstDt}
    const buyWallets = new Set();
    const amtBuckets = new Map(); // toFixed(4) 档 -> Set<钱包小写>
    for (const t of ticks) {
      if (t.side !== 'BUY') continue;
      const wl = t.wallet ? String(t.wallet).toLowerCase() : null;
      if (wl) buyWallets.add(wl);
      if (t.bnb !== null && t.bnb !== undefined) {
        const k = Number(t.bnb).toFixed(4);
        if (!amtBuckets.has(k)) amtBuckets.set(k, new Set());
        if (wl) amtBuckets.get(k).add(wl);
      }
      if (t.block === null || t.block === undefined) continue;
      const o = buyBlocks.get(t.block) || { n: 0, bnb: 0, firstDt: t.dt };
      o.n++;
      o.bnb += t.bnb || 0;
      buyBlocks.set(t.block, o);
    }
    if (buyBlocks.size > 0) {
      let maxBl = null, maxKey = null;
      for (const [block, o] of buyBlocks) {
        if (!maxBl || o.n > maxBl.n || (o.n === maxBl.n && o.bnb > maxBl.bnb)) { maxBl = o; maxKey = block; }
      }
      maxBlockBuyCount = maxBl.n;
      maxBlockBuyPct = totalBuyBnb > 0 ? +((maxBl.bnb / totalBuyBnb) * 100).toFixed(1) : null;
      const ordered = [...buyBlocks.keys()].sort((a, b) => a - b);
      const idx = ordered.indexOf(maxKey);
      if (idx > 0) {
        const prev = buyBlocks.get(ordered[idx - 1]);
        if (maxBl.firstDt !== null && maxBl.firstDt !== undefined
          && prev.firstDt !== null && prev.firstDt !== undefined) {
          maxBlockPreGapSec = Math.max(0, maxBl.firstDt - prev.firstDt);
        }
      } // idx===0（首个买块）保持 null：开盘首块无前摇证据
    }
    if (buyWallets.size > 0) {
      let topN = 0;
      for (const s of amtBuckets.values()) if (s.size > topN) topN = s.size;
      sameAmountWalletPct = +((topN / buyWallets.size) * 100).toFixed(1);
    }
  }

  // ── holdings 口径补腿（D3.35，CD10 双失明教训：①供应口径在窗口早期全失明
  // ——创建者+簇垄断在场 72% 但占供应只零头（t1 供 2.7%）；②正净口径看不见
  // 「曾持有」——创建者开盘最大单买入后清仓净 0，持仓分布行里彻底消失）──
  //   holdingsProfile[].circPct = 该钱包正净 ÷ Σ正净 token（在场流通口径——窗口
  //                              早期谁主导在场筹码谁主导盘面的正确度量；Σ=0 → null）
  //   creatorPeakHoldSupplyPct = 创建者逐行累计净持仓的**峰值** ÷ totalSupply ×100
  //                              （swap 域内曾持有的上限；创建者无 BUY 行 → null
  //                              ——链外转入域 swap 不可见（insider 题同款「来源
  //                              不经过本盘」），绝不以 0 冒充「从未持有」；token_amount
  //                              缺列/创建者地址缺失 → null fail-closed）
  const creatorAddr = snapshot.tokenMeta && snapshot.tokenMeta.creatorAddress
    ? String(snapshot.tokenMeta.creatorAddress).toLowerCase() : null;
  let creatorPeakHoldSupplyPct = null;
  // 创建者行为摘要（D3.35 state「已不在前三」句的原料：曾持峰值+买/卖额笔数——
  // 「开盘最大单买入后清仓」的完整轨迹一行的量；地址缺失全 null）
  let creatorWallet = null, creatorBuyBnb = 0, creatorBuyN = 0;
  let creatorSellBnb = 0, creatorSellN = 0;
  if (creatorAddr) {
    let net = 0, peak = 0, sawBuy = false, tokMissing = false;
    for (const t of ticks) {
      // D3.54（CD161）creator 三域匹配：创建者经自有合约买入时 trader 域=
      // creator 合约、sender=调用人，wallet（sender||trader）归调用人口径把
      // creator 行吞掉（立项票 0xbe0d62b9 实形：dev 专属合约 0x5116 仅 trader
      // 域出现 1 行 2.827 BNB=窗内最大单，w=0x6cd6 → 改前 creator 全 null
      // 「无 BUY 行」）——行级 w/tr/se 任一域命中即创建者通道流水，峰值/净额=
      // 命中行累计（经手钱包口径，语义=「创建者通道持有」）。wallets 层
      // isCreator 标注保持严格 w===creator（防公共工厂合约多人调用误标；立项
      // 票合约经查 1/1000 票 dev 专属）
      const w = t.wallet ? String(t.wallet).toLowerCase() : null;
      if (w !== creatorAddr && t.tr !== creatorAddr && t.se !== creatorAddr) continue;
      creatorWallet = creatorAddr;
      if (t.side === 'BUY') { creatorBuyBnb += t.bnb || 0; creatorBuyN++; }
      else { creatorSellBnb += t.bnb || 0; creatorSellN++; }
      if (t.tok === null || t.tok === undefined) { tokMissing = true; break; }
      if (t.side === 'BUY') { sawBuy = true; net += t.tok; } else net -= t.tok;
      if (net > peak) peak = net;
    }
    if (!tokMissing && sawBuy && peak > 0 && totalSupply !== null) {
      creatorPeakHoldSupplyPct = +((peak / totalSupply) * 100).toFixed(2);
    }
  }
  const holdingsProfile = posSorted.slice(0, 3).map(([w, netTok]) => {
    const e = walletOf.get(w) || {};
    return {
      w,
      netTok,
      supplyPct: totalSupply !== null ? (netTok / totalSupply) * 100 : null,
      // D3.35 在场流通口径（早期盘垄断的正确度量；与 supplyPct 同分子异分母）
      circPct: posTokTotal > 0 ? (netTok / posTokTotal) * 100 : null,
      buyBnb: e.buyBnb || 0, buyN: e.buyN || 0,
      sellBnb: e.sellBnb || 0, sellN: e.sellN || 0,
      firstBuyDt: e.firstBuyDt ?? null, firstSellDt: e.firstSellDt ?? null,
      firstBuyBlock: firstBuyBlockOf.get(w) ?? null,
    };
  });

  // ── 簇占在场流通两锚（D3.41 ①，2026-11-03 全量对拍批次二用户裁定「这一波我
  // 认为应该有一个独立的锚了：单级持仓。可以扩展之前的持仓锚，单个异常区块
  // （交易数多，不是真实用户行为）以及捆绑持仓太多是要拦住的」——批次二六票
  // holdings_balance 全失明根因=开盘早期窗 supply 口径全员个位数（t1 供全 <25%）
  // 而流通口径判别力强（CD20 top1Circ 61.6）。token 域（与 D3.20/D3.32 supply 锚
  // 及 holdingsProfile.circPct 同域），分子=sb/eq 簇成员正净 token 合计、分母=
  // posTokTotal；与 CD133 撤三行的区别=那是 G 通道门侧死指标+豁免前提的退役、
  // G10 起门侧零消费，本两键纯题面判读原料（holdings_balance 档位判读）无任何
  // 代码门/豁免消费；无合格簇/在场流通 Σ=0 → null（有证据的缺席）；簇成员全
  // 清仓 → 0（有证据零值）──
  const holdTokCircPctOf = (memberSet) => {
    if (!memberSet.size || posTokTotal <= 0) return null;
    let m = 0;
    for (const w of memberSet) m += posNetTok.get(w) || 0;
    return (m / posTokTotal) * 100;
  };
  const sameBlockHoldCircPct = holdTokCircPctOf(sbMembers);
  const equalBandHoldCircPct = holdTokCircPctOf(eqMembers);

  // ── 簇闭环锚（D3.41 ⑤，2026-11-03 批次二 CD20 ticks 深挖——用户「CD20 我请
  // 你再看一下它的 ticks 情况，看看如何识别」→「好，搞吧」）：CD20 实形=五组
  // 等额簇「同块买→隔数秒~数十秒同块卖回」跨块闭环，washPair 锚只配同块卖→买
  // 等额对敲对此结构性失明（跨块+金额因价差不等）、eq/sb 题各见一半（买侧簇/
  // 卖侧块两段不相干数据）拼不出闭环铁证。本锚 per-cluster 联立：对每个合格簇
  // （同块买 ≥3 笔块簇 / 四位舍入精确等额 ≥3 钱包桶簇——eq 臂刻意取 T74
  // equalClusters 展示同源的精确桶而非 D3.1 对数带：闭环对倒的等额簇是配置值
  // 精确重复（CD20 五簇全精确等额），对数带会把近额散户并进簇稀释闭环信号），
  // 找「≥2 个该簇成员同块卖出」且卖块 ≥ 各自首买块的卖出行——「同一批钱包既
  // 一起买又一起卖」是跨块对倒的时间平移版；独立散户撞同块卖常见、但撞不出
  // 买卖双联立（判读仍 Jev：coordinated_sell_back 题档承载，无代码门消费——
  // 高活跃盘不同批次各自同块离场≠闭环，锚已按「买入也同簇」过滤）。
  //   clusterRoundTripPct     = 行去重闭环卖出合计 ÷ 簇成员（sb∪eq 并集）买入
  //                             合计 ×100（分母与 bundleBuyPct 分子同源）
  //   clusterRoundTripSellPct = 同分子 ÷ 全窗总卖 ×100（对敲行双占比同款）
  //   clusterRoundTripBlocks  = 去重闭环卖块数
  //   clusterRoundTrips       = 叙事数组 top5（按闭环卖出额降序；state 渲染
  //                             「簇买→同块卖回闭环」行例句用，不进 observation）
  // 无合格簇 → pct 两键 null；有簇零闭环 → 0（有证据零值）；首买块缺失/卖块
  // 先于首买块 → 该行不计（宁少不冒充：窗外持仓的卖出不是「卖回」）──
  let clusterRoundTripPct = null, clusterRoundTripSellPct = null, clusterRoundTripBlocks = 0;
  const clusterRoundTrips = [];
  if (bundleMembers.size > 0) {
    const rtClusters = [];
    for (const [block, arr] of blockBuys) {
      if (arr.length < SAME_BLOCK_CLUSTER_MIN) continue;
      const ws = new Set(arr.map((t) => t.wallet).filter(Boolean));
      rtClusters.push({ kind: 'same_block', label: `块${block}`, members: ws, firstDt: arr[0].dt });
    }
    for (const [k, arr] of evenBuckets) {
      const ws = new Set(arr.map((t) => t.wallet).filter(Boolean));
      if (ws.size < SAME_BLOCK_CLUSTER_MIN) continue;
      rtClusters.push({ kind: 'equal', label: `${(k / EQUAL_AMOUNT_ROUND).toFixed(4)}×${ws.size}`, members: ws, firstDt: arr[0].dt });
    }
    const memberSells = new Map(); // wallet -> SELL 行（仅簇成员）
    for (const t of ticks) {
      if (t.side !== 'SELL' || !t.wallet || !bundleMembers.has(t.wallet)) continue;
      if (!memberSells.has(t.wallet)) memberSells.set(t.wallet, []);
      memberSells.get(t.wallet).push(t);
    }
    const counted = new Map(); // tick.i -> bnb（跨簇行去重：同钱包可同时在 sb/eq 簇）
    const countedBlocks = new Set();
    for (const c of rtClusters) {
      const sellBlocks = new Map(); // block -> 该簇成员卖行
      for (const w of c.members) {
        const fb = firstBuyBlockOf.get(w);
        if (fb === null || fb === undefined) continue; // 首买块证据缺失不计（宁少不冒充）
        for (const s of memberSells.get(w) || []) {
          if (s.block === null || s.block < fb) continue; // 卖先于首买=非卖回
          if (!sellBlocks.has(s.block)) sellBlocks.set(s.block, []);
          sellBlocks.get(s.block).push(s);
        }
      }
      const blocks = [...sellBlocks.entries()]
        .filter(([, a]) => new Set(a.map((s) => s.wallet)).size >= 2)
        .map(([block, a]) => ({ block, dt: a[0].dt, n: a.length, sellBnb: a.reduce((x, s) => x + (s.bnb || 0), 0) }))
        .sort((a, b) => a.block - b.block);
      if (blocks.length === 0) continue;
      let buyBnb = 0;
      for (const w of c.members) buyBnb += buyOf.get(w) || 0;
      const sellBnb = blocks.reduce((x, b) => x + b.sellBnb, 0);
      clusterRoundTrips.push({
        kind: c.kind, label: c.label, wallets: c.members.size, firstDt: c.firstDt,
        buyBnb: +buyBnb.toFixed(4), sellBnb: +sellBnb.toFixed(4),
        blocks: blocks.map((b) => ({ block: b.block, dt: b.dt, n: b.n, sellBnb: +b.sellBnb.toFixed(4) })),
      });
      for (const b of blocks) {
        countedBlocks.add(b.block);
        for (const s of sellBlocks.get(b.block)) counted.set(s.i, s.bnb || 0);
      }
    }
    clusterRoundTrips.sort((a, b) => b.sellBnb - a.sellBnb);
    clusterRoundTrips.splice(5);
    clusterRoundTripBlocks = countedBlocks.size;
    if (counted.size > 0) {
      let rtBnb = 0;
      for (const v of counted.values()) rtBnb += v;
      const denomBuy = sumBuyOf(bundleMembers);
      clusterRoundTripPct = denomBuy > 0 ? +((rtBnb / denomBuy) * 100).toFixed(1) : null;
      clusterRoundTripSellPct = totalSellBnb > 0 ? +((rtBnb / totalSellBnb) * 100).toFixed(1) : null;
    } else {
      clusterRoundTripPct = 0; // 有簇零闭环=有证据零值（正常盘常态）
    }
  }

  // ── 价格拱（仅 price_outlier=false 行——价格口径滤，资金口径不滤）──
  let first = null, ath = null, athDt = null, last = null;
  for (const t of ticks) {
    if (t.outlier || t.priceBnb === null || t.priceBnb === undefined) continue;
    if (first === null) first = t.priceBnb;
    if (ath === null || t.priceBnb > ath) { ath = t.priceBnb; athDt = t.dt; }
    last = t.priceBnb;
  }

  // ── pump 数值锚族（D3.57，头注见 PUMP_STABLE_R2）：锚窗可靠价序列的最长稳定
  // 斜率子段（log 价回归 R²≥0.95 取 span 最长）+ log 涨幅÷总买 + 卖笔占比。
  // O(n²) 枚举连续子段（起点 i 固定向右增量扩展，sxy/sxx/syy O(1) 更新——与探针
  // tmp-pump-signal3@182 数值 bit 一致）；斜率符号不筛（躺死阴跌直线也是稳定段，
  // 方向判读归题面）；无合格稳定段=points/span 0 有证据零值、r2/slope null；
  // 可靠价 <4 点/dt 缺失全族 null（绝不冒充）。grade 零新增消费。──
  let pumpStablePoints = null, pumpStableSpanSec = null, pumpStableR2 = null;
  let pumpStableSlopePctPerMin = null, pumpRisePerBuyBnb = null, pumpSellTickCountPct = null;
  {
    const relPump = [];
    for (const t of ticks) {
      if (t.outlier || t.priceBnb === null || t.priceBnb === undefined) continue;
      if (t.dt === null || t.dt === undefined || !(t.priceBnb > 0)) continue;
      relPump.push({ dt: t.dt, logP: Math.log(t.priceBnb) });
    }
    if (relPump.length >= PUMP_STABLE_MIN_POINTS) {
      let best = null;
      for (let i = 0; i < relPump.length; i++) {
        let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
        for (let j = i; j < relPump.length; j++) {
          const x = relPump[j].dt - relPump[i].dt;
          const y = relPump[j].logP;
          n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
          if (n < 3) continue;
          const dx = n * sxx - sx * sx;
          const dy = n * syy - sy * sy;
          if (dx <= 0 || dy <= 0) continue; // 全同 x/全同 y（水平线）回归无定义跳过
          const r2 = ((n * sxy - sx * sy) ** 2) / (dx * dy);
          if (r2 >= PUMP_STABLE_R2) {
            const span = relPump[j].dt - relPump[i].dt;
            if (best === null || span > best.span) {
              best = { points: n, span, r2, slope: (n * sxy - sx * sy) / dx };
            }
          }
        }
      }
      pumpStablePoints = best ? best.points : 0;
      pumpStableSpanSec = best ? best.span : 0;
      pumpStableR2 = best ? +best.r2.toFixed(3) : null;
      pumpStableSlopePctPerMin = best ? +(best.slope * 60 * 100).toFixed(2) : null;
      const logRise = relPump[relPump.length - 1].logP - relPump[0].logP;
      pumpRisePerBuyBnb = +(logRise / Math.max(totalBuyBnb, 0.001)).toFixed(2);
      pumpSellTickCountPct = +((sellN / ticks.length) * 100).toFixed(1);
    }
  }

  return {
    totalBuyBnb, totalSellBnb, buyN, sellN,
    walletCount: wallets.length,
    top1BuyPct, top2BuyPct,
    routerPct, routerBuyN,
    // D3.62 聚合路由入口占比（G17 N 通道源锚；头注见计算段）
    routerEntryBuyPct,
    unresolvedSenderTickCount,
    churn60sWalletCount,
    sameBlockClusters, equalClusters,
    sameBlockHoldPct, equalBandHoldPct, bundleBuyPct,
    washPairCount, washPairSellPct, washPairBuyPct,
    top1HoldSupplyPct, top1HoldCircPct,
    top2HoldSupplyPct, top1Top2HoldSupplyPct, top1Top2FirstBuyGapSec,
    // D3.60 持有者基数三锚（头注见计算段；holdings_balance 分层判读原料）
    posHolderCount, top1Top2HoldCircPct, top3HoldCircPct,
    clusterHoldSupplyPct, t1PlusClusterSupplyPct, holdingsProfile,
    // D3.41 簇占在场流通两锚（token 域，holdings_balance 档位判读原料）
    sameBlockHoldCircPct, equalBandHoldCircPct,
    // D3.41 簇闭环三键+叙事数组（coordinated_sell_back 跨块闭环判读原料）
    clusterRoundTripPct, clusterRoundTripSellPct, clusterRoundTripBlocks, clusterRoundTrips,
    famousHoldPct, famousTop1Pct, famousFollowerPct, famousDominancePct, famousDominanceLevel, famousFollowerTop3Pct, famousGroupBuyPct,
    ticksPerMin, avgTradeBnb, maxGapSec, idlePct,
    // D3.55 窗口时长/总笔数（act 题④开盘极早窗反锚阈值原料；dt 缺失 null）
    spanSec, tickCount,
    // D3.59 全窗金额三锚+临近段七键（act 题④③⑤/⑦判读原料——CD184 临近段尘单
    // 滴答形状：全窗密度/笔均被开盘段与单笔大额拉高，段内中位/吞吐暴露金额死寂）
    buyMedianBnb, throughputBnbPerMin, maxDrawdownPct,
    nearSegTickN, nearSegTicksPerMin, nearSegBuyMedianBnb, nearSegBnbPerMin,
    nearSegMaxGapSec, nearSegBuyN, nearSegSellN,
    burstWaveBuyBnb, burstWaveWallets,
    // D3.51 burst 尖刺族（头注见 SPIKE_SEC；题面 burst_spike_concentration 判读原料）
    spikePreGapSec, spikeClusterSplit, spikeClusterN, spikeClusterSpanSec, spikeClusterBuyBnb,
    spikeBuyBnb, spikeBuyN, spikeWallets, spikeFromDt, spikeToDt, spikePosPct,
    spikeBuyPctInBurst, spikePosNetBnb, spikeHoldPctAll,
    // D3.57 pump 数值锚族（CD166/CD165/CD175 pump 专项：最长稳定斜率子段三键+
    // log 涨幅÷总买+卖笔占比；slow_grind_pump 题面判读原料，grade 零新增消费）
    pumpStablePoints, pumpStableSpanSec, pumpStableR2,
    pumpStableSlopePctPerMin, pumpRisePerBuyBnb, pumpSellTickCountPct,
    noBuySellPct, noBuySellBnb, noBuySellWallets, noBuySellVolumePct,
    // D3.52 锚窗买卖比（strong_backer_pressure 题原料；观察期 grade 零消费）
    anchorBuySellRatio,
    // D3.53 精确等额同块簇（CD160：equal_amount_split/same_block_buy_wave 题
    // 判读原料；叙事数组仅 state 渲染，数值三键进 observation anchors）
    exactEqualBlockBuyPct, exactEqualBlockClusterCount, exactEqualBlockMaxWallets,
    exactEqualBlockClusters,
    // D3.54 同块脉冲节拍（CD161：abnormal_behavior_ratio/holdings_balance 时间
    // 形状判读原料；pulseGapBlocks/pulseBlockClusters 仅 state 渲染）
    pulseBlockCount, pulseBlockBuyPct, pulseMaxGapBlocks, pulseGapBlocks,
    pulseBlockClusters,
    // D3.58 断流重启段锚族（CD183：same_block_buy_wave/equal_amount_split 题分段
    // 口径判读原料——全窗占比被前期流量稀释，段内占比单独度量；无 ≥300s 间隙
    // 全族 null）
    postStallSpanSec, postStallBuyBnb, postStallBuyerCount,
    postStallFreshBuyerPct, postStallEqualClusterPct, postStallMaxBlockBuyPct,
    // D3.35 协同买入参考四键（abnormal_behavior_ratio 题（D3.39 前 real_participation）参考数值非门槛）+ holdings
    // 补腿（创建者曾持峰值锚；holdingsProfile 项含 circPct 在场流通口径）
    maxBlockBuyCount, maxBlockBuyPct, maxBlockPreGapSec, sameAmountWalletPct,
    creatorPeakHoldSupplyPct, creatorWallet,
    creatorBuyBnb, creatorBuyN, creatorSellBnb, creatorSellN,
    activityLevel, activityCv, activityUneven,
    priceArc: first !== null ? { first, ath, athDt, last } : null,
  };
}

/** 伪钱包判定（wallet 命中聚合路由地址——未解析 sender 的 GMGN 行回退产物） */
function isRouterWallet(wallet) {
  return wallet !== null && AGGREGATOR_ROUTER_ADDRS.has(String(wallet).toLowerCase());
}

/**
 * CD382 盘面重置截窗（2026-11-08 用户裁定，与 BP44 案号 BP39 同日同语义）：
 * 「如果代币到过了 almost_launch 又起来，那么对它的判定也是从 almost_launch
 * 之后的最低点开始」——锚窗内价格回到过 almost_launch = 盘面重新计算，cheat
 * 判定的证据窗重置到 almost_launch 之后的最低点行起（上一轮抢筹/等额分仓/拉高
 * 形状不再进证据窗。案由 bt-s01 0x28ad2c7d：07:14 等额分仓拉高 cheat 拉黑 →
 * 07:15:41 砸回 almost_launch 重判，锚窗内上一轮形状保持 strong=A 主判翻不了案，
 * 翻案时价格已拉离——重置窗使重判只看新一轮）。
 *
 * 判据=BP44 minVsLaunchPct 同款定义（buy-point-snapshot 独立实现，口径由
 * _test_cheat_market_reset 双向锁定——cheat-snapshot 已被 buy-point-snapshot
 * 依赖，反向 import 成环，故 CD 侧独立实现）：launchPrice=平台 curve 初始价常量
 * （2026-11-08 发行价口径修正——four.meme 主流档/flap BNB 盘主力档，第二参
 * platform 传 'fourmeme'/'flap' 时启用，flap 含 quote 盘同 FL 常量（2026-11-09）；
 * gang/null 平台=首可靠价旧口径（不满帽锚窗首行=出生段发行价，capped 由调用方拦））；
 * 涨起后段=首个突破 almost_launch
 * 上界（严格 > 1.1×launchPrice——+10 恰在桶界内不算离开；2026-11-09 almost 20→10）的可靠价起（含离开
 * 那一笔——突破笔本身必然 >+10 不影响「≤+10」判定；创新高不遮蔽回落，ATH
 * 位置无关）全段；段最低 ≤+10%（含破发）=「回到过」→ 重置生效。
 *
 * 价格口径滤 outlier/空/≤0（与 priceArc/可靠价链一致——重置判形状看价格；
 * 资金口径不滤是钱包侧的事）；dt/block 字段不参与判定。
 *
 * @param {Array} rows DB 形状行（price_bnb/price_outlier/block_number/log_index/
 *   block_time/quote_token；到达序无关——内部按链上真序拷贝排序）
 * @param {string|null} [platform] 平台标识（'fourmeme'|'flap'——传则优先 curve
 *   常量锚（flap 含 quote 盘同 FL 常量，2026-11-09）；gang/null=首可靠价旧口径）
 * @returns {null|Object} null=未重置（无可靠价/从未离开 almost_launch/刚离开
 *   无后续/涨起后最低 >+20 没回到过——调用方维持全窗 bit 不变）；
 *   {resetIdx, sortedRows, launchPriceBnb, minPriceBnb, minVsLaunchPct,
 *    resetAt, exitAt}——sortedRows=链上真序全行拷贝（resetIdx 在其上；调用方
 *   直接 slice，防 pull.rows 到达序与排序 idx 错位）；resetIdx=最低点行下标
 *   （重置窗起点=该行含——锚时刻视角的可见最低，锚推移后更低点出现则起点
 *   自然后移，as-of 无前视）；minVsLaunchPct=段最低较发行价 %（toFixed(1)，
 *   破发为负）
 */
function computeMarketResetIndex(rows, platform = null) {
  const sorted = [...(rows || [])].sort((a, b) => {
    const ba = a.block_number ?? 0, bb = b.block_number ?? 0;
    if (ba !== bb) return ba - bb;
    return (a.log_index ?? 0) - (b.log_index ?? 0);
  });
  const isRel = (r) => r.price_bnb != null && r.price_bnb > 0 && r.price_outlier !== true;
  // launchPrice=平台 curve 初始价常量（2026-11-08 发行价口径修正：four.meme 主流档/
  // flap 主力档，用户裁定；2026-11-09 起 quote 盘同 FL 常量）；gang/未知=null
  // 无常量锚回落首可靠价旧口径；无可靠价且无常量锚 → null（宁不重置，不以伪锚翻案）
  // quote 判定=rows 行 quote_token（flap 非 BNB 计价盘行级标记；BNB 盘 null）
  const quoteToken = (rows || []).some((r) => r.quote_token) ? 'quote' : null;
  let launchPrice = resolveLaunchPriceBnb(platform, quoteToken);
  if (launchPrice === null) {
    for (const r of sorted) {
      if (isRel(r)) { launchPrice = r.price_bnb; break; }
    }
  }
  if (launchPrice === null || !(launchPrice > 0)) return null;
  // 涨起点：首个严格 > 1.1×launchPrice 的可靠价（+10 恰等在 almost_launch 桶界内不算离开；
  // 2026-11-09 用户裁定 almost 上界 20→10「基本再次归零」——1.2→1.1 同步）
  const exitThreshold = launchPrice * 1.1;
  let exitIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (isRel(sorted[i]) && sorted[i].price_bnb > exitThreshold) { exitIdx = i; break; }
  }
  // 从未离开 / 刚离开无后续（突破点即末位=无回落证据）→ null 不冒充「回到过」
  if (exitIdx < 0 || exitIdx >= sorted.length - 1) return null;
  // 涨起后段最低（含突破笔）——创新高不遮蔽回落：段最低=突破点之后全部可靠价的最低
  let minIdx = -1, minPrice = null;
  for (let i = exitIdx; i < sorted.length; i++) {
    if (!isRel(sorted[i])) continue;
    const p = sorted[i].price_bnb;
    if (minPrice === null || p < minPrice) { minPrice = p; minIdx = i; }
  }
  if (minIdx < 0 || minPrice === null) return null;
  // 段最低 >+10 = 涨起后没回到过 almost_launch → 不重置（≤ 含恰等与破发）
  if (minPrice > exitThreshold) return null;
  return {
    resetIdx: minIdx,
    sortedRows: sorted,
    launchPriceBnb: launchPrice,
    minPriceBnb: minPrice,
    minVsLaunchPct: +(((minPrice / launchPrice) - 1) * 100).toFixed(1),
    resetAt: sorted[minIdx].block_time ?? null,
    exitAt: sorted[exitIdx].block_time ?? null,
  };
}

module.exports = {
  buildSnapshotFromRows,
  computeDerived,
  aggregateWallets,
  walletOf,
  isRouterWallet,
  computeMarketResetIndex,
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
  PUMP_STABLE_R2,
  PUMP_STABLE_MIN_POINTS,
  POST_STALL_GAP_SEC,
  ROUTER_ENTRY_MIN_BUYS,
};
