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
const { resolveLaunchPriceBnb, floorLaunchPriceBnb } = require('./launch-price');

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
 * CD400 贴锚组织性砸出零承接锚族门限（btv109 P1「B 承接门」四基底验证立法，
 * 2026-11-13）：达标砸块=单块 ≥NEAR_DUMP_MIN_SELLERS 个独立卖方钱包（剔聚合
 * 路由伪钱包，wallet=sender||trader）∧ 块卖额 ≥NEAR_DUMP_MIN_SELL_BNB ∧ 距
 * 窗末 ≤NEAR_DUMP_NEAR_SEC；承接=该块之后（block_number 严格更大——同块买入
 * =对倒痕迹不算承接）到锚的全部新买入 Σ。四基底（btv109 7票 −0.27 全亏 /
 * btv104 3票 +0.06 / btv103-r2 3票 −0.06 / v73 2票 0.00）验证「贴锚达标砸块 ∧
 * 承接 <0.05」为唯一稳定负向形状；臂阈值（承接 <0.05 BNB=不豁免）在
 * CheatCheckService._exemptDeniedReason——锚只述数值事实不产结论。
 */
const NEAR_DUMP_MIN_SELLERS = 4;
const NEAR_DUMP_MIN_SELL_BNB = 0.5;
const NEAR_DUMP_NEAR_SEC = 60;
/**
 * burst 波强度滑窗宽度（G8 弱 burst 代码臂，2026-11-02 批次六 CD37/CD79 用户裁定
 * 「长期停滞突然涌入一波小流量，依然应该算低活跃度，但是如果涌入流量大，才能推翻
 * 低活跃度 结论」）：最密 BURST_WAVE_SEC 秒滑窗（按笔数取最密）内 Σ买入/独立钱包
 * 数=波强度两键；停滞深度第三维复用 maxGapSec（消费=grade E 通道代码臂）。
 */
const BURST_WAVE_SEC = 5;
/**
 * burst 沉积静默段阈值（D3.66，2026-11-10）：「长期沉积」的操作化口径=相邻
 * tick 间隔 ≥此值算一段静默；与 CheatCheckService _isStallBurstExempt gap 腿
 * （burstMaxGapSec≥50，CD383 二修 60→50 M4GA 案）同线——两处同改。
 */
const BURST_STALL_GAP_SEC = 50;
/**
 * burst 单段绑定波搜索窗宽度（D3.67/CD397，2026-11-11 用户裁定「burst 一般只是
 * 一个突然的流量涌入，快速+一定流量，那么 burst 的跨度不能太长」）：「快速」的
 * 操作化=涌入须**紧跟**最后 ≥BURST_STALL_GAP_SEC 静默段出口——单段波只在出口后
 * 此值秒内搜索（出口后拖了几分钟才来的流量不是「一朝」涌入）；跨度的「另一头」
 * （波结束距锚点太长=波已是历史事件）由 burstSecSinceWaveEnd 锚交给 Jev 判读，
 * 代码不设硬线（同裁定第三条「不要魔改，用 Jev 判断」）。量级对标
 * BURST_STALL_GAP_SEC=50（沉积线同族），非校准值——首版待票池分布复采样。
 */
const BURST_SEG_SEARCH_SEC = 60;
/**
 * CD405 burst 捆绑收割去尘线（2026-11-14 btv111 Request C，用户裁定「触发
 * burst 场景的流动性，去掉 dust，捆绑钱包大于等于 7 的挡住」）：波窗（最后
 * ≥BURST_STALL_GAP_SEC 静默段出口后 BURST_SEG_SEARCH_SEC，D3.67 段定位同源）
 * 内 per-block 捆绑买入的钱包计数=块内单钱包买入合计 ≥此值才计入——尘单堆凑
 * 的钱包数不算组织性捆绑（M4GA 案第 5 钱包 0.0010 尘埃单天然门外）。规模线
 * （≥7）在 CheatCheckService._exemptDeniedReason（burst_bundled_wave 臂）。
 */
