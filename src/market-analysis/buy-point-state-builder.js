/**
 * 买入点位分析 state 构建（BP1）——纯函数，零 DB 零网络
 *
 * BuyPointSnapshot → Jev 纯文本 state（照 cheat-state-builder 多段拼接形状，预算 20k）。
 * 分区：[TOKEN] → [ANCHOR]（as-of 声明+信号溯源）→ [PRECOMPUTED]（代码端已算事实，
 * 买点视角重组）→ [PRICE]（全窗可靠价 20 桶轨迹）→ [TICKS]（链上真序逐笔行）→
 * [WALLETS]（per-wallet 聚合行+近端字段）→ [判定指引]。
 *
 * 与 CD state 的差异：
 * - [TICKS] 展示窗=**首 50 + 末 250**（cheat 是首 200+末 100）——买点判读主体=锚前
 *   30-120s 近端（中高活跃 ≈200-250 笔恰覆盖），中段形状由数值承载，首 50 保开盘形状
 * - [WALLETS] 每行追加近端字段「近120s 买 X×n 卖 Y×n」（大持仓近端动向=卖压题原料）
 * - [PRECOMPUTED] 以买点维度重组（时点位置/发行价位置/近窗动量/节奏/参与结构/卖压），
 *   全窗背景行（总买卖/活跃度/价格拱/对敲/零买纯卖/持仓前三）从 cheatDerived 直读不重算
 */

const MAX_STATE_CHARS = 20000;
const TICK_SHOW_MAX = 300;
const TICK_HEAD_KEEP = 50;
const WALLET_SHOW_MAX = 40;

const { isRouterWallet } = require('./cheat-snapshot');
const { bpTEndOf, bpInWin } = require('./buy-point-snapshot');

