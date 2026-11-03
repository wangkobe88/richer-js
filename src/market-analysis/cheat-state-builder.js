/**
 * 作弊盘检测 state 构建（CD1）——纯函数，零 DB 零网络
 *
 * CheatSnapshot → Jev 纯文本 state（照 jev-state-builder 多段拼接形状，预算 20k）。
 * 分区：[TOKEN]（含 quote 盘换算口径注记）→ [ANCHOR]（as-of 声明：截至第 N 笔
 * tick，判定对象=时点盘面状态非终身属性）→ [PRECOMPUTED]（代码端已算事实，
 * Jev 直接采信）→ [TICKS]（链上真序逐笔行）→ [WALLETS]（per-wallet 聚合行）
 * → [判定指引]。
 *
 * 采信原则（叙事侧 [PRECOMPUTED] 同款）：统计事实代码端已定，Jev 的任务是这些
 * 事实编不出的判断——谁在主导资金流、节奏是否协同。
 *
 * 截断防线：tick >300 → 首 200 + 末 100（launch 窗 + 近端流两段保留，截断声明
 * 进段头）；[WALLETS] >40 行 → 按买入额留 top 40；终串超 20k → 按字符硬截 + 头部
 * 声明（jev_prompt 落库全文=截断可追溯）。
 */

const MAX_STATE_CHARS = 20000;
const TICK_SHOW_MAX = 300;
const TICK_HEAD_KEEP = 200;
const WALLET_SHOW_MAX = 40;

const { isRouterWallet } = require('./cheat-snapshot');

/** 金额展示：≥0.01 三位小数，更小四位（尘埃量级不失真） */
function fmtBnb(x) {
  if (x === null || x === undefined) return '?';
  return x >= 0.01 ? x.toFixed(3) : x.toFixed(4);
}

/** 价格展示：科学计数（meme 币价 1e-9 量级，定点小数不可读） */
function fmtPrice(p) {
  if (p === null || p === undefined) return '?';
  return p.toExponential(2);
}