const BURST_BUNDLE_WALLET_DUST_BNB = 0.01;
/**
 * burst 波搜索段（D3.56→**D3.65 全窗化**）：D3.56（2026-11-04 用户裁定 0xc0a6…7777
 * 案「burst 是指临近购买点位的 burst，不是整体的，前面有不算」）曾收窄为锚前
 * BURST_NEAR_SEC(120s) 临近段；**D3.65（2026-11-10 用户裁定 ba5e/M4GA 案「一个
 * 涨幅这么大倍数的票（涨幅排名前几）不买你玩啥……肯定要修复，这是顶级的好票」）
 * 搜索段扩回锚前全窗**——CD383 沉积前提 burstMaxGapSec 本就是全窗口径、波两键
 * 却限临近段=同臂两键口径不对称；「一朝爆发」不必恰在信号前 120s（ba5e 07:39
 * 出生 3 分钟拉到 +772% 后崩回 +21%，07:52:18 锚临近段死寂无波证据→sbw 判 none
 * +波键 0，豁免结构性无法兑现）。临近段 <2 行 null 语义退役为全窗 <2 行 null；
 * burstMaxGapSec 维持全窗 maxGapSec 不变。G8 弱 burst 臂/strongbacker 判据/
 * sbw 题判读原料随本口径同车全窗化（题集 D3.65）。
 * ⚠D3.65 首版注释曾断言「startVs 随全窗化=全窗首价（=『起来的起点』）：ba5e
 * 低开 +2.85% 放、ad80fb7a 高开 +152% 拒」——部署前对拍取证推翻（182 全量行
 * 实测）：①ba5e 生产拉数被 PostgREST 1000 行帽截断（anchor_tick_count 上界
 * =1000 实证），生产帽窗窗首价 +294.9%>40 拒=立法正例没修好；全窗最密 5s 波
 * =07:42:19 拉峰 frenzy（2.04B/59 笔）波起点 +659.7%，波起点价语义同样过不了；
 * ②ad80fb7a 全窗首价实为高开开盘价 +29.7%≤40 过线=CD392 反例翻案误放
 * （D3.64 旧拒靠临近段首价 +152% 近似才成立，语义随扩窗滑移）。**D3.66 起
 * 第四腿判据源移交 burstExitVsLaunchPct（沉积段出口价，见 burst 计算段头注），
 * burstWaveStartVsLaunchPct 保留纯观察（历史档重放兼容）**。
 */
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
    if (!e) { e = { w: t.wallet, buyBnb: 0, buyN: 0, sellBnb: 0, sellN: 0, buyTok: 0, sellTok: 0, maxBuyBnb: 0, firstBuyDt: null, firstSellDt: null, lastActDt: null, isCreator: false }; byWallet.set(t.wallet, e); }
    const isBuy = t.side === 'BUY';
    const bnb = t.bnb || 0;
    const tok = t.tok || 0; // D3.20：token 数累计（行缺列按 0 容缺——锚在缺列数据上失真时 fail-closed 于键层）
    if (isBuy) { e.buyBnb += bnb; e.buyN++; e.buyTok += tok; if (bnb > e.maxBuyBnb) e.maxBuyBnb = bnb; if (e.firstBuyDt === null) e.firstBuyDt = t.dt; }
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
  // CD394 尾窗键（头注见计算段）：短窗票临近段主锚判读原料
  let nearTail10TickN = null, nearTail10BnbPerMin = null, nearPre20BnbPerMin = null;
  let nearTail5TickN = null, nearTail5BuyN = null, nearTail5BuyBnb = null;
  let nearTail10SellWallets = null;
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

    // ── CD394 尾窗键（2026-11-09 四案裁定「活跃度要以临近买入点附近的行为为准，
    // burst 豁免活跃度低本质就是这个原因」）：D3.59 临近段七键 spanSec ≤
    // NEAR_SEG_SEC 全 null（临近=全窗无对比），短窗票（苍蝇 0x0432…7777 26s 窗
    // 60tick 开盘 ultra，段内 10s 桶 30t→25t→5t 断崖、尾 5s 仅 1 笔纯卖滴答）
    // 临近段数值行缺席=Jev 只能按全窗口径定档（act=high 豁免放行）的结构性盲区。
    // 尾窗键按绝对位置窗恒算（不依赖与全窗的对比语义，短窗照出）：尾 10s（末
    // 10 秒行数/吞吐——「末 10 秒仍持续成交」与「断崖下降」判读）+前 20s（尾
    // 10s 之前 20s 固定窗吞吐，口径与 nearSegBnbPerMin 同为固定窗归一——区内
    // 无行时段摊入分母；零流量=有证据零值 0 非_null，与尾部对比即「静默后涌入」
    // 判读）+尾 5s（行数/买笔/买额——「趋零/纯尘滴答」判读）。dt 缺失全族 null
    // （绝不冒充）。──
    const _lastDt = dts[dts.length - 1];
    let _t10N = 0, _t10Bnb = 0, _t5N = 0, _t5BuyN = 0, _t5BuyBnb = 0, _pre20Bnb = 0;
    const _t10SellW = new Set();
    for (const t of ticks) {
      if (t.dt === null || t.dt === undefined) continue;
      if (t.dt > _lastDt - 10) {
        _t10N++;
        _t10Bnb += t.bnb || 0;
        if (t.side !== 'BUY' && t.wallet) _t10SellW.add(t.wallet);
        if (t.dt > _lastDt - 5) {
          _t5N++;
          if (t.side === 'BUY') { _t5BuyN++; _t5BuyBnb += t.bnb || 0; }
        }
      } else if (t.dt > _lastDt - 30) {
        _pre20Bnb += t.bnb || 0;
      }
    }
    nearTail10TickN = _t10N;
    nearTail10BnbPerMin = +((_t10Bnb / 10) * 60).toFixed(2);
    nearPre20BnbPerMin = +((_pre20Bnb / 20) * 60).toFixed(2);
    nearTail5TickN = _t5N;
    nearTail5BuyN = _t5BuyN;
    nearTail5BuyBnb = +_t5BuyBnb.toFixed(4);
    nearTail10SellWallets = _t10SellW.size;
  }

  // ── burst 波强度两键（G8 弱 burst 代码臂，头注见 BURST_WAVE_SEC/BURST_NEAR_SEC）：
  // 定线研究（tmp-burst-strength@182 17 票 sbw=burst）——豁免挡住的全是自己人（14 票
  // Jev act 已判 low），豁免资格须由波强度承接；人工 healthy 4 票中 3 票 maxGap 仅
  // 19~43s（无停滞=开盘密集正常形状）→ 停滞深度是必要第三维（复用 maxGapSec，
  // grade 侧锚名 burstMaxGapSec）。算法=最密 BURST_WAVE_SEC 秒滑窗双指针（按窗内
  // 笔数取最密），窗内钱包计数 map 精确去重（同钱包多笔逐出时不误删）；dt 缺失
  // 全族 null（绝不冒充）；<2 有效 dt 行波形状不可评同 null。
  // D3.56 起搜索段=锚前 BURST_NEAR_SEC 临近段（头注见 BURST_NEAR_SEC——开盘/中段
  // 波「前面有不算」）。**D3.65（2026-11-10）搜索段扩为锚前全窗**：用户裁定
  // 「一个涨幅这么大倍数的票（涨幅排名前几）不买你玩啥……肯定要修复，这是顶级
  // 的好票」（ba5e/M4GA 案：07:39 出生 3 分钟拉到 +772% 后崩回 +21%，07:52:18
  // t0a 首触发锚临近段死寂无波证据→sbw 判 none+波键 0，CD383「长期沉积一朝操盘」
  // 豁免结构性无法兑现）——沉积前提 burstMaxGapSec 本就是全窗口径、波两键却限
  // 临近段=同臂两键口径不对称；「一朝」不必恰在信号前 120s。全窗化后三判例
  // 全部自洽：M4GA 全窗波 2.04B/59 笔过线+全窗首价 +2.85% 过 startVs 腿=豁免；
  // ad80fb7a 高开 +152% 横盘=全窗首价 +152% 仍拒（「价格维持高位再一个流量
  // 拉升」不豁免语义保持）；gap=2s 开盘密集反例（无沉积）仍拦。──
  let burstWaveBuyBnb = null, burstWaveWallets = null, burstWaveStartVsLaunchPct = null;
  let burstExitVsLaunchPct = null;
  // D3.67/CD397 单段绑定波族（2026-11-11 用户四条裁定——跨度/尘埃/流向/判定权
  // 归 Jev；波=最后 ≥50s 静默段出口 BURST_SEG_SEARCH_SEC 内最密 5s 窗，旧全窗
  // 波两键语义不动=strongbacker §七.5 统计口径保护）：
  //   burstLastGapSec        最后 ≥50s 静默段时长（≠全窗 maxGapSec：max 是最深、
  //                         last 是最近——沉积后又有更短间歇时两者分离）
  //   burstExitWaveFromDt/EndDt 波窗位置（首行 dt / 末笔买入 dt——供 [TICKS] 对照）
  //   burstExitWaveBuyBnb/Wallets  单段波 Σ买入/独立买入钱包数（出口后 60s 内
  //                         无任何买入=有证据零值 0/0，非 null）
  //   burstSecSinceWaveEnd   波末笔买入→锚点（窗末）秒数——「跨度不能太长」主锚
  //                         （idx19 案：波在下跌期、到锚点已是历史事件）
  //   burstWaveWalletNetBnb  波钱包全窗 Σ(买−卖)（可为负=已流出）
  //   burstWaveSellBackPct   波钱包全窗 Σ卖÷Σ买×100（「售卖引发的流量不算」主锚
  //                         ——idx19 回吐 82%/idx198 零买纯卖族）
  //   burstWaveWalletAvgBnb/MedianBnb 波钱包户均/中位买入（「尘埃入仓不算一定
  //                         流量」主锚——idx81/96/170 户均 0.016~0.021 vs idx62/
  //                         63/179 0.050~0.066 硬线不可分=分布形状交 Jev）
  // 无 ≥50s 静默段全族 null（无沉积=无 burst 前提，fail-open 语义：Jev 按 [TICKS]
  // 自行判 none）；dt 缺失全族 null（绝不冒充）。
  let burstLastGapSec = null, burstExitWaveFromDt = null, burstExitWaveEndDt = null;
  let burstExitWaveBuyBnb = null, burstExitWaveWallets = null, burstSecSinceWaveEnd = null;
  let burstWaveWalletNetBnb = null, burstWaveSellBackPct = null;
  let burstWaveNetBnb = null; // CD398 二修：波窗自身净流 Σ(买−卖)（主判量，头注见计算段）
  let burstWaveWalletAvgBnb = null, burstWaveWalletMedianBnb = null;
  // CD401 出口段卖压三键（btv109 P3，2026-11-13 用户裁定立法）：burst 的期望=
  // **纯流入驱动**（用户突然发现好票/好票开始传播/庄开始收筹码坐庄）——出口段
  // （最后 ≥50s 静默段出口→锚整窗，与 D3.67 段定位同锚）卖出占比高都不符合
  // burst 期望：先买后跟着卖=涨不下去不算 burst；先卖后买两者隔得近=卖出引来
  // 的买入非自发涌入（「这 burst 中卖出占比高，都不太好，虽然可能会有误伤」）。
  // 门臂=卖占比 ≥30% ∧ 卖额 ≥0.3 BNB（denied 'burst_exit_sell_pressure'，阈值在
  // CheatCheckService._exemptDeniedReason）；两族形状都拦（波前卖=MBF/我靠案、
  // 波中后卖=网上南宁/callcat 案——四基底 8 票全非正零盈利误伤，三大赢家卖%=0
  // 天然安全）。非 FA 投影消费（CD400 nearDump 同形：进 levelsFromObservation
  // 白名单但不进 FA 投影/state/题面）；无 ≥50s 段/dt 缺失 → 全族 null 容缺不触发。
  let burstExitSegBuyBnb = null, burstExitSegSellBnb = null, burstExitSegSellPct = null;
  // CD405 burst 捆绑收割两键（2026-11-14 btv111 Request C，用户裁定「Burst 中
  // 出现大量捆绑买入（拉高收割），我认为这个形态也要拒绝，这摆明了不给任何人
  // 入场机会，收割的概率很高」+定线「只控制极端情况就好……去掉 dust，捆绑钱包
  // 大于等于 7 的挡住；T022 这种如果是连续 2 个 slot 数量够了，也可以挡住」）：
  //   burstWaveBundleMaxWallets  波窗（出口后 60s=_zone，D3.67 段定位同源）单块
  //                             去尘捆绑钱包数最大值（Callcat 案同块 13 钱包）
  //   burstWaveBundleAdjPairSum  相邻两 slot（block 差恰 1）去尘钱包数合计最大值
  //                             （Crypto Winter 案 2+6=8——连续 slot 分批=同批
  //                             bundler 跨块拆分的组织性形状；合计口径=用户裁定
  //                             「连续 2 个 slot 数量够了」）
  // 去尘=块内单钱包买入合计 ≥BURST_BUNDLE_WALLET_DUST_BNB 才计数；剔聚合路由
  // 伪钱包（wallet=sender||trader 小写）；block 缺失行不进块统计（CD400 同款）。
  // 无 ≥50s 静默段 → 全族 null（burst 语境缺席=臂不触发，不扩大收紧面）；有段
  // 波窗无买块/无相邻对 → 0 有证据零值。阈值（≥7）在 CheatCheckService.
  // _exemptDeniedReason（burst_bundled_wave 臂）；非 FA 投影/题面消费（CD400/
  // CD401 同形）。
  let burstWaveBundleMaxWallets = null, burstWaveBundleAdjPairSum = null;
  const waveTicksAll = ticks.filter((t) => t.dt !== null && t.dt !== undefined);
  if (waveTicksAll.length >= 2) {
    const waveTicks = waveTicksAll; // D3.65：锚前全窗（D3.56 临近段过滤退役，见上头注）
    // 最后 ≥BURST_STALL_GAP_SEC 静默段（D3.66 起为 burstExitVsLaunchPct 扫描域；
    // D3.67 起提升为单段波族的绑定锚——「最近一次沉积」而非「最深沉积」）
    let _lastGapIdx = -1;
    for (let i = 1; i < waveTicksAll.length; i++) {
      if (waveTicksAll[i].dt - waveTicksAll[i - 1].dt >= BURST_STALL_GAP_SEC) _lastGapIdx = i;
    }
    {
      // CD392（2026-11-09 ad80fb7a 案）：burst 波起点价锚——D3.56-D3.64 为临近段
      // 首价、D3.65 起随搜索段全窗化变全窗首个可靠价 vs 发行价常量 %。用户裁定
      // 「burst 是指 价格跌到很低再起来，不是价格维持高位再一个流量拉升」。
      // **D3.66（2026-11-10）起退出第四腿判据源、保留纯观察**（历史档重放兼容
      // +波结构留档）：对拍取证证明「窗首价/波起点价」都不能表达「起来的起点」
      // （见文件头注 ⚠段——ba5e 全窗首价 +2.9% 但生产 1000 帽窗窗首 +294.9% 拒/
      // 最密波=拉峰 frenzy 波起点 +659.7%；ad80fb7a 高开全窗首价 +29.7% 误放）。
      const _quoteTk = waveTicks.some((t) => t.quote) ? 'quote' : null;
      // T130 地板补丁同源（launch=min(常量, 首笔买入可靠价)，锚窗首笔 BUY 行）——
      // 低开票（67ad68e0/6efa11ce 案）以常量为分母会把波起点位置整体抬高，
      // 与 FA/BP 的 currentVsLaunchPct 同锚换（capped 满帽窗不含出生段时窗内
      // 首买=可得最早，宁用不冒充缺锚 null）；
      // **T134 滚动地板（2026-11-11 族一 9/9 案，用户方案三）**：地板原料推广为
      // 锚窗 waveTicksAll 全量最低可靠价（运行期新低同修、sell 低价也算；截窗窗内
      // min ≥ 全局 min=锚只偏高不冒充）——与 FA `_minRelPriceBnb`/BP rel min 三点同源
      const _constLaunch = resolveLaunchPriceBnb(
        snapshot.tokenMeta ? snapshot.tokenMeta.platform : null, _quoteTk);
      let _minRel = 0;
      for (const t of waveTicksAll) {
        if (!t.outlier && t.priceBnb > 0 && (_minRel === 0 || t.priceBnb < _minRel)) _minRel = t.priceBnb;
      }
      const _launch = _constLaunch !== null && _constLaunch > 0
        ? floorLaunchPriceBnb(_constLaunch, _minRel)
        : null;
      if (_launch !== null && _launch > 0) {
        const _firstRel = waveTicks.find((t) => !t.outlier && t.priceBnb > 0);
        if (_firstRel) burstWaveStartVsLaunchPct = +(((_firstRel.priceBnb / _launch) - 1) * 100).toFixed(1);
        // D3.66（2026-11-10 用户裁定）：burst 豁免第四腿判据源=**起来起点价**
        // burstExitVsLaunchPct——最后一个 ≥BURST_STALL_GAP_SEC 静默段的出口首
        // 可靠价 vs launch 地板（T130 地板同分母）。「价格跌到很低再起来」的
        // 「起来」=沉积结束重新启动的那一刻，出口价即起来时的价格水平；高位
        // 横盘的间歇静默出口仍高位（ad80fb7a +161.3% 拒）、「跌下来沉积后再起」
        // 出口在低域（ba5e 最后静默段 07:50:32→07:51:40 出口 +35.4% 放；M4GA/
        // CD383 原案 +2.9% 放）。刻意不取段内最低/锚时刻现价：CD392 台账「取
        // 最低会放行高位砸落再弹形状」（ad80 末段砸落 +17.5% 必须拒）。扫描域
        // =waveTicksAll（dt 过滤序与 maxGapSec 的 dts 同源，静默段与 gap 腿
        // ≥50 判据 bit 同口径：gap 腿过 ⟺ 至少一段 ≥50s 静默）。null 条件：
        // 无 ≥50s 段（gap 腿本就不过）/段后无可靠价/launch 地板缺失（无常量
        // 平台）→ fail-closed 不授予（与 CD383 gap null「不扩大收紧面」不同向
        // ——本臂是资格授予方向，形状不可判宁不授予）。不受 PostgREST 1000 行
        // 帽影响（出口段在锚侧，帽窗内必含）。**D3.67/CD397 起第四腿代码门整体
        // 退役（判定权归 Jev），本锚保留为题面「位置参考」事实**。
        if (_lastGapIdx >= 0) {
          const _exitRel = waveTicksAll.slice(_lastGapIdx).find((t) => !t.outlier && t.priceBnb > 0);
          if (_exitRel) burstExitVsLaunchPct = +(((_exitRel.priceBnb / _launch) - 1) * 100).toFixed(1);
        }
      }
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
    // ── D3.67/CD397 单段绑定波（头注见 BURST_SEG_SEARCH_SEC 与本段变量声明注）：
    // 绑定锚=「最近一次 ≥50s 沉积」的出口行（waveTicksAll[_lastGapIdx]）——三锚
    // （gap/波/出口价）从各自独立测量（全窗最深 gap + 全窗最密波 + 最后段出口价
    // 互不绑定，波与静默可相隔数分钟）收敛为单段绑定：波=出口后 60s 内最密 5s
    // 窗（与全窗波同款双指针按笔数取最密，钱包精确去重）；波钱包全窗买卖净值/
    // 卖回率/户均/中位=「尘埃 vs 真实流量」「涌入 vs 流出」两判轴的原料。所有
    // 数值只是事实，跨度/尘埃/流向的判读全归 Jev（裁定第三条），代码零硬线。
    if (_lastGapIdx >= 1) {
      const _exitTick = waveTicksAll[_lastGapIdx];
      burstLastGapSec = _exitTick.dt - waveTicksAll[_lastGapIdx - 1].dt;
      const _zone = [];
      for (let i = _lastGapIdx; i < waveTicksAll.length; i++) {
        if (waveTicksAll[i].dt - _exitTick.dt > BURST_SEG_SEARCH_SEC) break;
        _zone.push(waveTicksAll[i]);
      }
      let j = 0, curN = 0, bestN = 0, bestL = 0, bestR = -1;
      for (let i = 0; i < _zone.length; i++) {
        const t = _zone[i];
        curN++;
        while (t.dt - _zone[j].dt > BURST_WAVE_SEC) { curN--; j++; }
        if (curN > bestN) { bestN = curN; bestL = j; bestR = i; }
      }
      if (bestR >= 0) {
        const _win = _zone.slice(bestL, bestR + 1);
        burstExitWaveFromDt = _win[0].dt;
        // CD398 二修（2026-11-11 谷歌SI 对拍实锤）：波窗**自身**净流 Σ(买−卖)
        // （全行参与，不挑边）——「卖家发起的波」只有这个量看得见：波钱包全窗
        // 净额的分子只收波内买家（谷歌SI 巨鲸只在波内卖 → 不进买家集 → 首版
        // 硬腿 +0.0367 放行=对立法案本身失明）；窗内零 BUY（纯卖窗）同样在此
        // 可负（波钱包族那组键零买缺席，本键独立成立）。卖单直接进分子，符号
        // 即「流量涌入 vs 流出」，CD398 `_isStallBurstExempt` 主判量。
        burstWaveNetBnb = +_win.reduce((s, t) => s + (t.side === 'BUY' ? (t.bnb || 0) : -(t.bnb || 0)), 0).toFixed(4);
        // 波=买入方向的流量涌入：波窗位置=首行 dt，波结束=窗内末笔 BUY dt
        // （此后窗内只剩卖行=流出尾巴不算涌入的一部分）；窗内零 BUY=波值为
        // 有证据零值（0/0），位置/跨度/钱包族 null（无涌入可量）
        const _buyRows = _win.filter((t) => t.side === 'BUY');
        let _lastBuyDt = null;
        for (const t of _buyRows) if (_lastBuyDt === null || t.dt > _lastBuyDt) _lastBuyDt = t.dt;
        burstExitWaveEndDt = _lastBuyDt;
        burstExitWaveBuyBnb = +_buyRows.reduce((s, t) => s + (t.bnb || 0), 0).toFixed(4);
        const _waveWalletBuys = new Map(); // wallet → 波窗内 Σ买
        for (const t of _buyRows) {
          if (!t.wallet) continue;
          _waveWalletBuys.set(t.wallet, (_waveWalletBuys.get(t.wallet) || 0) + (t.bnb || 0));
        }
        burstExitWaveWallets = _waveWalletBuys.size;
        if (_buyRows.length > 0 && _waveWalletBuys.size > 0) {
          const _sums = [..._waveWalletBuys.values()].sort((a, b) => a - b);
          const _mid = Math.floor(_sums.length / 2);
          burstWaveWalletMedianBnb = +(_sums.length % 2 ? _sums[_mid] : (_sums[_mid - 1] + _sums[_mid]) / 2).toFixed(4);
          // 户均与中位同分布（map 值之和÷户数）：无 wallet 行不计入（wallet=null
          // 行计量不计人，与 FA wallet 口径一致），否则分子抬高户均虚胖
          burstWaveWalletAvgBnb = +(_sums.reduce((a, b) => a + b, 0) / _waveWalletBuys.size).toFixed(4);
          // 波钱包全窗净额/卖回率（流向轴原料：wallet=sender||trader，null wallet
          // 行计量不计人；卖回率分母=波钱包全窗 Σ买 ≥ 波窗 Σ买 >0 恒成立）
          let _wb = 0, _ws = 0;
          for (const t of waveTicksAll) {
            if (!t.wallet || !_waveWalletBuys.has(t.wallet)) continue;
            if (t.side === 'BUY') _wb += t.bnb || 0; else _ws += t.bnb || 0;
          }
          burstWaveWalletNetBnb = +(_wb - _ws).toFixed(4);
          burstWaveSellBackPct = +((_ws / _wb) * 100).toFixed(1);
          if (_lastBuyDt !== null) {
            burstSecSinceWaveEnd = waveTicksAll[waveTicksAll.length - 1].dt - _lastBuyDt;
          }
        }
      } else {
        // 出口后 60s 内一行都没有（沉积是窗末段、锚=出口前）→ 波值零语义缺席
        burstExitWaveBuyBnb = 0;
        burstExitWaveWallets = 0;
      }
      // CD401 出口段卖压（头注见变量声明区）：出口整窗=出口行→窗末全行（不限于
      // 60s 搜索域——与探针口径 bit 一致：MBF 出口→锚 58s、我靠 25s 全窗计入）；
      // 资金不滤 outlier（CD 全窗买卖口径同款）；出口行自身在场故 buy+sell>0
      // 恒成立，防御性 0 值 → sellPct=null（宁拦不冒充方向）
      const _seg = waveTicksAll.slice(_lastGapIdx);
      let _segBuy = 0, _segSell = 0;
      for (const t of _seg) {
        if (t.side === 'BUY') _segBuy += t.bnb || 0; else _segSell += t.bnb || 0;
      }
      burstExitSegBuyBnb = +_segBuy.toFixed(4);
      burstExitSegSellBnb = +_segSell.toFixed(4);
      if (_segBuy + _segSell > 0) burstExitSegSellPct = +((_segSell / (_segBuy + _segSell)) * 100).toFixed(1);
      // CD405 burst 捆绑收割两键（头注见变量声明区）：波窗=上方 _zone（出口后
      // 60s 搜索域整体，非其中最密 5s 子窗——捆绑结构看整个涌入段）；per-block
      // Map(钱包→块内 Σ买) → 去尘钱包数 → 单块最大值 + 相邻两 slot 合计最大值。
      // 有段即置 0/0 基线（波窗无买块/无相邻对=有证据零值，与 burstExitWaveBuyBnb
      // =0 同款语义）；无段保持 null=臂不触发
      {
        burstWaveBundleMaxWallets = 0;
        burstWaveBundleAdjPairSum = 0;
        const _blockBuys = new Map(); // block → Map(wallet → 块内 Σ买)
        for (const t of _zone) {
          if (t.side !== 'BUY' || t.block === null || t.block === undefined) continue;
          if (!t.wallet) continue; // null wallet 行计量不计人（FA wallet 口径同款）
          const _bw2 = String(t.wallet).toLowerCase();
          if (isRouterWallet(_bw2)) continue;
          let _per = _blockBuys.get(t.block);
          if (!_per) { _per = new Map(); _blockBuys.set(t.block, _per); }
          _per.set(_bw2, (_per.get(_bw2) || 0) + (t.bnb || 0));
        }
        const _bl2 = [..._blockBuys.entries()]
          .map(([block, perWallet]) => ({
            block,
            n: [...perWallet.values()].filter((v) => v >= BURST_BUNDLE_WALLET_DUST_BNB).length,
          }))
          .sort((a, b) => a.block - b.block);
        for (const b of _bl2) if (b.n > burstWaveBundleMaxWallets) burstWaveBundleMaxWallets = b.n;
        for (let i = 1; i < _bl2.length; i++) {
          if (_bl2[i].block - _bl2[i - 1].block !== 1) continue; // 相邻 slot=block 差恰 1
          const _s = _bl2[i].n + _bl2[i - 1].n;
          if (_s > burstWaveBundleAdjPairSum) burstWaveBundleAdjPairSum = _s;
        }
      }
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

  // ── CD400 贴锚组织性砸出零承接锚族（btv109 P1「B 承接门」，2026-11-13）：
  // 锚窗末 ≤NEAR_DUMP_NEAR_SEC 内的达标砸块（头注见常量区）+ 块后到锚的新买入
  // 承接——「组织性拉起→砸出后无人接盘」形状的数值事实（多达标块取承接最小者
  // =最恶性块；块统计 wallet 小写去重、剔聚合路由（买卖两腿同剔——B 门验证
  // 口径）；block_number 缺失行不进块统计（sameBlockClusters 同款）；无达标块/
  // dt 缺失 → 全族 null 不冒充=denied 臂不触发不扩大收紧面）。距锚=窗末（最后
  // 一个 dt 非空行——burstSecSinceWaveEnd 同约定：信号 per-tick 触发（T132）锚
  // 窗末≈信号时刻）。门臂阈值在 CheatCheckService._exemptDeniedReason（dump_no_
  // absorption），锚不进 state/题面（G17 N 通道「纯代码数值门」先例）──
  let nearDumpQualBlocks = null, nearDumpMinAbsorbBnb = null;
  let nearDumpWorstSellers = null, nearDumpWorstSellBnb = null;
  let nearDumpWorstSecToAnchor = null, nearDumpWorstSameBlkBuyBnb = null;
  {
    let _anchorDt = null;
    for (let i = ticks.length - 1; i >= 0; i--) {
      if (ticks[i].dt !== null && ticks[i].dt !== undefined) { _anchorDt = ticks[i].dt; break; }
    }
    const _blockAgg = new Map(); // block → {lastDt, sellBnb, buyBnb, sellers:Set}
    if (_anchorDt !== null) {
      for (const t of ticks) {
        if (t.block === null || t.block === undefined) continue;
        if (!t.wallet) continue; // null wallet 行计量不计人（FA wallet 口径同款）
        const _w = String(t.wallet).toLowerCase();
        if (isRouterWallet(_w)) continue;
        let b = _blockAgg.get(t.block);
        if (!b) { b = { block: t.block, lastDt: null, sellBnb: 0, buyBnb: 0, sellers: new Set() }; _blockAgg.set(t.block, b); }
        if (t.side === 'BUY') b.buyBnb += t.bnb || 0;
        else { b.sellBnb += t.bnb || 0; b.sellers.add(_w); }
        if (t.dt !== null && t.dt !== undefined && (b.lastDt === null || t.dt > b.lastDt)) b.lastDt = t.dt;
      }
    }
    if (_blockAgg.size) {
      const _bl = [..._blockAgg.values()].sort((a, b) => a.block - b.block);
      // 后缀买入和（承接=该块之后全部 BUY——block 严格更大，同块买入只进观察键）
      const _suffix = new Array(_bl.length + 1).fill(0);
      for (let i = _bl.length - 1; i >= 0; i--) _suffix[i] = _suffix[i + 1] + _bl[i].buyBnb;
      let _qualN = 0, _worst = null;
      for (let i = 0; i < _bl.length; i++) {
        const b = _bl[i];
        if (b.sellers.size < NEAR_DUMP_MIN_SELLERS) continue;
        if (b.sellBnb < NEAR_DUMP_MIN_SELL_BNB) continue;
        if (b.lastDt === null || _anchorDt - b.lastDt > NEAR_DUMP_NEAR_SEC) continue; // 贴锚窗（dt 缺失不算 near）
        _qualN++;
        const _absorb = +_suffix[i + 1].toFixed(4);
        if (!_worst || _absorb < _worst.absorb) _worst = { ...b, absorb: _absorb };
      }
      if (_qualN > 0 && _worst) {
        nearDumpQualBlocks = _qualN;
        nearDumpMinAbsorbBnb = _worst.absorb;
        nearDumpWorstSellers = _worst.sellers.size;
        nearDumpWorstSellBnb = +_worst.sellBnb.toFixed(4);
        nearDumpWorstSecToAnchor = _anchorDt - _worst.lastDt;
        nearDumpWorstSameBlkBuyBnb = +_worst.buyBnb.toFixed(4);
      }
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
    // CD394 尾窗键（act 题⑦定档主锚判读原料——尾 10s/前 20s/尾 5s）
    nearTail10TickN, nearTail10BnbPerMin, nearPre20BnbPerMin,
    nearTail5TickN, nearTail5BuyN, nearTail5BuyBnb, nearTail10SellWallets,
    burstWaveBuyBnb, burstWaveWallets,
    // CD392 burst 波起点价锚（D3.66 起纯观察——第四腿判据源移交 burstExitVsLaunchPct）
    burstWaveStartVsLaunchPct,
    // D3.66 burst 起来起点价锚（最后 ≥BURST_STALL_GAP_SEC 静默段出口首可靠价 vs
    // launch 地板；D3.67/CD397 起第四腿代码门退役、保留为题面「位置参考」事实）
    burstExitVsLaunchPct,
    // D3.67/CD397 单段绑定波族十键（sbw 题 state 直供原料——三判轴=跨度
    // secSinceWaveEnd/尘埃 户均+中位/流向 净额+卖回率；头注见计算段。旧全窗
    // 波两键语义刻意不动=strongbacker §七.5 统计口径保护，两族并存）
    burstLastGapSec, burstExitWaveFromDt, burstExitWaveEndDt,
    burstExitWaveBuyBnb, burstExitWaveWallets, burstSecSinceWaveEnd,
    burstWaveWalletNetBnb, burstWaveSellBackPct, burstWaveNetBnb,
    burstWaveWalletAvgBnb, burstWaveWalletMedianBnb,
    // CD401 出口段卖压三键（burst_exit_sell_pressure 不豁免臂判据源——出口整窗
    // 买/卖/卖%；头注见变量声明区；非 FA 投影消费）
    burstExitSegBuyBnb, burstExitSegSellBnb, burstExitSegSellPct,
    // CD405 burst 捆绑收割两键（burst_bundled_wave 不豁免臂判据源——波窗单块/
    // 相邻两 slot 去尘捆绑钱包数；无 ≥50s 段全族 null 不冒充；头注见计算段）
    burstWaveBundleMaxWallets, burstWaveBundleAdjPairSum,
    // CD400 贴锚组织性砸出零承接锚族六键（CheatCheckService._exemptDeniedReason
    // dump_no_absorption 臂判据源；无达标块/dt 缺失全族 null 不冒充；头注见计算段）
    nearDumpQualBlocks, nearDumpMinAbsorbBnb,
    nearDumpWorstSellers, nearDumpWorstSellBnb,
    nearDumpWorstSecToAnchor, nearDumpWorstSameBlkBuyBnb,
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

// CD393（2026-11-09）：CD382 盘面重置截窗 computeMarketResetIndex 整链退役（用户裁定
// 6a1e4567 案——重置窗行数不足反而拦买「ticks 不够，更买入不了了」）；生产 _chain 5b、
// 回归 runner 三拉数点、digest.marketReset 键同步退役。BP 侧 minVsLaunchPct/restart 桶
// （buy-point-snapshot 独立实现）不动——BP 锚窗从不受截断影响。历史行带 marketReset
// 键照留档（读侧不再产出）。

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
  PUMP_STABLE_R2,
  PUMP_STABLE_MIN_POINTS,
  POST_STALL_GAP_SEC,
  ROUTER_ENTRY_MIN_BUYS,
};