/** 金额/价格/钱包/时间展示（镜像 cheat-state-builder 同款——纯展示层重复可接受） */
function fmtBnb(x) {
  if (x === null || x === undefined) return '?';
  return x >= 0.01 ? x.toFixed(3) : x.toFixed(4);
}
function fmtPrice(p) {
  if (p === null || p === undefined) return '?';
  return p.toExponential(2);
}
function shortWallet(w) {
  if (!w) return 'UNKNOWN';
  const s = String(w);
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
function fmtDt(dt) {
  return dt === null || dt === undefined ? '?' : `t+${dt}s`;
}
function fmtPct(x, suffix = '%') {
  return x === null || x === undefined ? '?' : `${x.toFixed(1)}${suffix}`;
}
function yn(v) {
  return v === null || v === undefined ? '?' : (v ? '是' : '否');
}

/**
 * snapshot → state 纯文本
 * @param {Object} snapshot - buildBuyPointSnapshot 产物
 * @returns {{ state: string, promptChars: number, truncated: Object }}
 */
function buildBuyPointState(snapshot) {
  const meta = snapshot.tokenMeta || {};
  const d = snapshot.cheatDerived || {};
  const b = snapshot.buyDerived || {};
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
      (meta.createTxHash ? ` createTx=${String(meta.createTxHash).replace(/^0x/, '').slice(0, 8)}` : ''));
    if (snapshot.dtBase === 'first_tick') {
      lines.push('⚠ token 创建时间缺失：t+Ns 基准退化为首 tick 时刻（非创建时刻）');
    }
    lines.push('聚合路由（GMGN）机制：大量下单方共用一个路由合约成交，真人 bot 都常走——走路由本身不区分真人/自动化；[TICKS] 行的 w= 为该笔实际发起地址。发起人无法解析的行显示 w=UNRESOLVED*（证据洞，不计入任何钱包）。');
    parts.push(`[TOKEN]\n${lines.join('\n')}`);
  }

  // ── [ANCHOR]（as-of 声明 + 信号溯源）──
  {
    const lines = [`本材料 = 截至第 ${snapshot.anchor.tickCount} 笔 tick 的 as-of 切片${snapshot.capped ? '（token 历史超拉数帽：窗口=最早一段+最近一段，中段未含——统计仅基于窗口内行）' : ''}。判定对象=此刻入场时机（时点），不是 token 终身属性，也不是盘面是否作弊。`];
    const si = snapshot.signalInfo;
    if (si) {
      lines.push(`信号溯源: ${si.signalId || '?'}@${si.createdAt || '?'}${si.strategyName ? ` 策略=${si.strategyName}` : ''}${si.firePriceBnb !== null && si.firePriceBnb !== undefined ? ` fire价=${fmtPrice(si.firePriceBnb)}` : ''}（测试集采样点——材料本身与实时引擎路径同源）`);
    }
    parts.push(`[ANCHOR]\n${lines.join('\n')}`);
  }

  // ── [PRECOMPUTED]（买点视角重组；null=? 缺席语义）──
  {
    const lines = [];
    // ① 时点位置
    lines.push(`时点位置: token 龄 ${b.tokenAgeSec ?? '?'}s（窗口跨度 ${b.spanSec ?? '?'}s）；末可靠价较全窗 ATH ${b.currentVsAthPct === null || b.currentVsAthPct === undefined ? '?' : b.currentVsAthPct.toFixed(2) + '%'}${b.secSinceAth !== null && b.secSinceAth !== undefined ? `（距 ATH ${b.secSinceAth}s）` : ''}，近 120s 创全窗新高=${yn(b.madeHigh120)}`);
    // ①a 发行价位置（BP5：绝对价格高低题锚；? = ticks 未覆盖出生段，截窗不冒充；
    // athVsLaunchPct=锚窗最高可靠价较发行价 %（BP39「开盘拉得过高」度量锚））
    lines.push(`发行价位置: 现价较发行价 ${b.currentVsLaunchPct === null || b.currentVsLaunchPct === undefined ? '?' : (b.currentVsLaunchPct > 0 ? '+' : '') + b.currentVsLaunchPct.toFixed(1) + '%'}，锚窗最高价较发行价 ${b.athVsLaunchPct === null || b.athVsLaunchPct === undefined ? '?' : (b.athVsLaunchPct > 0 ? '+' : '') + b.athVsLaunchPct.toFixed(1) + '%'}（发行价 ${b.launchPriceBnb === null || b.launchPriceBnb === undefined ? '?' : fmtPrice(b.launchPriceBnb)} BNB；? = ticks 未覆盖出生段不冒充）`);
    // ①b 市值位置（BP2/T117：末可靠价×totalSupply；? = supply 或可靠价缺失）
    lines.push(`市值位置(BNB 域): 现价市值 ${b.mcapBnb ?? '?'} / 窗内峰市值 ${b.mcapPeakBnb ?? '?'} / 较峰回撤 ${b.mcapFromPeakPct === null || b.mcapFromPeakPct === undefined ? '?' : b.mcapFromPeakPct.toFixed(2) + '%'}（? = supply 或可靠价缺失；窗=拉数窗，短龄票≈全史）`);
    // ①c holder 流向（BP2/T117：正净持仓钱包数与近 60s 变化——阴跌+流失=不宜入场形状）
    lines.push(`holder 流向: 现正净持仓钱包 ${b.holdersNow ?? '?'} 个；近 60s 变化 ${b.holdersDelta60 === null || b.holdersDelta60 === undefined ? '?' : (b.holdersDelta60 > 0 ? '+' : '') + b.holdersDelta60}（剔路由伪钱包；? = token 数量证据缺失）`);
    // ② 近窗动量
    const chg = (v) => (v === null || v === undefined ? '?' : `${v.toFixed(2)}%`);
    lines.push(`近窗动量(涨跌%): 5s ${chg(b.chg5Pct)} / 10s ${chg(b.chg10Pct)} / 30s ${chg(b.chg30Pct)}（窗末可靠价 vs 窗起点前最后一笔可靠价；窗内无更早价则自全窗首可靠价起算——短窗常见，含义=可得最早价以来的动量；? = 可靠价不足）`);
    // ②b 回看速度（BP10：锚窗内任意 5 秒段最大涨幅——当前时点 chg5 测不到此前段的暴涨，判「前期上涨过快」看本值）
    lines.push(`回看速度: 锚窗内任意 5 秒段最大涨幅 ${chg(b.maxChg5Pct)}（可靠价滚动 5s 窗最陡段；上涨速度的回看度量——涨幅不是速度，判「前期暴涨/上涨过快」以此为速锚而非累计涨幅；? = 可靠价不足）`);
    // （②a 摆动结构行已删——BP30/题集 BP33 tree_position 题退役：zigzag 锚照算
    //    落 digest 纯留档，state 不再渲染圣诞树原料行）
    // ③ 近窗流量
    const w30 = b.win && b.win[30], w60 = b.win && b.win[60], w120 = b.win && b.win[120];
    const flow = (w) => (w ? `买 ${fmtBnb(w.buyBnb)}×${w.buyN} 卖 ${fmtBnb(w.sellBnb)}×${w.sellN} 净 ${fmtBnb(w.netBnb)}` : '?');
    lines.push(`近窗流量(BNB): 30s ${flow(w30)} ｜ 60s ${flow(w60)} ｜ 120s ${flow(w120)}（净=买−卖；60s 买占双边 ${w60 ? fmtPct(w60.buySharePct) : '?'}）`);
    // ④ 节奏趋势 + burst 波
    const burst = b.burst5In120;
    lines.push(`节奏趋势: 近 120s 前半 ${b.halfTpmEarly ?? '?'} 笔/分 / 后半 ${b.halfTpmLate ?? '?'} 笔/分${b.rateTrend ? `（代码倾向 ${b.rateTrend}——参考比值，你从 [TICKS] 末段密度自行校验）` : ''}；最密 5s 波（120s 内）: ${burst ? `${burst.n} 笔 / 买 ${fmtBnb(burst.buyBnb)} / ${burst.wallets} 钱包` : '?'}（? = 窗内行不足）`);
    // ⑤ 参与结构（近 60s）
    lines.push(`参与结构(近60s): 笔/分 ${w60 ? w60.ticksPerMin : '?'}；买家 ${w60 ? w60.buyers : '?'} / 卖家 ${w60 ? w60.sellers : '?'} / 新进场 ${w60 ? w60.newBuyers : '?'}（全窗首见买入落在窗内）；top1 买集中度 ${fmtPct(b.top1BuyPct60)} / top1 卖 ${fmtPct(b.top1SellPct60)}（剔路由伪钱包）；路由买占比 ${fmtPct(b.routerBuyPct60)}（散户通道代理，纯事实）`);
    // ⑥ 卖压（近 60s）
    lines.push(`卖压(近60s): 卖出 ${w60 ? `${fmtBnb(w60.sellBnb)}×${w60.sellN}` : '?'}；清仓式卖出钱包 ${b.exitSellerCount60 ?? '?'} 个（近 60s 卖出后全窗净持仓≤0；? = token 数量证据缺失）；全窗正净持仓 top5 钱包近 60s 卖出合计 ${b.bigHolderSellBnb60 === null || b.bigHolderSellBnb60 === undefined ? '?' : fmtBnb(b.bigHolderSellBnb60) + ' BNB'}`);
    // ⑦ 全窗背景（cheatDerived 直读不重算）
    lines.push(`全窗背景: 总买入 ${fmtBnb(d.totalBuyBnb)} BNB / ${d.buyN} 笔；总卖出 ${fmtBnb(d.totalSellBnb)} BNB / ${d.sellN} 笔；独立钱包（剔路由伪钱包）${d.walletCount}`);
    lines.push(`活跃度数值: 每分钟 ${d.ticksPerMin ?? '?'} 笔 / 笔均 ${d.avgTradeBnb ?? '?'} BNB / 买盘中位 ${d.buyMedianBnb ?? '?'} BNB / 金额吞吐 ${d.throughputBnbPerMin ?? '?'} BNB/分钟 / 最大交易间隔 ${d.maxGapSec ?? '?'} 秒 / 无交易期占比 ${d.idlePct ?? '?'}%（间隔 ≥20s 静默段合计÷窗长） / 窗内最大回撤 ${d.maxDrawdownPct ?? '?'}% / 窗口时长 ${d.spanSec ?? '?'} 秒 共 ${d.tickCount ?? '?'} 笔（全窗口径=买入点位之前的整个锚窗）`);
    // BP13（案号 BP12）：临近买点段——锚窗末端 30s=买点前最后 30 秒，独立口径
    //（CD D3.59 同构搬运：尘单滴答不断打破时间静默使无交易期占比对「前期密集→
    // 临近只剩尘单」形状失明，临近死寂由段内中位/吞吐暴露）；? = 窗口 ≤30s 无对比语义
    if (d.nearSegTickN !== null && d.nearSegTickN !== undefined) {
      lines.push(`临近买点段(最后30秒): ${d.nearSegTickN} 笔（买 ${d.nearSegBuyN ?? '?'} / 卖 ${d.nearSegSellN ?? '?'}）/ ${d.nearSegTicksPerMin ?? '?'} 笔每分钟 / 段内金额吞吐 ${d.nearSegBnbPerMin ?? '?'} BNB/分钟 / 段内买盘中位 ${d.nearSegBuyMedianBnb ?? '?'} BNB / 段内最大间隔 ${d.nearSegMaxGapSec ?? '?'} 秒（买入点位之前的直接承接环境——开盘段/前期密集不救临近死寂）`);
    }
    // BP28 案四改：锚前尾段——临近段 totals 无时序（三段形状的锚前涌入被段
    // totals 稀释不可见），尾段行给「买点时刻即时状态」时序证据：锚前最后 5
    // 秒多笔大额=涌入波内；仅末行 1 笔尘级=锚点即静默边界（双向锚；末行 dt=tEnd
    // 恒在窗内、尾段最少 1 笔）。三键在 buyDerived.activity（BP 侧自算非 cheat 层）
    {
      const ta = (b.activity || {});
      if (ta.nearTail5TickN !== null && ta.nearTail5TickN !== undefined) {
        lines.push(`锚前尾段(最后5秒): ${ta.nearTail5TickN} 笔（买 ${ta.nearTail5BuyN ?? '?'}）合计买 ${ta.nearTail5BuyBnb ?? '?'} BNB（买点时刻的即时状态——多笔且金额可观=锚点落在涌入波内，临近死寂判读不成立；仅 1 笔/尘级=锚点即静默边界、买点时刻盘面死寂）`);
      }
    }
    // BP14（案号 BP14 BEM Miner 案）：筹码结构行——famous 控盘+持仓集中分层+
    // 参与/持有分叉（CD famous/D240 判法搬运的判读原料；? = 筹码证据缺失）
    {
      const c = b.chip || {};
      const pct1 = (v) => (v === null || v === undefined ? '?' : v.toFixed(1));
      lines.push(`筹码结构: famous 控盘占比 ${pct1(c.famousDominancePct)}%（famous 名单+跟单簇正净持仓 ÷ 全场正净；≥50=dominant 控盘主导）｜跟单集中度 ${pct1(c.famousFollowerTop3Pct)}% / 集团买入占比 ${pct1(c.famousGroupBuyPct)}%（联立加重臂：≥45 / ≥80）｜正净持有者 ${c.posHolderCount ?? '?'} 个，第一大占流通 ${pct1(c.top1HoldCircPct)}% / 前二 ${pct1(c.top1Top2HoldCircPct)}% / 前三 ${pct1(c.top3HoldCircPct)}%（持有者 ≥10 单一 >45%/前二 >55%/前三 >70% 任一过线=垄断坐实）｜买过钱包 ${c.buyersTotal ?? '?'} 个 vs 正净持有 ${c.posHolderCount ?? '?'} 个（参与/持有分叉——买过的人不少、拿货的只有两三个=拉高出货前奏）｜同块簇持仓 ${pct1(c.sameBlockHoldPct)}% / 等额带簇持仓 ${pct1(c.equalBandHoldPct)}%（? = 筹码结构证据缺失，如实判缺不猜）`);
    }
    if (d.priceArc) {
      const drawdown = d.priceArc.ath > 0 ? ((d.priceArc.last / d.priceArc.ath - 1) * 100).toFixed(1) : '?';
      lines.push(`价格拱(全窗可靠价): 首 ${fmtPrice(d.priceArc.first)} → ATH ${fmtPrice(d.priceArc.ath)}（${fmtDt(d.priceArc.athDt)}）→ 末 ${fmtPrice(d.priceArc.last)}（较 ATH ${drawdown}%）`);
    } else {
      lines.push('价格拱: 无可靠价行');
    }
    // BP18 盘面分类锚：开盘段结构（首 30 秒买入占比/大额单/开盘后密度——判
    //「强庄开盘进入/开盘狙击衰竭」的直接数值；? = 截窗未覆盖开盘段或窗口 ≤30s 无后段）
    {
      const o = b.openSeg || {};
      if (o.bigBuyN !== null && o.bigBuyN !== undefined) {
        lines.push(`开盘段结构(首30秒): 买入 ${fmtBnb(o.buyBnb)}×${o.buyN ?? '?'} 笔、占全窗买入 ${o.buySharePct === null || o.buySharePct === undefined ? '?' : o.buySharePct + '%'}；大额单(≥0.3 BNB) ${o.bigBuyN} 笔合计 ${fmtBnb(o.bigBuyBnb)} BNB；开盘段后: 买入 ${o.lateBuyBnb === null || o.lateBuyBnb === undefined ? '?' : fmtBnb(o.lateBuyBnb) + ' BNB'}、密度 ${o.lateTicksPerMin === null || o.lateTicksPerMin === undefined ? '?' : o.lateTicksPerMin + ' 笔/分'}（开盘大户进入 vs 开局抢完即衰竭的结构判据；后段 ? = 窗口 ≤30s 无对比语义）`);
      }
    }
    if (Array.isArray(d.holdingsProfile) && d.holdingsProfile.length > 0) {
      const prof = d.holdingsProfile.map((e, i) => `第${i + 1}大 ${shortWallet(e.w)}（占流通 ${e.circPct !== null && e.circPct !== undefined ? e.circPct.toFixed(1) + '%' : '?'}，买 ${fmtBnb(e.buyBnb)}×${e.buyN} 卖 ${fmtBnb(e.sellBnb)}×${e.sellN}，首买@${fmtDt(e.firstBuyDt)}）`).join('；');
      lines.push(`全窗持仓前三(正净 token): ${prof}（卖压行「top5」即此排名前五——大持仓近端动向另见 [WALLETS] 近 120s 字段）`);
    }
    if (d.washPairCount !== null && d.washPairCount !== undefined) {
      lines.push(`同块对敲: ${d.washPairCount} 对，配对买额占全部卖出 ${d.washPairSellPct === null ? '—' : d.washPairSellPct.toFixed(1) + '%'} / 占全部买入 ${d.washPairBuyPct === null ? '—' : d.washPairBuyPct.toFixed(1) + '%'}（左手换右手换手的直接度量；协同形状只作降档参考，作弊判定不归本题集）`);
    }
    if (d.noBuySellPct !== null && d.noBuySellPct !== undefined) {
      lines.push(`零买入纯卖方: ${d.noBuySellWallets} 个钱包（全窗零买入、只卖出）合计卖出 ${fmtBnb(d.noBuySellBnb)} BNB，占全部卖出 ${d.noBuySellPct.toFixed(1)}%（链外转入分仓出货形状——入场风险因素）`);
    }
    const outlierN = (snapshot.ticks || []).filter((t) => t.outlier).length;
    if (outlierN > 0) lines.push(`价格离群(outlier)行 ${outlierN} 笔：资金统计照计，其价格不可信已从价格口径剔除（tick 行标 [OUTLIER]）`);
    parts.push('[PRECOMPUTED]（代码端已算事实，直接采信）\n' + lines.join('\n'));
  }

  // ── [PRICE]（全窗可靠价等笔距 20 桶轨迹）──
  {
    const buckets = b.priceBuckets || [];
    const lines = [];
    for (let i = 0; i < buckets.length; i += 5) {
      lines.push(buckets.slice(i, i + 5).map((x) => `${fmtDt(x.dt)}@${fmtPrice(x.price)}`).join('  '));
    }
    parts.push('[PRICE]（全窗可靠价轨迹：等笔距 20 桶，桶=该段末笔可靠价——看形状斜率与位置，勿当逐笔数据）\n' + (lines.length ? lines.join('\n') : '（可靠价不足，无轨迹）'));
  }

  // ── [TICKS]（展示窗=首 50 + 末 250；近端为主）──
  {
    const ticks = snapshot.ticks || [];
    const shown = ticks.length > TICK_SHOW_MAX ? ticks.slice(0, TICK_HEAD_KEEP).concat(ticks.slice(ticks.length - (TICK_SHOW_MAX - TICK_HEAD_KEEP))) : ticks;
    if (ticks.length > TICK_SHOW_MAX) truncated.ticks = true;
    const lines = [];
    if (truncated.ticks) lines.push(`（共 ${ticks.length} 笔，超展示帽：保留最早 ${TICK_HEAD_KEEP} 笔 + 最近 ${TICK_SHOW_MAX - TICK_HEAD_KEEP} 笔，中段省略——[PRECOMPUTED]/[PRICE] 统计仍基于全窗口）`);
    for (const t of shown) {
      const w = t.senderMissing && isRouterWallet(t.wallet) ? 'w=UNRESOLVED*' : `w=${shortWallet(t.wallet)}`;
      const flags = [
        t.outlier ? '[OUTLIER]' : '',
        t.wallet && meta.creatorAddress && String(t.wallet).toLowerCase() === String(meta.creatorAddress).toLowerCase() ? '[CREATOR]' : '',
      ].filter(Boolean).join('');
      lines.push(`${fmtDt(t.dt)} ${t.side} ${fmtBnb(t.bnb)} @${fmtPrice(t.priceBnb)} ${w}${t.block !== null ? ` blk=${t.block}` : ''}${t.txHash ? ` tx=${String(t.txHash).replace(/^0x/, '').slice(0, 8)}` : ''}${flags ? ' ' + flags : ''}`);
    }
    parts.push('[TICKS]（链上真序 (block, log_index)；tx=交易哈希前 8 位——相同 tx= 的行=同一笔链上交易拆出的多个事件）\n' + lines.join('\n'));
  }

  // ── [WALLETS]（top 40 按买入额 + 近端字段）──
  {
    const ticks = snapshot.ticks || [];
    const tEnd = bpTEndOf(ticks);
    const recent = new Map(); // wallet -> {buyBnb,buyN,sellBnb,sellN}（近 120s）
    for (const t of ticks) {
      if (!bpInWin(t, tEnd, 120) || !t.wallet || isRouterWallet(t.wallet)) continue;
      const e = recent.get(t.wallet) || { buyBnb: 0, buyN: 0, sellBnb: 0, sellN: 0 };
      if (t.side === 'BUY') { e.buyBnb += t.bnb || 0; e.buyN++; } else { e.sellBnb += t.bnb || 0; e.sellN++; }
      recent.set(t.wallet, e);
    }
    const wallets = snapshot.wallets || [];
    const shown = wallets.length > WALLET_SHOW_MAX ? wallets.slice(0, WALLET_SHOW_MAX) : wallets;
    if (wallets.length > WALLET_SHOW_MAX) truncated.wallets = true;
    const lines = [];
    if (truncated.wallets) lines.push(`（共 ${wallets.length} 个钱包，按买入额保留 top ${WALLET_SHOW_MAX}）`);
    for (const e of shown) {
      const r = recent.get(e.w);
      lines.push(
        `${shortWallet(e.w)} 买 ${fmtBnb(e.buyBnb)}×${e.buyN} 卖 ${fmtBnb(e.sellBnb)}×${e.sellN}` +
        ` 首买@${fmtDt(e.firstBuyDt)} 首卖@${fmtDt(e.firstSellDt)} 末动@${fmtDt(e.lastActDt)}` +
        `｜近120s 买 ${r ? `${fmtBnb(r.buyBnb)}×${r.buyN}` : '0'} 卖 ${r ? `${fmtBnb(r.sellBnb)}×${r.sellN}` : '0'}` +
        (e.isCreator ? ' [CREATOR]' : ''),
      );
    }
    parts.push('[WALLETS]（按买入额降序；已剔除聚合路由伪钱包；「近120s」=以锚末 tick 为终点的 120s 窗）\n' + lines.join('\n'));
  }

  // ── 判定指引 ──
  parts.push([
    '[判定指引]',
    '- [PRECOMPUTED]/[PRICE] 统计是代码端计算的事实，直接采信；你的任务是这些事实编不出的判断：此刻入场时机好坏。',
    '- 只判入场时机（时点），不下盘面性质结论：协同/作弊形状（等额阵列/对敲/分仓指纹）作为降档参考计入风险权衡，是否作弊由反作弊模块另行判定。',
    '- 判定结构（BP8 用户裁定；BP13 活跃度门扩双题；BP14 新增筹码门；BP18 新增盘型门；BP30 盘型前置预判断+famous heavy/ultra 门扩+tree/追高题退役；BP34 盘型六桶+⑥位置门；BP38 strong_backer ultra 豁免；BP39 ④开盘拉高出货盘新形态）：**①盘型门（预判断，最前）**——盘面类型（market_pattern）散户 PVP（retail_pvp）/famous 独食（famous_monopoly）/狙击衰竭（early_sniper_decay，含开盘拉高出货盘形态——开局拉得过高+砸回/承接太弱）=不参与交易（代码侧硬门消费这三桶，**先于其余门裁**——预判断定盘子的类型，点位再好类型不对不参与）；持续拉升弱回调（sustained_climb）代码侧位置门判定：现价仍临近发行价（≤+10% 含破发）的起点段放行走质量题、已拉离发行价=不参与（判型归你、位置归代码）；强庄盘（strong_backer=最好类型）与融合盘（blended_unremarkable=好点位可赌）不拦；**分类互斥前置检查**：famous 控盘占比已达 heavy 及以上（筹码结构行 famous 控盘 ≥25）的盘子不是强庄盘也不是融合盘（famous 的货是要出货的，不是锁仓拉盘的庄）——归 famous 独食或按散户化/狙击/持续拉升形状归类；**②活跃度门**——热度（market_heat）low、或买点前活跃度（activity_level）low、或 activity_level=ultra（机器盘级极端密集）=不参与交易（**BP38 豁免：盘型=strong_backer 时 ultra 不拦**——强庄盘拉盘天然密集，ultra 密度不是拒买证据，代码侧豁免；low 档不豁免）；**③筹码门**——famous 控盘（famous_domination）heavy 或 dominant（≥25=famous 主导就不玩；light=正常参与不拦）或持仓集中（holder_concentration）strong=不参与交易；**④两道质量题**（早鸟/回调）各视角独立评估：先判场景适用（不适用 → insufficient 非差），再按各类忌讳权衡（早鸟忌极快拉高/已拉高·位置先于速度；回调忌没跌到位与奔着归零）；相对/绝对价格双轴并读；维度档位是参考不是投票，聚合归代码不归你。（tree_position 与追高质量题已退役——BP30 用户裁定，不再作答。）',
    '- 薄窗倾向 insufficient：窗内行数很少、锚过早、多数维度缺证据（? 多）时，诚实承认材料不足不硬判。',
    '- token 龄极短（[PRECOMPUTED] 时点位置行）时全程首波形状属常态：近高位置/节奏密集本身不是风险信号，权衡时结合 token 龄。',
  ].join('\n'));

  let state = parts.join('\n\n');
  if (state.length > MAX_STATE_CHARS) {
    truncated.hardCap = true;
    state = `⚠（材料超 ${MAX_STATE_CHARS} 字符预算，尾部被硬截断——[PRECOMPUTED] 事实段完整可信）\n` + state.slice(0, MAX_STATE_CHARS);
  }
  return { state, promptChars: state.length, truncated };
}

module.exports = { buildBuyPointState, MAX_STATE_CHARS };
