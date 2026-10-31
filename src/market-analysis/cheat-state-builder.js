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
      lines.push(`quote_token=${meta.quoteToken}（非 BNB 计价盘：下列 bnb 金额已在写入时换算为 BNB 域，读侧照抄；换算失败的链上交易整行不入表=本窗口可能缺行；跨汇率刷新窗的等额簇金额仅近似）`);
    }
    lines.push(`created=${meta.createdAt || '?'} creator=${meta.creatorAddress ? shortWallet(meta.creatorAddress) : 'unknown'}`);
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
    // D3.1 买侧簇结构占比锚（代码量化——Jev 眼估流量份额不分离，D3.0 实测）；
    // routerPct 行已删（2026-10-31 用户裁定：作弊钱包同样走路由，无判别价值）
    lines.push(`同块簇持仓占比: ${d.sameBlockHoldPct === null ? '无合格簇' : d.sameBlockHoldPct.toFixed(1) + '%'}（「≥3 笔买同块」全部簇的成员钱包去重并集；分子=成员正净持仓合计，分母=全场正净持仓合计）`);
    lines.push(`近等额簇持仓占比: ${d.equalBandHoldPct === null ? '无合格簇' : d.equalBandHoldPct.toFixed(1) + '%'}（±2% 金额带、带内 ≥3 个不同钱包；精确等额自然落入同带；同口径占比）`);
    // D3.2 活跃度锚（用户裁定：活跃度由代码量化——密度/笔均交易额/最长空窗三因子综合四档，
    // 另标不均衡（高低起伏）；Jev 判读活跃度难，眼估饱和）
    const LVL_ZH = { low: '低', mid: '中', high: '高', ultra: '超高' };
    if (d.activityLevel !== null && d.activityLevel !== undefined) {
      const unevenTxt = d.activityCv === null || d.activityCv === undefined ? '' : `；不均衡度 ${d.activityCv.toFixed(2)}${d.activityUneven ? '（高低起伏很大：存在密集爆发段与长断流段交替）' : ''}`;
      lines.push(`活跃度: ${LVL_ZH[d.activityLevel]}（密度 ${d.ticksPerMin} 笔/分钟 · 笔均 ${fmtBnb(d.avgTradeBnb)} BNB · 最长空窗 ${d.maxGapSec}s${unevenTxt}；仅作盘面事实陈述）`);
    } else {
      lines.push('活跃度: 不可评（时间戳缺失）');
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
      lines.push(`${fmtDt(t.dt)} ${t.side} ${fmtBnb(t.bnb)} @${fmtPrice(t.priceBnb)} ${w}${t.block !== null ? ` blk=${t.block}` : ''}${flags ? ' ' + flags : ''}`);
    }
    parts.push('[TICKS]（链上真序 (block, log_index)）\n' + lines.join('\n'));
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
    '- 只描述现象有无与程度，不下盘面性质结论（性质由代码侧综合）。',
    '- 分仓伪装：协同资金常拆成许多小钱包（刻意绕集中度门）——看节奏相关性（同块/等额/同步买卖的时间耦合），不要因钱包数多而判健康。同块聚集/等额或近等额带等结构指纹由你自行从 [TICKS] 与 [WALLETS] 归纳（[PRECOMPUTED] 的簇占比锚已量化买侧结构，可作程度参照）。',
    '- 同块带/等额带在健康票上也常见（组织化班底跨票播种、整数额买单自然聚带）——「占比多少」比「有没有」重要，程度题按占比与规整度判。',
    '- 强庄≠作弊：单一/少数钱包真实大额买入推升、未组织分仓同步砸盘，与协同分仓性质不同；协同买簇随后同块集中卖回波=协同卖回的最强形态。',
  ].join('\n'));

  let state = parts.join('\n\n');
  if (state.length > MAX_STATE_CHARS) {
    truncated.hardCap = true;
    state = `⚠（材料超 ${MAX_STATE_CHARS} 字符预算，尾部被硬截断——[PRECOMPUTED] 事实段完整可信）\n` + state.slice(0, MAX_STATE_CHARS);
  }
  return { state, promptChars: state.length, truncated };
}

module.exports = { buildCheatState, MAX_STATE_CHARS };
