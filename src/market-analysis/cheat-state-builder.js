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
      lines.push(`买入 top1 钱包占比 ${d.top1BuyPct.toFixed(1)}%` + (d.top2BuyPct !== null ? ` / top2 合计 ${d.top2BuyPct.toFixed(1)}%` : '') + '（分母=总买入，剔除 router 伪钱包）');
    } else {
      lines.push('买入 top1 钱包占比: 无可归因买入');
    }
    if (d.routerPct !== null) {
      lines.push(`经聚合路由的买入占比 ${d.routerPct.toFixed(1)}%（${d.routerBuyN} 笔，行内不标注哪几笔——走路由≠真人也≠bot，不作判别依据）`);
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
    '- [PRECOMPUTED] 统计是代码端计算的事实，直接采信；你的任务是这些事实编不出的判断：谁在主导资金流、节奏是否协同、散户承接是否真实。',
    '- cheat=协同/受控资金主导流动性（既成事实）；unhealthy=非协同但当下盘面失衡（时点状态，可转化）；healthy=自然结构。判定只针对截至 [ANCHOR] 的窗口。',
    '- 分仓伪装：协同资金常拆成许多小钱包（刻意绕集中度门）——看节奏相关性（同块/等额/同步买卖的时间耦合），不要因钱包数多而判健康。同块聚集/等额或近等额带/同步卖回波等结构指纹由你自行从 [TICKS] 与 [WALLETS] 归纳计算（[PRECOMPUTED] 不预列簇）。',
    '- 整体结构优先于局部指纹：判别四件套=卖回分散度（同步波 vs 各自择时）、二次承接（早期卖家离场后有无新买家接住）、新面孔持续（启动簇之后是否还有无关钱包入场）、买卖失衡（单向 vs 双向）。同块带/等额带/孪生对在健康票上也常见（组织化班底跨票播种），单独出现不下结论；聚合路由占比高同样不作判别依据（真人 bot 都走路由）。',
    '- 强庄≠作弊：单一/少数钱包真实大额买入推升、未组织分仓同步砸盘=unhealthy 方向；多个疑似受控钱包接力制造热度（梯度买入/单向失衡/无新血承接）即使尚未砸盘也是 cheat 方向；协同买簇随后同块集中卖回波=cheat 最强证据。',
    '- 混合盘按「谁主导」判：混有真散户不洗净协同盘；反过来协同痕迹微弱也不必捕风捉影。',
  ].join('\n'));

  let state = parts.join('\n\n');
  if (state.length > MAX_STATE_CHARS) {
    truncated.hardCap = true;
    state = `⚠（材料超 ${MAX_STATE_CHARS} 字符预算，尾部被硬截断——[PRECOMPUTED] 事实段完整可信）\n` + state.slice(0, MAX_STATE_CHARS);
  }
  return { state, promptChars: state.length, truncated };
}

module.exports = { buildCheatState, MAX_STATE_CHARS };
