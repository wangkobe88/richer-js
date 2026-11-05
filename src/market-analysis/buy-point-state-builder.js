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
    // ①a 发行价位置（BP5：绝对价格高低题锚；? = ticks 未覆盖出生段，截窗不冒充）
    lines.push(`发行价位置: 现价较发行价 ${b.currentVsLaunchPct === null || b.currentVsLaunchPct === undefined ? '?' : (b.currentVsLaunchPct > 0 ? '+' : '') + b.currentVsLaunchPct.toFixed(1) + '%'}（发行价 ${b.launchPriceBnb === null || b.launchPriceBnb === undefined ? '?' : fmtPrice(b.launchPriceBnb)} BNB；? = ticks 未覆盖出生段不冒充）`);
    // ①b 市值位置（BP2/T117：末可靠价×totalSupply；? = supply 或可靠价缺失）
    lines.push(`市值位置(BNB 域): 现价市值 ${b.mcapBnb ?? '?'} / 窗内峰市值 ${b.mcapPeakBnb ?? '?'} / 较峰回撤 ${b.mcapFromPeakPct === null || b.mcapFromPeakPct === undefined ? '?' : b.mcapFromPeakPct.toFixed(2) + '%'}（? = supply 或可靠价缺失；窗=拉数窗，短龄票≈全史）`);
    // ①c holder 流向（BP2/T117：正净持仓钱包数与近 60s 变化——阴跌+流失=不宜入场形状）
    lines.push(`holder 流向: 现正净持仓钱包 ${b.holdersNow ?? '?'} 个；近 60s 变化 ${b.holdersDelta60 === null || b.holdersDelta60 === undefined ? '?' : (b.holdersDelta60 > 0 ? '+' : '') + b.holdersDelta60}（剔路由伪钱包；? = token 数量证据缺失）`);
    // ② 近窗动量
    const chg = (v) => (v === null || v === undefined ? '?' : `${v.toFixed(2)}%`);
    lines.push(`近窗动量(涨跌%): 5s ${chg(b.chg5Pct)} / 10s ${chg(b.chg10Pct)} / 30s ${chg(b.chg30Pct)}（窗末可靠价 vs 窗起点前最后一笔可靠价；窗内无更早价则自全窗首可靠价起算——短窗常见，含义=可得最早价以来的动量；? = 可靠价不足）`);
    // ②a 摆动结构（BP8 圣诞树原料：zigzag 阈值化峰谷——形状与位置判读素材，判读归 Jev）
    {
      const sw = Array.isArray(b.swingPoints) ? b.swingPoints : [];
      const legs = Array.isArray(b.swingLegs) ? b.swingLegs : [];
      const legTxt = legs.map((l) => `${l.amplPct > 0 ? '+' : ''}${l.amplPct.toFixed(0)}%/${Math.round(l.toDt - l.fromDt)}s`).join('、');
      const dirTxt = b.swingLastDir === 1 ? '上涨段' : b.swingLastDir === -1 ? '下跌段' : b.swingLastDir === 0 ? '未定向' : '?';
      const seq = sw.slice(-6).map((p) => `${p.kind === 'high' ? '峰' : '谷'}@${fmtDt(p.dt)}`).join('→');
      const chgS = (v) => (v === null || v === undefined ? '?' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
      lines.push(`摆动结构(圣诞树原料): ${seq || '?'}，现处${dirTxt}${legs.length ? `；段幅度（旧→新）${legTxt}` : ''}；摆点 峰${b.swingHighCount ?? '?'}/谷${b.swingLowCount ?? '?'}，最大单段摆幅 ${b.swingMaxAmplPct === null || b.swingMaxAmplPct === undefined ? '?' : b.swingMaxAmplPct.toFixed(0) + '%'}；现价较最近摆动峰 ${chgS(b.currentVsSwingHighPct)} / 较最近摆动谷 ${chgS(b.currentVsSwingLowPct)}（zigzag 反向 ≥20% 确认摆点——树形状与位置的判读素材（观察档暂不参与决策），判读归你；? = 可靠价不足）`);
    }
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
    lines.push(`活跃度数值: 每分钟 ${d.ticksPerMin ?? '?'} 笔 / 笔均 ${d.avgTradeBnb ?? '?'} BNB / 最大交易间隔 ${d.maxGapSec ?? '?'} 秒（全窗口径频率事实）`);
    if (d.priceArc) {
      const drawdown = d.priceArc.ath > 0 ? ((d.priceArc.last / d.priceArc.ath - 1) * 100).toFixed(1) : '?';
      lines.push(`价格拱(全窗可靠价): 首 ${fmtPrice(d.priceArc.first)} → ATH ${fmtPrice(d.priceArc.ath)}（${fmtDt(d.priceArc.athDt)}）→ 末 ${fmtPrice(d.priceArc.last)}（较 ATH ${drawdown}%）`);
    } else {
      lines.push('价格拱: 无可靠价行');
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
    '- 判定结构（BP8 用户裁定）：①活跃度门——热度 low=不参与交易（代码侧硬门消费 market_heat）；②三道质量题（早鸟/回调/追高）各视角独立评估：先判场景适用（不适用 → insufficient 非差），再按各类忌讳权衡（早鸟忌极快拉高/已拉高·位置先于速度；回调忌没跌到位与奔着归零；追高本轮先等等一律 poor）——早鸟≈树左侧早段、回调≈树脚企稳（小树结束+可能的大树开始）、追高≈树顶贴高；圣诞树形状与位置（tree_position）暂不参与决策（用户裁定「判断起来有点太难了，但是可以先放里头」）——题照答、摆动结构照算，档位作三质量题的参考佐证；相对/绝对价格双轴并读；维度档位是参考不是投票，聚合归代码不归你。',
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