/** 钱包短标识：0x + 首 6 + … + 尾 4（Jev 只需相关性比对不需全址） */
function shortWallet(w) {
  if (!w) return 'UNKNOWN';
  const s = String(w);
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function fmtDt(dt) {
  return dt === null || dt === undefined ? '?' : `t+${dt}s`;
}

/**
 * snapshot → state 纯文本
 * @param {Object} snapshot - buildSnapshotFromRows 产物
 * @returns {{ state: string, promptChars: number, truncated: Object }}
 */
function buildCheatState(snapshot) {
  const meta = snapshot.tokenMeta || {};
  const d = snapshot.derived || {};
  const parts = [];
  const truncated = { ticks: false, wallets: false, hardCap: false };

  // ── [TOKEN] ──
  {
    const lines = [];
    lines.push(`address=${meta.address || '?'} symbol=${meta.symbol || '?'} name=${meta.name || '?'} platform=${meta.platform || '?'}`);
    if (meta.quoteToken) {
      lines.push(`quote_token=${meta.quoteToken}（非 BNB 计价盘：下列 bnb 金额已在写入时换算为 BNB 域，读侧照抄；换算失败的链上交易整行不入表=本窗口可能缺行）`);
    }
    lines.push(`created=${meta.createdAt || '?'} creator=${meta.creatorAddress ? shortWallet(meta.creatorAddress) : 'unknown'}` +
      // D3.9：创建交易哈希前 8 位（与 [TICKS] tx= 同域——创建+首买同笔可对上；缺失不渲染）
      (meta.createTxHash ? ` createTx=${String(meta.createTxHash).replace(/^0x/, '').slice(0, 8)}` : ''));
    if (snapshot.dtBase === 'first_tick') {
      lines.push('⚠ token 创建时间缺失：t+Ns 基准退化为首 tick 时刻（非创建时刻）');
    }
    lines.push('聚合路由（GMGN）机制：大量下单方共用一个路由合约成交，真人 bot 都常走——走路由本身不区分真人/自动化；[TICKS] 行的 w= 为该笔实际发起地址。发起人无法解析的行显示 w=UNRESOLVED*（证据洞，不计入任何钱包）。');
    parts.push(`[TOKEN]\n${lines.join('\n')}`);
  }

  // ── [ANCHOR] ──
  parts.push(`[ANCHOR]\n本材料 = 截至第 ${snapshot.anchor.tickCount} 笔 tick 的 as-of 切片${snapshot.capped ? '（token 历史超拉数帽：窗口=最早一段+最近一段，中段未含——统计仅基于窗口内行）' : ''}。判定对象=截至此锚的盘面状态，不是 token 终身属性。`);

  // ── [PRECOMPUTED] ──
  {
    const lines = [];
    lines.push(`总买入 ${fmtBnb(d.totalBuyBnb)} BNB / ${d.buyN} 笔；总卖出 ${fmtBnb(d.totalSellBnb)} BNB / ${d.sellN} 笔`);
    lines.push(`独立钱包数（已剔除聚合路由伪钱包）: ${d.walletCount}`);
    if (d.top1BuyPct !== null) {
      lines.push(`买入 top1 钱包占比 ${d.top1BuyPct.toFixed(1)}%` + (d.top2BuyPct !== null ? ` / top2 合计 ${d.top2BuyPct.toFixed(1)}%` : '') + '（分母=总买入，剔除 router 伪钱包；仅作盘面健康参考，不作作弊判据）');
    } else {
      lines.push('买入 top1 钱包占比: 无可归因买入');
    }
    // D3.1 买侧簇结构占比锚三行已撤（2026-11-02 CD133 用户裁定：sb∪eq 并集圈定
    // 吞 GMGN 前端默认档散户「误伤就太大了……还是把原始数据输入给Jev，通过现象
    // 描述，去综合判断与考量里面是否有协同行为」——同块簇持仓占比/近等额簇持仓
    // 占比/簇买入占比不再渲染，同块/等额结构指纹由 Jev 从 [TICKS]/[WALLETS] 原始
    // 逐笔归纳，判读教学在 equal_amount_split / same_block_buy_wave 题面单一载体
    // （D3.34）；derived 照算供 digest 存档/FA 投影/runner 观测）；routerPct 行
    // 已删（2026-10-31 用户裁定：作弊钱包同样走路由，无判别价值）
    // D3.28 同块对敲锚（CD27 用户裁定「对倒交易非常严重」）：同块一卖一买 ±2% 带
    // 内配对=左手换右手换手的直接度量；无配对不渲染行（缺席语义）
    if (d.washPairCount !== null && d.washPairCount !== undefined) {
      lines.push(`同块对敲: ${d.washPairCount} 对，配对买额占全部卖出 ${d.washPairSellPct === null ? '—' : d.washPairSellPct.toFixed(1) + '%'} / 占全部买入 ${d.washPairBuyPct === null ? '—' : d.washPairBuyPct.toFixed(1) + '%'}（同一 block 内一笔卖出与一笔买入金额 ±2% 带内配对、每笔卖出至多配一次；自然交易中同块等额一卖一买发生率≈0，对数与占比一起看）`);
    }
    // G8 零买入纯卖方数值行（2026-11-02 批次六 CD5「创建者通过代币转入方式卖出」
    // 裁定）：Transfer 事件不在采集域，链外分仓接收户在 swap 域只呈现「无买入
    // 来源的卖方」形状——数值事实行供 insider_supply_sell 题判档（档位仍 Jev，
    // D3.5 边界不变；K/L 通道消费同源锚）；总卖=0 不渲染行（缺席语义）
    if (d.noBuySellPct !== null && d.noBuySellPct !== undefined) {
      lines.push(`零买入纯卖方: ${d.noBuySellWallets} 个钱包（窗内零买入、只卖出）合计卖出 ${fmtBnb(d.noBuySellBnb)} BNB，占全部卖出 ${d.noBuySellPct.toFixed(1)}%（口径：钱包聚合已剔聚合路由伪钱包；是否存在链外转入分仓出货由你结合 insider_supply_sell 判断）`);
    }
    // D3.36 同档金额参考（D3.35 单块三键撤出 state 输入——2026-11-02 用户裁定
    // 「单块也是这个问题，如果这个数据给结果会造成困扰，我不建议放到数据输入中」：
    // CD60 ultra 活跃盘撞块 12 笔仅占 3%/CD104 吃独食 2 笔占 58.7% 两误伤形状里
    // 单块数值制造噪音大于信息；单块三键 snapshot 照算留 FA 投影/研究侧不进
    // Jev 输入。sameAmountWalletPct 非单块口径（全窗同档金额去重钱包占比=
    // GMGN 前端默认档指纹）保留；**参考非门槛**，正常盘往往也有一点作弊痕迹，
    // 组织性程度由 Jev 以交易者身份结合 [TICKS] 时间序列综合判读；无买入不渲染行
    // D3.37 措辞去误导（2026-11-02 用户裁定「真实盘以前端默认档（0.1/0.05）为
    // 众数 我怕对 Jev 造成误导，好盘不一定众数落在这个区间」）：原文「使真实散户
    // 盘天然聚档」预设真实盘必然聚档——聚档可以真实（前端默认值使然）但真实盘
    // 不必然聚档，众数档位不是判据（大热盘/大户进场的真实盘众数可上移）
    if (d.sameAmountWalletPct !== null && d.sameAmountWalletPct !== undefined) {
      lines.push(`同档金额参考: 最大同档金额的钱包去重占全部买入钱包 ${d.sameAmountWalletPct.toFixed(1)}%（参考数值非门槛——同档聚集可以来自前端默认交易额（0.1/0.05 档）等真实来源，但真实盘不必然聚档、众数落在哪一档不是判据；跨块长尾同档=跟风非分仓；真实用户像不像，由你结合 [TICKS] 时间/金额/行为序列综合判断）`);
    }
    // D3.38 单块买入集中度形状行（CD135 续，2026-11-02 用户裁定换喂法 C——
    // 「形状提示不给具体数字降锚定力」）：D3.36 撤出精确数字后 CD6 回退
    // （minimal 0.66→meaningful 0.4 放行——单块集中形状有信息量），而撤前
    // CD104/CD60 被精确数字（58.7%/12 笔）锚定误伤——问题在伪精度不在形状；
    // 本行只给档位定性不给数值：占比三档（<10/10-30/≥30）+前摇定性档
    // （≥30s 明显静默/5-30s 短暂静默/<5s 不注），笔数刻意不给（CD60 教训=
    // ultra 活跃盘 12 笔仅占 3%，笔数单独看是噪音、占比才是分母）；无买入不渲染
    if (d.maxBlockBuyPct !== null && d.maxBlockBuyPct !== undefined) {
      const tier = d.maxBlockBuyPct < 10 ? '不足一成，散布常态'
        : d.maxBlockBuyPct < 30 ? '一至三成，存在集中段'
        : '三成以上，高度集中段';
      const gap = d.maxBlockPreGapSec === null || d.maxBlockPreGapSec === undefined
        ? '（该块为首个买块，无前摇证据）'
        : d.maxBlockPreGapSec >= 30 ? '（此前有明显静默段）'
          : d.maxBlockPreGapSec >= 5 ? '（此前有短暂静默）' : '';
      lines.push(`单块买入集中度: 最大单块买入占窗口总买入【${tier}】${gap}——形状参考非门槛：高活跃盘与开盘打新段单块多为独立买家并发（撞块常态），占比档位高本身不定性；须配行为同质或阵列结构（同额/成对节拍/同批钱包复现/同 tx 打包）才算组织化痕迹；单个大买家吃独食也是此形状（判掌控看「单一钱包持仓集中度」行的当前持有占总供应量）`);
    }
    // D3.20 单一钱包持仓集中双锚（用户裁定 2026-11-01 CD69 语境：一个钱包持有
    // 总额度占比过大=控盘事实证据；占供应量低但占流通量高=在场筹码少所致可豁免）
    if (d.top1HoldSupplyPct !== null && d.top1HoldCircPct !== null) {
      lines.push(`单一钱包持仓集中度: 占总供应量 ${d.top1HoldSupplyPct.toFixed(1)}% / 占在场流通 ${d.top1HoldCircPct.toFixed(1)}%（分子同=最大单一正净持仓钱包；占总供应量过大=单一钱包控盘的事实证据；占总供应量低但占在场流通高=在场筹码少所致，不算控盘（豁免））`);
    } else if (d.top1HoldCircPct !== null) {
      lines.push(`单一钱包持仓集中度: 总供应量未知（占供应量口径缺失）；占在场流通 ${d.top1HoldCircPct.toFixed(1)}%（判控盘须两口径齐备，仅流通口径不作控盘判据）`);
    } else {
      lines.push('单一钱包持仓集中度: 无正净持仓（无可主导筹码）');
    }
    // D3.32 持仓分布图景（2026-11-02 批次五 CD122 裁定：只看 top1 不够——top2 与
    // top1 紧邻买的更危险，且 top2 可能不是单一钱包而是捆绑簇；用户原话「给 Jev
    // 增加 持仓均衡 门吧。注意总供应量占比最重要，第二 CD122 的 top2 不是单一
    // 钱包，而是捆绑簇。需要利用 Jev 的能力处理复杂情况」）：前三钱包行为+前二
    // 合计+簇合计/并集以数值事实行进 state，组合判档交题面 holdings_balance
    // （档位仍 Jev 判，D3.5 边界不变；数值不带性质标签——判读教学在题面单一载体）
    if (Array.isArray(d.holdingsProfile) && d.holdingsProfile.length > 0) {
      const profLines = d.holdingsProfile.map((e, i) => {
        const holdSec = e.firstBuyDt !== null && e.firstSellDt !== null
          ? `，首卖距首买 ${Math.max(0, Math.round(e.firstSellDt - e.firstBuyDt))} 秒` : '';
        return `第${i + 1}大 ${shortWallet(e.w)}: 占总供应量 ${e.supplyPct !== null ? e.supplyPct.toFixed(1) + '%' : '?'}${e.circPct !== null ? ` / 占在场流通 ${e.circPct.toFixed(1)}%` : ''}（净持 ${(e.netTok / 1e6).toFixed(2)}M），买 ${fmtBnb(e.buyBnb)}×${e.buyN} / 卖 ${fmtBnb(e.sellBnb)}×${e.sellN}，首买@${fmtDt(e.firstBuyDt)}${e.firstBuyBlock !== null ? `（块 ${e.firstBuyBlock}）` : ''}${holdSec}`;
      });
      let distTail = '';
      if (d.top1Top2HoldSupplyPct !== null) {
        distTail += `；前两大合计占总供应量 ${d.top1Top2HoldSupplyPct.toFixed(1)}%`;
        if (d.top1Top2FirstBuyGapSec !== null) distTail += `（首买相差 ${Math.round(d.top1Top2FirstBuyGapSec)} 秒）`;
        // 簇并集两锚句已撤（CD133 同裁定——同块簇∪等额簇成员正净合计/第1大与簇
        // 并集占比的 sb∪eq 圈定不再喂 Jev；derived 照算供 digest/FA/runner）
      } else {
        distTail += '；总供应量未知，前几大组合占比口径缺失';
      }
      // D3.35 创建者曾持有轨迹句（CD10 教训：创建者开盘最大单买入后清仓，正净口径
      // 下看不见——「曾持峰值占总供应量%」补「曾经持有过多少」的峰值证据；口径=
      // 创建者行逐行累计净持仓的峰值，链外转入域 swap 不可见（来源不经过本盘与
      // insider 题同款），无 BUY 行不渲染=null 绝不以 0 冒充「从未持有」）
      if (d.creatorPeakHoldSupplyPct !== null && d.creatorPeakHoldSupplyPct !== undefined
          && Array.isArray(d.holdingsProfile)
          && !d.holdingsProfile.some((e) => e.w === (d.creatorWallet || ''))) {
        distTail += `；创建者已不在前三（曾持峰值占总供应量 ${d.creatorPeakHoldSupplyPct.toFixed(2)}%，买 ${fmtBnb(d.creatorBuyBnb)}×${d.creatorBuyN} / 卖 ${fmtBnb(d.creatorSellBnb)}×${d.creatorSellN}）`;
      }
      lines.push(`持仓分布: ${profLines.join('；')}${distTail}（按正净持仓降序取前三；前几大是否均衡/是否同源协同的档位判断是你的任务）`);
    }
    // D3.41 簇占在场流通两锚（2026-11-03 128 票全量对拍批次二裁定，用户原话「这一
    // 波我认为应该有一个独立的锚了：单级持仓。可以扩展之前的持仓锚，单个异常区块
    // （交易数多，不是真实用户行为）以及捆绑持仓太多是要拦住的」）：批次二六票
    // holdings_balance 全失明根因=开盘早期窗总供应量口径全员个位数（筹码大部分
    // 还没卖出来，供应口径看不见「垄断」），在场流通口径才有判别力（CD20 top1
    // 占供应 3.6% 但占流通 61.6%）。与 CD133 撤三行的区别：那是 G 通道门侧死指
    // 标+豁免前提 sb∪eq 圈定误伤的退役（门侧消费全撤），本两行=纯题面判读原料
    // （holdings_balance 档位判读的簇维度证据），无任何代码门/豁免消费；token
    // 域（正净 token 持仓 ÷ Σ正净），与持仓分布行 circPct 同域；无合格簇不渲染
    if ((d.sameBlockHoldCircPct !== null && d.sameBlockHoldCircPct !== undefined)
        || (d.equalBandHoldCircPct !== null && d.equalBandHoldCircPct !== undefined)) {
      lines.push(`捆绑簇持仓集中度: 同块买入簇成员占在场流通 ${d.sameBlockHoldCircPct !== null && d.sameBlockHoldCircPct !== undefined ? d.sameBlockHoldCircPct.toFixed(1) + '%' : '—'} / 等额带簇成员占在场流通 ${d.equalBandHoldCircPct !== null && d.equalBandHoldCircPct !== undefined ? d.equalBandHoldCircPct.toFixed(1) + '%' : '—'}（同块簇口径=同块 ≥3 笔买入的钱包集、等额带簇口径=±2% 对数带内 ≥3 钱包集，两键各自按本集计；分子=成员正净 token 持仓、分母=全部正净持仓合计。早期盘占总供应量口径全员个位数时，这是簇垄断在场筹码的度量；档位判断是你的任务——分散持有≠协同，簇高持仓须配买入结构证据（秒级集中阵列/同块卖回闭环），跨块长尾默认档跟风不构成证据）`);
    }
    // D3.41 簇闭环锚行（同裁定+CD20 ticks 深挖「好，搞吧」）：CD20 实形=五组等额
    // 簇「同块买→隔数秒~数十秒同块卖回」跨块闭环，同块对敲行（同块一卖一买等额
    // 配对）对此结构性失明——跨块+金额因价差不等。本行=代码算好的联立事实（同簇
    // 成员 ≥2 人同块卖出且卖块 ≥ 各自首买块），「同一批钱包既一起买又一起卖」=
    // 跨块对倒的时间平移版；行内反锚：高活跃盘卖侧撞块本身常见（不同批次各自
    // 离场撞进同块），协同的是买卖双联立不是单纯同块卖；零闭环块不渲染行（缺席
    // 语义，正常盘常态）；判读归 coordinated_sell_back 题档（无代码门消费）
    if (d.clusterRoundTripBlocks > 0) {
      const ex = (d.clusterRoundTrips || []).slice(0, 3).map((c) => {
        const sellTxt = c.blocks.slice(0, 3).map((b) => `${fmtDt(b.dt)} 同块 ${b.n} 笔 Σ${b.sellBnb.toFixed(3)}`).join('+');
        return `${c.kind === 'equal' ? '等额簇' : '同块簇'} ${c.label}（${c.wallets} 钱包 ${fmtDt(c.firstDt)} 买入 Σ${c.buyBnb.toFixed(3)}）→ ${sellTxt}`;
      }).join('；');
      lines.push(`簇买→同块卖回闭环: ${d.clusterRoundTripBlocks} 个同块卖回块（同一买入簇 ≥2 成员同块卖出），闭环卖出占簇成员买入 ${d.clusterRoundTripPct !== null && d.clusterRoundTripPct !== undefined ? d.clusterRoundTripPct.toFixed(1) + '%' : '—'} / 占全部卖出 ${d.clusterRoundTripSellPct !== null && d.clusterRoundTripSellPct !== undefined ? d.clusterRoundTripSellPct.toFixed(1) + '%' : '—'}（口径：对每个合格买入簇（同块 ≥3 笔/等额 ≥3 钱包）找「≥2 成员同块卖出」的块，卖块须不早于各自首买块；同簇跨块买→同块卖回=「一起买→一起卖」的闭环证据，与同块内卖→买等额换手（「同块对敲」行）互补；高活跃盘不同批次各自同块离场≠闭环——本行已按买入同簇联立过滤）。例：${ex}${(d.clusterRoundTrips || []).some((c) => c.blocks.length > 3) || (d.clusterRoundTrips || []).length > 3 ? '（示最大三簇/每簇前三块）' : ''}`);
    }
    // D3.2 代码活跃度档位行已撤（D3.5 用户裁定「我的意思也是用Jev判断活跃度」「使用
    // Jev 进行判断」）：档位判定交题面 activity_level（Jev 从 [TICKS] 直读自判，教学
    // 单一载体=题面，sbw 第四轮同款）；snapshot.derived 活跃度字段仍计算，供存档/回归对照。
    // D3.30 活跃度数值事实行（2026-11-02 批次四 CD31 复查，用户裁定加数值事实行：
    // 代码口径 ticksPerMin=94.29/maxGap=4s 明确 high 档，Jev 无数值锚低置信漂移成
    // low 0.44——档位行仍撤（判档仍 Jev，D3.5 边界不变），但三要素原料以数值事实
    // 进 state，同 sb/eq/famous 数值行性质「数值事实非档位判定」；题面不动）
    lines.push(`活跃度数值: 每分钟 ${d.ticksPerMin} 笔 / 笔均 ${d.avgTradeBnb} BNB / 最大交易间隔 ${d.maxGapSec} 秒（代码口径频率事实，activity_level 档位由你综合三要素给出）`);
    // D3.2b 著名钱包单极控盘锚（用户裁定 2026-10-31 CD5 语境：作弊段筹码被单一著名
    // 钱包吸收=锚时点转 unhealthy 的形状；名单=famous-copy-wallets 用户点名集合，
    // 跟单=著名钱包买入后 60s 内首买的钱包；仅作盘面事实陈述）
    const DOM_ZH = { high: '高', mid: '中', low: '低' };
    if (d.famousDominanceLevel !== null && d.famousDominanceLevel !== undefined) {
      // G5 跟单集中度数值（2026-11-02 批次四裁定「不能把所有后续买入全看成 famous
      // 的跟单」）：top3=跟单钱包中正净持仓前三合计占跟单正净 Σ 的 %——高=少数
      // 大户贴身重仓（疑似分仓）、低=散户小额分散跟进；仅事实陈述档位仍 Jev/通道
      const folTop3Txt = d.famousFollowerTop3Pct !== null && d.famousFollowerTop3Pct !== undefined
        ? `，跟单前三钱包占跟单合计 ${d.famousFollowerTop3Pct.toFixed(1)}%` : '';
      // G6 组织买入占比（用户补充裁定，见 sb/eq 段 G6 注）：famous∪跟单买入合计
      // 占窗口总买——组织独大=正常用户承接不足的死盘形状
      const grpBuyTxt = d.famousGroupBuyPct !== null && d.famousGroupBuyPct !== undefined
        ? `，著名+跟单买入占全部买入 ${d.famousGroupBuyPct.toFixed(1)}%` : '';
      lines.push(`著名钱包单极控盘: ${DOM_ZH[d.famousDominanceLevel]}（著名名单钱包持仓 ${d.famousHoldPct.toFixed(1)}%·其中最大单一钱包 ${d.famousTop1Pct.toFixed(1)}% + 其买入后 60s 内首买的跟单钱包 ${d.famousFollowerPct.toFixed(1)}%${folTop3Txt}${grpBuyTxt}，合计占正净持仓 ${d.famousDominancePct.toFixed(1)}%；仅作盘面事实陈述）`);
    } else {
      lines.push('著名钱包单极控盘: 不适用（窗内无著名名单钱包命中，或无可主导持仓）');
    }
    if (d.unresolvedSenderTickCount > 0) {
      lines.push(`⚠ sender 未解析行 ${d.unresolvedSenderTickCount}/${(snapshot.ticks || []).length}（证据洞：这些行无法归因到真实发起钱包，按 trader 回退可能并包——判断集中度/协同性时相应折扣，勿据此排除作弊也别据此坐实）`);
    }
    lines.push(`快进快出钱包（首买→首卖 <60s）: ${d.churn60sWalletCount} 个`);
    // 同块簇/等额簇刻意不渲染（2026-10-31 用户裁定：结构指纹由 Jev 从 [TICKS]/[WALLETS]
    // 自行归纳——预列簇=把指纹喂到嘴边强化指纹偏置；derived 仍计算，供 runner 观测/存档）
    if (d.priceArc) {
      const drawdown = d.priceArc.ath > 0 ? ((d.priceArc.last / d.priceArc.ath - 1) * 100).toFixed(1) : '?';
      lines.push(`价格拱（仅可靠价行 price_outlier=false）: 首 ${fmtPrice(d.priceArc.first)} → ATH ${fmtPrice(d.priceArc.ath)}（${fmtDt(d.priceArc.athDt)}）→ 末 ${fmtPrice(d.priceArc.last)}（较 ATH ${drawdown}%）`);
    } else {
      lines.push('价格拱: 无可靠价行');
    }
    const outlierN = (snapshot.ticks || []).filter((t) => t.outlier).length;
    if (outlierN > 0) lines.push(`价格离群(outlier)行 ${outlierN} 笔：资金统计照计（对倒的钱是真的），其价格不可信（tick 行标 [OUTLIER]）`);
    parts.push('[PRECOMPUTED]（代码端已算事实，直接采信）\n' + lines.join('\n'));
  }

  // ── [TICKS] ──
  {
    const ticks = snapshot.ticks || [];
    const shown = ticks.length > TICK_SHOW_MAX ? ticks.slice(0, TICK_HEAD_KEEP).concat(ticks.slice(ticks.length - (TICK_SHOW_MAX - TICK_HEAD_KEEP))) : ticks;
    if (ticks.length > TICK_SHOW_MAX) truncated.ticks = true;
    const lines = [];
    if (truncated.ticks) lines.push(`（共 ${ticks.length} 笔，超展示帽：保留最早 ${TICK_HEAD_KEEP} 笔 + 最近 ${TICK_SHOW_MAX - TICK_HEAD_KEEP} 笔，中段省略——[PRECOMPUTED] 统计仍基于全窗口）`);
    for (const t of shown) {
      // [GMGN] 行级标记已去除（2026-10-31 用户裁定：反噬——走路由≠真人）；sender 未解析
      // 回退到路由合约的行显示 UNRESOLVED*（伪钱包，不计入任何钱包）
      const w = t.senderMissing && isRouterWallet(t.wallet) ? 'w=UNRESOLVED*' : `w=${shortWallet(t.wallet)}`;
      const flags = [
        t.outlier ? '[OUTLIER]' : '',
        t.wallet && meta.creatorAddress && String(t.wallet).toLowerCase() === String(meta.creatorAddress).toLowerCase() ? '[CREATOR]' : '',
      ].filter(Boolean).join('');
      lines.push(`${fmtDt(t.dt)} ${t.side} ${fmtBnb(t.bnb)} @${fmtPrice(t.priceBnb)} ${w}${t.block !== null ? ` blk=${t.block}` : ''}${t.txHash ? ` tx=${String(t.txHash).replace(/^0x/, '').slice(0, 8)}` : ''}${flags ? ' ' + flags : ''}`);
    }
    parts.push('[TICKS]（链上真序 (block, log_index)；tx=交易哈希前 8 位——相同 tx= 的行=同一笔链上交易拆出的多个事件）\n' + lines.join('\n'));
  }

  // ── [WALLETS] ──
  {
    const wallets = snapshot.wallets || [];
    const shown = wallets.length > WALLET_SHOW_MAX ? wallets.slice(0, WALLET_SHOW_MAX) : wallets;
    if (wallets.length > WALLET_SHOW_MAX) truncated.wallets = true;
    const lines = [];
    if (truncated.wallets) lines.push(`（共 ${wallets.length} 个钱包，按买入额保留 top ${WALLET_SHOW_MAX}）`);
    for (const e of shown) {
      lines.push(
        `${shortWallet(e.w)} 买 ${fmtBnb(e.buyBnb)}×${e.buyN} 卖 ${fmtBnb(e.sellBnb)}×${e.sellN}` +
        ` 首买@${fmtDt(e.firstBuyDt)} 首卖@${fmtDt(e.firstSellDt)} 末动@${fmtDt(e.lastActDt)}` +
        (e.isCreator ? ' [CREATOR]' : ''),
      );
    }
    parts.push('[WALLETS]（按买入额降序；已剔除聚合路由伪钱包）\n' + lines.join('\n'));
  }

  // ── 判定指引 ──
  parts.push([
    '[判定指引]',
    '- [PRECOMPUTED] 统计是代码端计算的事实，直接采信；你的任务是这些事实编不出的判断：谁在主导资金流、节奏是否协同。',
    '- 只描述现象有无与程度（题面教怎么算的指标自己从 [TICKS]/[WALLETS] 算），不下盘面性质结论。',
    '- 分仓伪装：协同资金常拆成许多小钱包（刻意绕集中度门）——看节奏相关性（同块/等额/同步买卖的时间耦合），不要因钱包数多而判健康。同块聚集/等额或近等额带等结构指纹由你自行从 [TICKS] 与 [WALLETS] 原始逐笔归纳（判读要点见 equal_amount_split / same_block_buy_wave 题面——GMGN 前端默认档位与同块撞块是常态，组织性看时间集中度与同块∧同额双协同，2026-11-02 CD133）。',
    '- 同块带/等额带在健康票上也常见（组织化班底跨票播种、前端默认档自然聚带、独立买家同块撞块）——「有没有」不重要，按题面组织性判据判程度。',
    '- 强庄≠作弊：单一/少数钱包真实大额买入推升、未组织分仓同步砸盘，与协同分仓性质不同；协同买簇随后同块集中卖回波=协同卖回的最强形态。',
    // 停滞突发波的教学已随 D3.3 题面强化整体迁入题面（llm/cheat-questions.mjs
    // stall_burst_wave——用户裁定「应该强化题面文件」「指标计算删除了就必须告诉 Jev
    // 如何算」「case 发生了什么放到 Prompt 中」）：怎么算算法+真实 case 样本由题面
    // 单一载体承载，state 不再重复教判读法（亦不预贴「非真人指纹」性质标签）
  ].join('\n'));

  let state = parts.join('\n\n');
  if (state.length > MAX_STATE_CHARS) {
    truncated.hardCap = true;
    state = `⚠（材料超 ${MAX_STATE_CHARS} 字符预算，尾部被硬截断——[PRECOMPUTED] 事实段完整可信）\n` + state.slice(0, MAX_STATE_CHARS);
  }
  return { state, promptChars: state.length, truncated };
}

module.exports = { buildCheatState, MAX_STATE_CHARS };
