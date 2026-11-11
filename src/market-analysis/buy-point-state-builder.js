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
 * - BP58 点位性质判读锚随行渲染：发行价位置行带 curVsMinGapPct（现价−锚窗涨起后最低，
 *   crash 贴底臂原料）、回看速度行扩全窗最大跌幅+临近段（锚前 120s）最大涨/跌四键
 *   （crash 无回调无换手砸盘/spike 尖刺拉盘速度证据）——Jev 只能看渲染行，不渲染=题盲
 * - [ANCHOR] 渲染 cheat 门 burst 判定输入行（BP67：cheatBurst 在场=activity_level
 *   采信上游 burst 桶不重复检测；缺席不渲染=act 照常判）
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
    // BP67（2026-11-10 用户裁定）：cheat 门 burst 判定输入——「cheat 模块给 burst，
    // 买入检查给 low，非常明显的矛盾……不要重复检测，把 burst 信息输入到买入检查
    // 模块，活跃度给新增一个选项：burst，这个选项不 block 买入」。行在场=上游
    // （作弊盘检测，同窗）已判定本票为 burst 形状；BP 不重复判定 burst，activity_level
    // 采信该结论选 burst 桶。缺席=无 burst 证据不渲染（act 照常判——宁拦不冒充）。
    // D3.67/CD397（2026-11-11）起新增单段绑定波事实透传（跨度/流向轴——sbw 已按
    // 四要素重判，行内补波末距锚点秒数与波钱包净额/卖回率供 act 题头「沉积期低
    // 活跃是前提」语境核对）；state-only 文案不 bump BP 题集版本。
    const cb = snapshot.cheatBurst;
    if (cb) {
      const flow = cb.waveWalletNetBnb === null || cb.waveWalletNetBnb === undefined ? '' :
        `、波钱包全窗净额 ${cb.waveWalletNetBnb} BNB（卖回 ${cb.waveSellBackPct ?? '?'}%）`;
      const span = cb.secSinceWaveEnd === null || cb.secSinceWaveEnd === undefined ? '' :
        `、波末距锚点 ${cb.secSinceWaveEnd}s`;
      lines.push(`作弊盘检测 burst 判定: 本票在作弊盘检测（同窗）中已判定为 burst 形状（长期沉积后一朝放量操盘；最后静默段 ${cb.lastGapSec ?? cb.maxGapSec ?? '?'}s、出口后最密波买 ${cb.exitWaveBuyBnb ?? cb.waveBuyBnb ?? '?'} BNB / ${cb.exitWaveWallets ?? cb.waveWallets ?? '?'} 钱包${flow}${span}）——activity_level 判读采信该结论：沉积期低活跃度正是 burst 形状的前提而非拒买证据，activity_level 选 burst（不因全窗量级低压低档；本题不重复判定 burst 形状）`);
    }
    parts.push(`[ANCHOR]\n${lines.join('\n')}`);
  }

  // ── [PRECOMPUTED]（买点视角重组；null=? 缺席语义）──
  {
    const lines = [];
    // ① 时点位置
    lines.push(`时点位置: token 龄 ${b.tokenAgeSec ?? '?'}s（窗口跨度 ${b.spanSec ?? '?'}s）；末可靠价较全窗 ATH ${b.currentVsAthPct === null || b.currentVsAthPct === undefined ? '?' : b.currentVsAthPct.toFixed(2) + '%'}${b.secSinceAth !== null && b.secSinceAth !== undefined ? `（距 ATH ${b.secSinceAth}s）` : ''}，近 120s 创全窗新高=${yn(b.madeHigh120)}`);
    // ①a 发行价位置（BP5：绝对价格高低题锚；? = ticks 未覆盖出生段，截窗不冒充；
    // athVsLaunchPct=锚窗最高可靠价较发行价 %（BP39「开盘拉得过高」度量锚）；
    // minVsLaunchPct=锚窗涨起后最低可靠价较发行价 %（BP43 restart 重启盘「价格回到过
    // almost_launch」轨迹直供锚——判重启盘的关键证据行；BP44 定义=首个突破 almost 上界（2026-11-09 起 +10%）离开
    // almost_launch 之后的最低（涨起→又跌回的往返；创新高不遮蔽回落））；
    // curVsMinGapPct=现价较该最低的距离（BP58 点位性质 crash 贴底臂判读原料——
    //   ≤2pp=现价贴着锚窗最低价=暴跌刚发生/仍在进行，个位数 pp=仍在底部附近））
    lines.push(`发行价位置: 现价较发行价 ${b.currentVsLaunchPct === null || b.currentVsLaunchPct === undefined ? '?' : (b.currentVsLaunchPct > 0 ? '+' : '') + b.currentVsLaunchPct.toFixed(1) + '%'}，锚窗最高价较发行价 ${b.athVsLaunchPct === null || b.athVsLaunchPct === undefined ? '?' : (b.athVsLaunchPct > 0 ? '+' : '') + b.athVsLaunchPct.toFixed(1) + '%'}，锚窗涨起后最低价较发行价 ${b.minVsLaunchPct === null || b.minVsLaunchPct === undefined ? '?' : (b.minVsLaunchPct > 0 ? '+' : '') + b.minVsLaunchPct.toFixed(1) + '%'}，现价高于该最低 ${b.curVsMinGapPct === null || b.curVsMinGapPct === undefined ? '?' : b.curVsMinGapPct.toFixed(1) + 'pp'}（发行价 ${b.launchPriceBnb === null || b.launchPriceBnb === undefined ? '?' : fmtPrice(b.launchPriceBnb)} BNB；? = ticks 未覆盖出生段或从未离开 almost_launch=无回到语义，不冒充）`);
    // ①b 市值位置（BP2/T117：末可靠价×totalSupply；? = supply 或可靠价缺失）
    lines.push(`市值位置(BNB 域): 现价市值 ${b.mcapBnb ?? '?'} / 窗内峰市值 ${b.mcapPeakBnb ?? '?'} / 较峰回撤 ${b.mcapFromPeakPct === null || b.mcapFromPeakPct === undefined ? '?' : b.mcapFromPeakPct.toFixed(2) + '%'}（? = supply 或可靠价缺失；窗=拉数窗，短龄票≈全史）`);
    // ①c holder 流向（BP2/T117：正净持仓钱包数与近 60s 变化——阴跌+流失=不宜入场形状）
    lines.push(`holder 流向: 现正净持仓钱包 ${b.holdersNow ?? '?'} 个；近 60s 变化 ${b.holdersDelta60 === null || b.holdersDelta60 === undefined ? '?' : (b.holdersDelta60 > 0 ? '+' : '') + b.holdersDelta60}（剔路由伪钱包；? = token 数量证据缺失）`);
    // ② 近窗动量
    const chg = (v) => (v === null || v === undefined ? '?' : `${v.toFixed(2)}%`);
    lines.push(`近窗动量(涨跌%): 5s ${chg(b.chg5Pct)} / 10s ${chg(b.chg10Pct)} / 30s ${chg(b.chg30Pct)}（窗末可靠价 vs 窗起点前最后一笔可靠价；窗内无更早价则自全窗首可靠价起算——短窗常见，含义=可得最早价以来的动量；? = 可靠价不足）`);
    // ②b 回看速度（BP10：锚窗内任意 5 秒段最大涨幅——当前时点 chg5 测不到此前段的
    // 暴涨，判「前期上涨过快」看本值；BP58 扩四键=点位性质判读原料：maxDn5 全窗
    // 最深 5s 段跌幅、nearMaxUp5/nearMaxDn5=锚前 120s 临近段最深 5s 段涨/跌——
    // crash 无回调无换手砸盘/spike 尖刺拉盘的速度证据）
    lines.push(`回看速度(5秒段): 全窗最大涨幅 ${chg(b.maxChg5Pct)} / 最大跌幅 ${chg(b.maxDn5Pct)}；临近段(锚前120s)最大涨幅 ${chg(b.nearMaxUp5Pct)} / 最大跌幅 ${chg(b.nearMaxDn5Pct)}（可靠价滚动 5s 窗最陡段；涨幅不是速度，判「前期暴涨/暴跌」以此为速锚而非累计涨幅；点位性质判读原料——临近段单段跌 ≥15%=急跌砸盘进行时（crash 判轴=无回调+无换手对倒、速度不设限——见题面）、单段涨 ≥15%=尖刺拉升；? = 可靠价不足）`);
    // BP72 暴跌血缘行（v100 族二裁定「或者是暴跌后的交易小活跃期（这个要识别
    // 近期的暴跌）」）：锚前 30s 内最深 5s 段三件套直供——深段距今+现价距段
    // 起点的未收复幅度。idx195/idx5/idx206 形状=深段距 5~17s+未收复 -25%~-50%
    // +chg5 已收敛（两波砸落之间的间歇平静）；28ad 反例=-31% 段距 15s 但未收复
    // 仅 -18%+chg5 +14（收复进行时）。判读归题面（BP63 安全臂收窄的前提证据）。
    if (b.recentDip5Pct !== null && b.recentDip5Pct !== undefined) {
      lines.push(`近期暴跌段(锚前30秒内最深5秒段): ${chg(b.recentDip5Pct)}、距今 ${b.recentDip5SecAgo ?? '?'} 秒、现价距该段起点 ${chg(b.recentDip5UnrecoveredPct)}（未收复幅度——暴跌血缘直供：深段就在近 20 秒内且现价未收复=买点处于暴跌后的余波而非独立低点；已收复/距今远=跌势已走完；? = 可靠价不足或 30 秒内无 5 秒段）`);
    }
    // （②a 摆动结构行已删——BP30/题集 BP33 tree_position 题退役：zigzag 锚照算
    //    落 digest 纯留档，state 不再渲染圣诞树原料行）
    // ③ 近窗流量
    const w30 = b.win && b.win[30], w60 = b.win && b.win[60], w120 = b.win && b.win[120];
    const flow = (w) => (w ? `买 ${fmtBnb(w.buyBnb)}×${w.buyN} 卖 ${fmtBnb(w.sellBnb)}×${w.sellN} 净 ${fmtBnb(w.netBnb)}` : '?');
    lines.push(`近窗流量(BNB): 30s ${flow(w30)} ｜ 60s ${flow(w60)} ｜ 120s ${flow(w120)}（净=买−卖；60s 买占双边 ${w60 ? fmtPct(w60.buySharePct) : '?'}）`);
    // ④ 节奏趋势 + burst 波
    const burst = b.burst5In120;
    lines.push(`节奏趋势: 近 120s 前半 ${b.halfTpmEarly ?? '?'} 笔/分 / 后半 ${b.halfTpmLate ?? '?'} 笔/分${b.rateTrend ? `（代码倾向 ${b.rateTrend}——参考比值，你从 [TICKS] 末段密度自行校验）` : ''}；最密 5s 波（120s 内）: ${burst ? `${burst.n} 笔 / 买 ${fmtBnb(burst.buyBnb)} / ${burst.wallets} 钱包` : '?'}（? = 窗内行不足）`);
    // BP73 同块捆绑买入——②桶量维度捆绑口径判读锚（「有捆绑买入且单个 block
    // 汇总大于 0.3 BNB」不落②(a)；链上同时性=捆绑 bots/庄分仓的组织性买入证据；
    // 剔路由伪钱包；null=锚窗无买入行缺证据不冒充；dt=块首行时刻，判读该块
    // 属开盘段/近窗用时点对照）
    const bundled = b.bundledBlock;
    if (bundled) {
      lines.push(`同块捆绑买入(锚窗单block买入合计最大块): 块 ${bundled.block} / 买 ${fmtBnb(bundled.buyBnb)} BNB × ${bundled.n} 笔 / ${bundled.wallets} 钱包（块首行时刻 t+${bundled.dt} 秒；同一 block 内多钱包同时买入=链上同时性的组织性买入证据——捆绑 bots/庄分仓形状；已剔聚合路由伪钱包，散单堆凑的合计不算）`);
    }
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
        lines.push(`锚前尾段(最后5秒): ${ta.nearTail5TickN} 笔（买 ${ta.nearTail5BuyN ?? '?'}）合计买 ${ta.nearTail5BuyBnb ?? '?'} BNB、占全窗买入 ${ta.nearTail5BuySharePct ?? '?'}%（买点时刻的即时状态——多笔且金额可观=锚点落在涌入波内，临近死寂判读不成立；仅 1 笔/尘级=锚点即静默边界、买点时刻盘面死寂；占比口径=买量是否仍占全窗流量实质份额，两成上下=burst 已过的顶部、三分之一以上=拉升进行时）`);
      }
      // CD394 尾窗行（activity_level 定档主锚判读原料——尾 10s vs 此前 20s 断崖
      // 对比+短窗票照出；cheat-snapshot 单点计算 BP 透传）
      if (ta.nearTail10TickN !== null && ta.nearTail10TickN !== undefined) {
        lines.push(`临近尾窗(尾10秒/前20秒): 尾 10 秒 ${ta.nearTail10TickN} 笔、吞吐 ${ta.nearTail10BnbPerMin ?? '?'} BNB/分钟、卖侧独立钱包 ${ta.nearTail10SellWallets ?? '?'} 个；此前 20 秒吞吐 ${ta.nearPre20BnbPerMin ?? '?'} BNB/分钟（活跃度定档主锚=临近买点四臂判读：尾 10 秒多个独立钱包几乎纯卖（买入趋零/纯尘）=协同出货，档位照实落超高、不因买卖失衡降档；尾 10 秒吞吐较此前 20 秒断崖下降+尾 5 秒趋零/纯尘=临近衰减，全窗密集不救；尾 10 秒未断崖且尾 5 秒仍有真实买入（AMM 卖出恒被池子接走，买入方向才是买方需求在场）=临近仍活；前 20 秒死寂而尾段有真实流量=静默后涌入，全窗稀疏不抹——吞吐为固定窗归一，前 20 秒零流量=0 有证据零值）`);
      }
      // BP72 本地买方在场性行（尾 10s 买卖分解直供）——v100 族二裁定「买入前
      // 一段时间根本没有对倒换手，就是先买入，然后只有卖出（买入很弱）」：
      // 三态判读原料——买入归零/尘埃+卖出可观=单边出货推进（idx19/idx98/
      // idx175）；买卖双边在场=换手（c84a 买 0.11~1.9B 对卖）；买卖都尘埃=
      // 量能枯竭的平静（a813 0.03/0.05——安静阴跌非出货段）。判读归题面。
      if (ta.nearTail10BuyN !== null && ta.nearTail10BuyN !== undefined) {
        lines.push(`锚前尾段买卖对比(最后10秒): 买 ${ta.nearTail10BuyN} 笔 / ${ta.nearTail10BuyBnb ?? '?'} BNB、卖 ${ta.nearTail10SellBnb ?? '?'} BNB（本地买方在场性直供——「换手中的低点」要求双边：买入归零/纯尘而卖出可观=只有卖方在推进、不是对倒换手；双边都尘级=量能枯竭的平静，与卖方单边推进分开判读）`);
      }
    }
    // BP14（案号 BP14 BEM Miner 案）：筹码结构行——famous 控盘+持仓集中分层+
    // 参与/持有分叉（CD famous/D240 判法搬运的判读原料；? = 筹码证据缺失）
    {
      const c = b.chip || {};
      const pct1 = (v) => (v === null || v === undefined ? '?' : v.toFixed(1));
      lines.push(`筹码结构: famous 控盘占比 ${pct1(c.famousDominancePct)}%（famous 名单+跟单簇正净持仓 ÷ 全场正净；≥50=dominant 控盘主导）｜跟单集中度 ${pct1(c.famousFollowerTop3Pct)}% / 集团买入占比 ${pct1(c.famousGroupBuyPct)}%（联立加重臂：≥45 / ≥80）｜正净持有者 ${c.posHolderCount ?? '?'} 个，第一大占流通 ${pct1(c.top1HoldCircPct)}% / 前二 ${pct1(c.top1Top2HoldCircPct)}% / 前三 ${pct1(c.top3HoldCircPct)}%（持有者 ≥10 单一 >45%/前二 >55%/前三 >70% 任一过线=垄断坐实）｜买过钱包 ${c.buyersTotal ?? '?'} 个 vs 正净持有 ${c.posHolderCount ?? '?'} 个（参与/持有分叉——买过的人不少、拿货的只有两三个=拉高出货前奏）｜同块簇持仓 ${pct1(c.sameBlockHoldPct)}% / 等额带簇持仓 ${pct1(c.equalBandHoldPct)}%（? = 筹码结构证据缺失，如实判缺不猜）`);
    }
    // BP53 二修（案号 BP61）：famous 痕迹行——名单钱包时间线+在场性直供。
    // 缺口实测（147d/0432/59f5/米338a 四票 dom 81~100 groupBuy 71~100 全 high
    // 仍判 none）：[WALLETS] 前列行不标名单身份、famous 本人净持仓无直供键，
    // 「famous 还在场吗」（退出臂前提/③桶收割完臂的第一判据）Jev 无从判定。
    // 纯事实行（代码不产「收割完」结论，判读句在题面）；S053→BP31 尾段三键
    // state 补行先例同构。
    {
      const ft = b.famousTraces;
      const sgn = (v) => (v >= 0 ? '+' : '') + v.toFixed(4);
      if (ft === null || ft === undefined) {
        lines.push(`famous 痕迹: ?（名单缺失，famous 轴不可评）`);
      } else if (!ft.wallets.length) {
        lines.push(`famous 痕迹: 锚窗内名单钱包 0 个（无 famous 活动证据，famous 轴不适用）`);
      } else {
        const rowOf = (e) => `${shortWallet(e.w)} 买 ${e.buyBnb.toFixed(4)}×${e.buyN}（首买@${fmtDt(e.firstBuyDt)}）卖 ${(e.sellBnb || 0).toFixed(4)}×${e.sellN}（首卖@${fmtDt(e.firstSellDt)}）净 ${sgn(e.netBnb)}（卖出/买入 ${e.buyBnb > 0 ? (((e.sellBnb || 0) / e.buyBnb) * 100).toFixed(1) : '?'}%）`;
        lines.push(`famous 痕迹: 锚窗内名单钱包 ${ft.wallets.length} 个——${ft.wallets.map(rowOf).join('；')}｜合计买 ${ft.groupBuyBnb.toFixed(4)}（占全窗买 ${fmtPct(ft.groupBuyPct)}）卖 ${ft.groupSellBnb.toFixed(4)}（占全窗卖 ${fmtPct(ft.groupSellPct)}）Σ净 ${sgn(ft.netSumBnb)}，净持仓>0 的名单钱包 ${ft.inCustodyCount} 个、在场净额合计（净>0 钱包净额之和）${sgn(ft.presenceNetBnb ?? 0)}（在场性判读三分：单钱包/Σ净 ≈0 或负=已清仓离场（收割完）；净 >0 但已卖出绝大部分（卖出/买入 ≥95%、净投入 ≈0 差微末）=收割中——收割完/收割中同落③桶残局臂、不适用退出臂；净投入与买入额相当（基本未卖）=在场持有，正常评估退出臂——famous 轴退出臂前提与③桶残局臂的证据行；**在场净额合计=尘埃量级（参考 <0.05 BNB）∧盘面基本归零过（发行价位置行「涨起后最低」≤+10%）后又流量涌入的 burst 重启形状=上一轮尘埃残仓不算在场（BP70 判读见③桶）**；时刻为锚窗内相对秒）`);
      }
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
    // BP55 单笔口径判读直供（判据与 state 直供同构铁律——a8e70 对拍三连不翻②教训：
    // 题面判据已单笔化但 Jev 需从钱包行多步自算「单笔 0.2 级钱包数」，组好直供一行）
    {
      const bigSingles = wallets.filter((e) => e.maxBuyBnb >= 0.19);
      const arm30 = bigSingles.filter((e) => e.maxBuyBnb >= 0.3);
      const grayAccum = wallets.filter((e) => e.maxBuyBnb < 0.19 && e.buyBnb >= 0.19);
      const fmtEntry = (e) => {
        const soldPct = e.buyBnb > 0 ? Math.round((e.sellBnb / e.buyBnb) * 100) : 0;
        return `${shortWallet(e.w)} 单笔最大 ${fmtBnb(e.maxBuyBnb)}（累计 ${fmtBnb(e.buyBnb)}×${e.buyN}、已卖 ${fmtBnb(e.sellBnb)}≈${soldPct}% 净 ${fmtBnb(e.buyBnb - e.sellBnb)}、末动@${fmtDt(e.lastActDt)}）`;
      };
      const capList = (arr, cap) => arr.length > cap ? arr.slice(0, cap).map(fmtEntry).join('；') + ` 等 ${arr.length} 个` : arr.map(fmtEntry).join('；');
      lines.push(
        `大户参与判读（0.2 级按单笔计不累计/BP55）: 单笔 ≥0.19 的钱包 ${bigSingles.length} 个${bigSingles.length ? '——' + capList(bigSingles, 6) : ''}｜单笔 0.3+ 的钱包 ${arm30.length} 个` +
        `${grayAccum.length ? `｜累计到 0.2 级但单笔不到线的灰区单不计入（${capList(grayAccum, 3)}）` : ''}` +
        '——判序线=单笔 0.2 级钱包 ≥2 个（或单笔 0.3+）且买点时刻在场（末笔后清仓式卖出离场的历史大户不算在场）；不满足=无大户参与直接落②散户 PVP，盘面活跃度不救',
      );
    }
    for (const e of shown) {
      const r = recent.get(e.w);
      lines.push(
        `${shortWallet(e.w)} 买 ${fmtBnb(e.buyBnb)}×${e.buyN}(最大单笔${fmtBnb(e.maxBuyBnb)}) 卖 ${fmtBnb(e.sellBnb)}×${e.sellN}` +
        ` 首买@${fmtDt(e.firstBuyDt)} 首卖@${fmtDt(e.firstSellDt)} 末动@${fmtDt(e.lastActDt)}` +
        `｜近120s 买 ${r ? `${fmtBnb(r.buyBnb)}×${r.buyN}` : '0'} 卖 ${r ? `${fmtBnb(r.sellBnb)}×${r.sellN}` : '0'}` +
        (e.isCreator ? ' [CREATOR]' : ''),
      );
    }
    parts.push('[WALLETS]（按买入额降序；已剔除聚合路由伪钱包；「最大单笔」=该钱包单笔最大买入额——0.2 级大户判据按单笔计不累计（BP55）；「近120s」=以锚末 tick 为终点的 120s 窗）\n' + lines.join('\n'));
  }

  // ── 判定指引 ──
  parts.push([
    '[判定指引]',
    '- [PRECOMPUTED]/[PRICE] 统计是代码端计算的事实，直接采信；你的任务是这些事实编不出的判断：此刻入场时机好坏。',
    '- 只判入场时机（时点），不下盘面性质结论：协同/作弊形状（等额阵列/对敲/分仓指纹）作为降档参考计入风险权衡，是否作弊由反作弊模块另行判定。',
    '- 判定结构（BP8 用户裁定；BP13 活跃度门扩双题；BP14 新增筹码门；BP18 新增盘型门；BP30 盘型前置预判断；BP48 两质量题退役=纯门链；BP49 famous 控盘/相对价格两维度题退役；**BP58 改制——盘型题改「异常盘面识别」+新增点位性质题（entry_shape）+统一位置门 27.5；BP60 收口——盘型四桶（只识别不参与交易的盘形）+market_heat 退役；BP59——⑥sustained_climb 退役+⑨one_wave_dump 先买后卖一波流新增（BT-v103 复盘统一裁定①）**）：**①盘型门（预判断，最前）——异常盘面识别**：只把异常盘面找出来（强庄盘/狙击衰竭/融合盘/回落重启/黄金点/持续拉升等处理方式完全一致，归 none 正常盘面不再细分识别）。**异常桶=不参与交易（代码侧硬门硬拒，先于其余门裁）**：散户 PVP（retail_pvp——买点时刻无像样买方/大户向小散出货散户化）/famous 独食（famous_monopoly——famous 钱包拿筹过多「这个盘子就是它的/它们的了」，复数 famous 极早入场合计拿筹过多同落）/先买后卖一波流（one_wave_dump——开盘段一波买入拉起后**再无第二波买入**、后段已转卖：开盘段买入占全窗 ≥80%+开盘段后买入枯竭——买盘一次性用完只剩出货方向，像强开盘实际买完就转卖）；**none 正常盘面统一位置门 ≤+28.5%**：现价较发行价 ≤+28.5%（含破发）=临近发行价的参与区、已拉离（>+28.5%）=不参与（只买性价比高的点位，不追高）。**分类互斥前置检查**：famous 控盘占比已达 heavy 及以上（筹码结构行 famous 控盘 ≥25）的盘子归 famous 独食或按散户化形状归类——famous 的货是要出货的，不是锁仓拉盘的庄（仅再起来域/厚度维度适用，见题面）；**②点位性质门（BP58 新题 entry_shape）**——好点位=活跃交易中对倒中的低价/正常下跌造成的低价：**无回调、无换手对倒砸盘（crash——庄离场：较锚窗高点回撤 ≥25%/30s 跌 ≥25%/临近段 5s 单段跌 ≥15%/现价贴锚窗最低 ≤2pp 任一提示进形态复核，判轴=无回调+无换手对倒、速度不设限急砸缓砸都是；有回调节奏或有买方换手承接的放 normal_dip）**=不参与交易；**尖刺拉盘（spike——30s 涨 ≥20%/临近段 5s 单段涨 ≥15%/现价贴锚窗高点 ≥-5% 任一臂）判型如实落档、不拦买入（BP68 用户裁定：统一位置门已控价，控价域内 spike 判定本身不正常——有真实追高亏损 case 再思考对策）**；正常回调低价（normal_dip——有下跌但有回调节奏/有换手承接，对倒/正常下跌造成的低价=目标买入形状）与横盘缓行（flat）=放行；**③活跃度门**——买点前活跃度（activity_level）low、或 activity_level=ultra（机器盘级极端密集「act 为 ultra 也不玩」）=不参与交易（**无条件拦**——旧豁免臂已随桶改制删除）；**④筹码门**——持仓集中（holder_concentration）strong（**代码侧停用中不激活**——答案照答落档，观察材料保留）；**全部门过=放行（neutral）**——参与与否与可接受价格范围由盘型+位置+点位性质+活跃度的门链确定性决定。（早鸟/回调两道质量题与 tree_position、追高、famous 控盘、相对价格、市场热度维度题均已退役——BP30/BP48/BP49/BP60 用户裁定，不再作答。）',
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
