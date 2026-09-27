/**
 * TokenPositionAnalyzer — 代币持仓分析模块（实时 as-of 钱包画像）
 * （pumpfun 回迁批 4；母版 token-position-analyzer.js 1665 行，结构/语义逐字对齐 + BSC 适配）
 *
 * 核心思路（母版原设计）：把「持仓类因子」从「FA 每 tick 用陈旧离线快照重算」改为「本模块在触发点用
 *   as-of 时间的实时钱包画像算一次、缓存、并给出 verdict」。
 *
 * as-of 画像数据源：wss_price_ticks 表全局流（watcher 写入行 experiment_id=NULL，跨实验共享），
 *   按 trader_address 查 `block_time < asOf` = 该钱包截至 asOf 的完整历史 → live 与 backtest
 *   完全同构、天然 as-of 正确、无 leak、无冷启动 seed。离线 cache 只是同一件事的预计算。
 *
 * 触发条件（FA 全量计数器，richer-js state.tradeCount/totalBuyBnb 本就无 skip 守卫）：
 *   时间门二选一（blocks=BSC 生产口径 / ageSeconds=复现口径）
 *   AND tradeCount > trigger.tradeCount AND totalBuyBnb > trigger.buyBnb AND holders(net>0) ≥ minHolders
 *
 * 触发后异步分析（fire-and-forget；backtest await 保证同 tick verdict 就绪）：
 *   1. 取 holders（faState._traderNetTokens 中 net>0 者，cap maxHolders）
 *   2. per-holder as-of 画像三路径：fresh（asOf≤data_through 用 offline）/ stale（增量
 *      [data_through,asOf) mergeOfflineProfile）/ miss（实时全量 [asOf−lookback,asOf)）
 *   3. floatPct/isCreator 打标 → wallet-scorer 评分 + 庄散四桶聚合
 *   4. verdict（zhuangCondition 表达式：tokenScore + 庄散比；null 恒 false = fail-closed block）
 *   5. 回填 holding 因子到 FA 缓存（setHoldingFactors）+ retention 基准冻结（setRetentionBasis）
 *      + 落 token_position_analyses 表
 *
 * ═══════════════ BSC 架构性偏离（其余逐字对齐母版）═══════════════
 *   1. ★live 三件套不迁（initLiveTicksBuffer/preloadRecentTicks/ingestLiveTick +
 *      liveTicksPreload* 配置）：watcher 架构 DB 即真相——母版 live 内存缓冲是为消除实时 _analyze
 *      的 DB ticks 往返（139 直连 WSS 架构下 DB 只有自己的 tick）；richer-js 的 wss_price_ticks
 *      由常驻 watcher 全局落库，live 直查 as-of 窗口永远完整，缓冲无必要。live miss/stale 路径
 *      直查 DB（批量 IN 100 + id 游标），延迟 ~1-2s 量级（TPA verdict 非阻塞路径，可接受）。
 *      prewarmLiveTokenProfiles 保留函数体但 live 恒 no-op（无缓冲可收集）；回测 setHistoricalTicks
 *      注入路径照常生效。若未来 live 改直连 WSS 需补回三件套。
 *   2. walletHoldingPct 分母 = faState.totalSupply（four.meme=TokenCreate d[5] / flap=1e9 固定，
 *      registerToken 回填），缺失(=0) → null fail-closed——FA 偏离 #1 先例（母版用常数 1e9 分母）。
 *   3. enforce 默认 false（母版 true）：richer-js 上线姿态 shadow 先行（策略条件暂不引用 TPAPre_*，
 *      纯观察+落表）；去门控化后 enforce 仅落表标记无门控差异，参数回测校准后由用户裁定写入策略。
 *   4. 回测 setHistoricalTicks 注入实验口径 ticks（BacktestEngine._loadWssTicks 已按 platform
 *      过滤）；DB 直查路径（live/web）天然跨平台。钱包画像跨平台全局（无 platform 列），
 *      回测注入路径的增量段缺异平台 tick——已接受的轻微不对称（回测速度优先，plan 裁定）。
 *   5. flap creator=工厂共享地址 → isCreator 事实失效：真实操纵者不获 sniper 豁免（更严方向，
 *      安全），不加特判。
 *
 * bad_action 实时判定（与离线 build-wallet-profiles 对齐；token 级元数据读 token_profiles）：
 *   - bad_buy ：holder 在 wash/pump_dump/low_quality token 上 age∈[0,3s)（首笔 buy - token
 *     firstTickTime，age>=0 排滞后负值）单买 ≥1.0 BNB
 *   - bad_sell：holder 在 wash token 上单卖 ≥2.0 BNB 且卖出落入 token flashCrash 段
 *   token 类别 + 闪崩段 + t0 由分类层（离线 build-token-profiles.cjs / 实时 OnlineProfileBuilder）
 *   落 token_profiles，TPA 只读。
 */
'use strict';

const { HIGH_FREQ_THRESHOLD } = require('../../scripts/shared/wallet-category');
// 钱包画像核心算法（buildProfileFromTicks）+ bad_action 常量抽到共享模块：实时 TPA / 离线
// build-wallet-profiles.cjs / 增量合并 共用同一算法（口径单一真相源）。
const { buildProfileFromTicks, mergeOfflineProfile } = require('./wallet-profile-builder');
// low-level bad_action 独立特性（与 bad_action 平级，非其降阈值附属）：低阈值恶意行为检测，
//   纯观察数据不进 scorer。口径复用 wallet-profile-builder 客观常量，配置/字段/函数独立。
const { computeLowLevelBadAction, mergeLowLevelBadAction, DEFAULT_CONFIG: LOW_LEVEL_DEFAULT_CONFIG } = require('./low-level-bad-action');
// good-action 独立特性（bad_action 对称的「好人」标签）：高质量盘早期集中建仓大买，纯观察数据不进 scorer。
const { computeGoodAction, mergeGoodAction, DEFAULT_CONFIG: GOOD_ACTION_DEFAULT_CONFIG } = require('./good-action');
// tiny-level bad_action 独立特性（LOL 卡线军团案）：0.2 BNB 档低阈值恶意行为检测，
// 阶梯 baseline(1.0/2.0) → low(0.6/1.0) → tiny(0.2/0.2)。口径复用 low-level 同一纯函数，零漂移。
const { computeTinyLevelBadAction, mergeTinyLevelBadAction, DEFAULT_CONFIG: TINY_LEVEL_DEFAULT_CONFIG } = require('./tiny-level-bad-action');
// 条件表达式评估（verdict 用 zhuangCondition，与买入策略 condition 同引擎）
const { ConditionEvaluator } = require('../strategies/ConditionEvaluator');
// TPA 持仓因子输出键清单（单一真相源；FA.getFactorKeys 手动段与本模块共用）
const { HOLDING_FACTOR_KEYS } = require('./tpa-factor-keys');
// 庄散识别 + 评分（wallet-scorer 实时子模块：classifyHolder/computeZhuangRetail/Ratio/scoreTokenFromHolders）
const {
  classifyHolder, computeZhuangRetail, computeZhuangRetailRatio, scoreTokenFromHolders,
} = require('./wallet-scorer');

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

// ── verdict 条件表达式（评分体系收口后唯一 verdict：tokenScore + 庄散比）──
// approve = zhuangCondition 对 { tokenScore, zhuangRetailRatio, 庄散加权分 } 求值为 true。
// zhuangScoreGatesToCondition 把老 zhuangScoreGates 硬阈值格式确定性转成等价条件字符串（前后端共用同一规则）。
const DEFAULT_ZHUANG_SCORE_GATES = { scoreThr: 2, ratioThr: 0.3 };
function zhuangScoreGatesToCondition(zs) {
  const g = zs || {};
  const parts = [];
  if (g.scoreThr != null && g.scoreThr !== '') parts.push(`TPAPre_tokenScore > ${g.scoreThr}`);
  if (g.ratioThr != null && g.ratioThr !== '') parts.push(`TPAPre_zhuangRetailRatio > ${g.ratioThr}`);
  return parts.join(' AND ');
}

/**
 * 默认配置（实验级配置存 experiments.config JSONB 的 tokenPositionAnalyzer 字段；
 * 引擎构造模块时传 experiment.config.tokenPositionAnalyzer，与本默认值深合并）。
 *
 * ⚠️ 引擎侧 opt-in（回迁批 4 上线纪律）：实验 config 整段无 tokenPositionAnalyzer → 引擎不构造本模块
 *   （存量实验零影响）；段存在才构造并走 trigger fail-fast。
 *
 * ⚠️ enforce 默认 false（BSC 偏离 #3，shadow 先行）：去门控化后 enforce 仅落表标记，
 *   无门控差异；策略条件暂不引用 TPAPre_*。母版默认 true 的动机（skip 移除后补位门控）
 *   在 richer-js 不成立（无 skip 机制迁移）。
 */
const DEFAULT_CONFIG = {
  enabled: true,
  enforce: false,
  // ★trigger（blocks|ageSeconds 二选一 + tradeCount/buyBnb/minHolders）无代码默认值（母版 2026-08-13 用户决策）：
  //   触发条件必须实验层显式配置（experiments.config.tokenPositionAnalyzer.trigger），缺配/字段不完整
  //   → 构造期抛错、实验启动失败（fail-fast，禁止默认值兜底掩盖配置缺失）。
  //   推荐初值参考 scripts/shared/tpa-defaults.js PROD_TRIGGER_GATE（blocks:1, tradeCount:10, buyBnb:6, minHolders:4，
  //   待 wss_price_ticks 回测校准）。阈值语义注释迁至 constructor 校验处。
  profileLookbackDays: 14,
  walletProfileCacheTtlMs: 600000, // 钱包画像缓存 TTL=10min（实时性优先：搞实时机制即求实时性，天/小时级失意义）
  // top N 持仓者分析上限（按 net 持仓量降序取 top N）。大户决定操纵风险/庄散结构，top N 之外散户持仓占比小。
  maxHoldersToAnalyze: 20,
  // zhuangCondition：verdict 唯一 approve 条件（评分体系收口）。默认 = tokenScore>scoreThr 且 庄散比>ratioThr 的等价条件。
  //   tokenScore 走 _computeWalletScores（决策前置恒算），庄散走实时 computeZhuangRetail（不落库）。
  //   zhuangRetailRatio = (庄+新钱包)/散户；retail=0 → ∞（视为满足）；无庄散数据 → null（fail-closed block）。
  //   可在实验 config 用 tokenScore/zhuangRetailRatio/庄散加权分(minZR/gapZR…) 自由组合/新增门。
  zhuangCondition: zhuangScoreGatesToCondition(DEFAULT_ZHUANG_SCORE_GATES),
  // 钱包评分→代币持仓评分（独立维度；verdict 操作数 tokenScore 恒算——enabled 历史遗留字段保留对齐母版）。
  // ⚠️ params 阈值单一真相源 = wallet-scorer.js DEFAULT_PARAMS（BSC 初始占位 ×0.4 保形，待回测校准）；
  //   实验需覆盖时在 config.walletScore.params 显式传，浅合并覆盖对应键（mergeConfig）。
  walletScore: {
    enabled: false,
    strategy: 'v1', // 多策略 dispatch（src/services/wallet-scorer.js STRATEGIES）
    topN: 20, // breakdown 明细/子页面展示的 per-wallet 行数（不参与 totalScore）
    topNMode: 'all', // totalScore 用 'all'(全 holders,∈[0,5]) 还是 'top'(topN)
  },
  // low-level bad_action 独立特性：低阈值恶意行为检测（buy 0.6/sell 1.0 BNB），与 bad_action 平级、
  //   不进 scorer（纯观察数据）。默认 enabled=true 生成+落库+展示供观察。阈值/开关改 low-level-bad-action.js。
  lowLevelBadAction: { ...LOW_LEVEL_DEFAULT_CONFIG },
  // good-action 独立特性：高质量盘(high_mcap/quality)早期集中建仓大买(2/4 BNB 档)，bad_action 对称的
  //   「好人」标签、不进 scorer（纯观察数据）。阈值/开关改 good-action.js。
  goodAction: { ...GOOD_ACTION_DEFAULT_CONFIG },
  // tiny-level bad_action 独立特性：0.2/0.2 BNB 档恶意行为检测（卡线军团绕过 low 0.6 档补口），
  //   与 bad_action/lowLevelBadAction 平级独立、不影响已有机制。阈值/开关改 tiny-level-bad-action.js。
  tinyLevelBadAction: { ...TINY_LEVEL_DEFAULT_CONFIG },
};

// 显式声明「本调用不消费 trigger」：非引擎复用点（web PositionAnalysisService）只用
// _fetchAndBuildProfile 等画像方法、从不调 checkAndTrigger，构造期校验要求 trigger 完整，
// 这些点显式传此标记跳过。引擎实验路径禁止使用（checkAndTrigger 遇 _trigger=null 直接 throw）。
const TRIGGER_NOT_USED = Object.freeze({ notUsed: true });

/** 浅深合并：exp 配置覆盖默认（trigger 原样透传不合并默认——实验层必须显式提供；zhuangCondition 老格式确定性转换）。 */
function mergeConfig(exp) {
  if (!exp || typeof exp !== 'object') return { ...DEFAULT_CONFIG };
  const merged = { ...DEFAULT_CONFIG, ...exp };
  merged.trigger = exp.trigger;
  // zhuangCondition：新格式（条件字符串）优先；老格式(zhuangScoreGates)与默认合并后确定性转换。
  merged.zhuangCondition = (exp.zhuangCondition != null)
    ? exp.zhuangCondition
    : zhuangScoreGatesToCondition({ ...DEFAULT_ZHUANG_SCORE_GATES, ...(exp.zhuangScoreGates || {}) });
  if (exp.walletScore === null) {
    merged.walletScore = null; // 显式关闭评分
  } else if (exp.walletScore !== undefined) {
    merged.walletScore = {
      ...DEFAULT_CONFIG.walletScore,
      ...exp.walletScore,
      params: { ...DEFAULT_CONFIG.walletScore.params, ...(exp.walletScore.params || {}) },
    };
  }
  // low-level bad_action 独立特性：浅合并（enabled + 阈值数组整体覆盖）
  if (exp.lowLevelBadAction !== undefined) {
    merged.lowLevelBadAction = { ...DEFAULT_CONFIG.lowLevelBadAction, ...exp.lowLevelBadAction };
  }
  // good-action 独立特性：浅合并（enabled + 阈值数组整体覆盖）
  if (exp.goodAction !== undefined) {
    merged.goodAction = { ...DEFAULT_CONFIG.goodAction, ...exp.goodAction };
  }
  // tiny-level bad_action 独立特性：浅合并（enabled + 阈值数组整体覆盖）
  if (exp.tinyLevelBadAction !== undefined) {
    merged.tinyLevelBadAction = { ...DEFAULT_CONFIG.tinyLevelBadAction, ...exp.tinyLevelBadAction };
  }
  return merged;
}

// ── 简易 logger（与 OnlineProfileBuilder 同范式）──
let _logger = null;
function log(level, msg, data) {
  const prefix = '[TokenPositionAnalyzer]';
  if (_logger) {
    // data 未传时不传第二参——引擎 logger 的 (module, message) 分支会把显式
    // undefined 当 message 打成行尾 "undefined"（单参走简单分支才正确）
    if (data !== undefined) _logger[level](`${prefix} ${msg}`, data);
    else _logger[level](`${prefix} ${msg}`);
  } else {
    console.log(`${prefix} [${level}] ${msg}`, data || '');
  }
}

class TokenPositionAnalyzer {
  /**
   * @param {Object} expConfig 实验级配置（experiments.config.tokenPositionAnalyzer），与 DEFAULT_CONFIG 深合并
   * @param {Object} deps
   * @param {Object} [deps.logger]
   * @param {string} [deps.experimentId] 当前实验 id（落表用）
   * @param {Object} [deps.factorAggregator] FA 实例（setHoldingFactors 回填 holdingCache）
   */
  constructor(expConfig = {}, deps = {}) {
    const config = mergeConfig(expConfig);
    this._enabled = config.enabled ?? false;
    this._enforce = config.enforce ?? false;
    if (config.trigger === TRIGGER_NOT_USED) {
      this._trigger = null; // 显式不消费（非引擎复用点，只走 _fetchAndBuildProfile 等画像方法）
    } else {
      // ★触发条件必须实验层显式配置（母版 2026-08-13 用户决策，照搬）：无代码默认值，缺配/字段不完整
      //   → 构造期抛错（Wss/Backtest 引擎同步构造路径 → 实验启动失败，fail-fast）。
      //   阈值语义（BSC 口径）：
      //   - 时间基准门（二选一，恰好提供一个，两个都给/都不给 → 构造期抛错）：
      //     · blocks（BSC 生产口径）：tick.block_number − faState.firstBlockNumber ≥ blocks 才触发
      //       （BSC 3s/块；blocks:1 ≈ FA firstBlockWindowMs=3000 同窗≈1 首块抢筹窗）。无块证据
      //       （faState.firstBlockNumber/tick.block_number 任一 null）fail-closed 不触发，等下一个
      //       带 block 的 tick（watcher 行均含 block_number，极少见）。
      //     · ageSeconds（复现口径）：age>此值才触发。
      //   - tradeCount / buyBnb：总成交笔数/总买入 BNB 下限（拦冷门盘；FA state 全量计数器无 skip）。
      //   - minHolders：当前 net>0 持仓者 < minHolders 不触发（拦 holder 缩减的死盘：死盘触发时
      //     holder 已缩减到 1-2 个接盘侠 → tokenScore 虚高）。⚠️副作用（已确认接受）：holder<minHolders
      //     的 token 永不触发 → holding_factors 不产出 → 引用 TPAPre_* 的 condition 恒 false 不买。
      //     精准命中死盘；正常盘 tradeCount>10+buyBnb>6 时 holder 通常已≥4。
      const REQ = ['tradeCount', 'buyBnb', 'minHolders'];
      if (!config.trigger || typeof config.trigger !== 'object') {
        throw new Error('[TokenPositionAnalyzer] 实验 config 缺 tokenPositionAnalyzer.trigger —— 触发条件必须实验层显式配置（blocks|ageSeconds 二选一 + tradeCount/buyBnb/minHolders），无默认值');
      }
      // 时间基准门恰好一个（blocks XOR ageSeconds）：并存=语义歧义，全无=缺时间门
      const timeKeys = ['blocks', 'ageSeconds'].filter(k => config.trigger[k] != null && config.trigger[k] !== '');
      if (timeKeys.length !== 1) {
        throw new Error(`[TokenPositionAnalyzer] trigger 时间基准门必须恰好提供一个（blocks 或 ageSeconds，实际=[${timeKeys.join(',')} 或空]）—— 并存=歧义，全无=缺时间门`);
      }
      for (const k of [...timeKeys, ...REQ]) {
        const v = Number(config.trigger[k]);
        if (!Number.isFinite(v) || v < 0) {
          throw new Error(`[TokenPositionAnalyzer] trigger.${k} 缺失或非法（=${config.trigger[k]}）—— 触发条件必须实验层显式配置`);
        }
      }
      this._trigger = config.trigger;
    }
    this._profileLookbackDays = config.profileLookbackDays;
    this._cacheTtlMs = config.walletProfileCacheTtlMs;
    // offline 文件缓存时效上限（兜底防离线构建脱节）：step4 在 182 跑、删不到实盘机缓存文件 →
    //   实盘机缓存可能落后 step4 数天 → 漏加载新增 holder → miss(realtime) 无历史 bad_action →
    //   tokenScore 虚高。mtime 超此值则 preloadOfflineProfiles 重 SELECT DB（step4 末尾删缓存双保险）。
    //   默认 12h（step4 一日一次，12h 保证不跨周期）。0=不限。
    this._offlineCacheMaxAgeMs = config.offlineCacheMaxAgeHours != null ? config.offlineCacheMaxAgeHours * 3600000 : 12 * 3600000;
    this._maxHolders = config.maxHoldersToAnalyze;
    this._zhuangCondition = config.zhuangCondition;           // approve 条件表达式（verdict 唯一条件）
    // 解析+校验条件（fail-fast：拼写错误的因子名在构造期抛错，避免 ConditionEvaluator 静默 fail-closed 掩盖配置问题）
    this._zhuang = this._compileCondition(this._zhuangCondition, [
      'TPAPre_tokenScore', 'TPAPre_zhuangRetailRatio',
      'TPAPre_zhuangScore', 'TPAPre_retailScore', 'TPAPre_newWalletScore', 'TPAPre_neutralScore', 'TPAPre_minZR', 'TPAPre_gapZR',
      // TPAPre_walletHoldingPct（池子净吸收进度 %）：可选 verdict 操作数。默认 zhuangCondition 不引用 → 零影响；
      // 仅当实验 config 显式在 zhuangCondition 写入 whp 放宽路径时生效（如 whp≥阈值降 score/ratio 门）。
      'TPAPre_walletHoldingPct',
    ], 'zhuangCondition');

    // 钱包评分配置（tokenScore 是 verdict 操作数恒算；enabled 历史遗留字段保留对齐母版）
    this._walletScore = config.walletScore;
    this._walletScoreEnabled = !!(config.walletScore && config.walletScore.enabled);
    this._walletScoreParams = this._walletScoreEnabled ? config.walletScore.params : null;

    // low-level bad_action 独立特性配置（纯观察数据，不进 scorer；enabled 生成+落库+展示）
    this._lowLevelBadAction = config.lowLevelBadAction || null;
    // good-action 独立特性配置（纯观察数据，不进 scorer；enabled 生成+落库+展示）
    this._goodAction = config.goodAction || null;
    // tiny-level bad_action 独立特性配置（0.2/0.2 档；enabled 生成+落库+展示）
    this._tinyLevelBadAction = config.tinyLevelBadAction || null;

    this._experimentId = deps.experimentId || null;
    this._factorAggregator = deps.factorAggregator || null;
    // 落表接管（仅回测 BacktestEngine 注入）：_persist 构建完 row 后交给 sink 攒批批量落表，
    //   替代逐条 await upsert（串行网络往返占回测主循环大头）。live/web 不注入 → 行为不变（单条 upsert）。
    this._persistSink = deps.persistSink || null;
    // FA 的 setHoldingFactors 是静态方法 → 走类引用。兼容传入 FA 实例（引擎持有实例）或 FA 类本身：
    //   静态方法在类上可访问、在实例上不可访问 → 以 setHoldingFactors 是否为 function 判实例/类。
    const _fa = deps.factorAggregator;
    this._faClass = _fa ? (typeof _fa.setHoldingFactors === 'function' ? _fa : _fa.constructor) : null;

    this._analyzed = new Set();        // 已分析 token（v1 write-once，trigger_no=1）
    this._verdictCache = new Map();    // token → { verdict, reasons, factors, asOf, snapshot }
    this._walletProfileCache = new Map(); // cacheKey=address → { ts(asOfTime), profile }，TTL=walletProfileCacheTtlMs(10min)
    this._tokenProfileCache = new Map(); // token → { category, flashCrashPeriod, firstTickTime } | null（token_profiles 表，bad_action 消费；分类属性稳定，缓存不过期）
    this._offlineProfilePreloaded = null; // Map<address,{dataThroughMs,dataThroughIso,profile}>|null：启动时 preloadOfflineProfiles() 一次 SELECT wallet_offline_profiles 全表填充（回测与 live 均 preload；web 保持 null → fetch 函数 fallback DB）。★单独 Map 不碰 _walletProfileCache（后者 TTL 命中会短路 fresh/stale/miss 分类 → 丢 stale 增量合并）。
    this._walletTicksPreloaded = null; // Map<trader_address,tick[]>|null：仅回测 setHistoricalTicks（本实验全量 ticks）一次填充；live 不缓冲（架构性偏离 #1，DB 即真相）；web 保持 null → 走 DB 分支。★单独 Map 不碰 _walletProfileCache。

    _logger = deps.logger || null;

    // ★对齐实盘消除 look-ahead（仅回测 BacktestEngine 传 deps.alignClassifiedAsOf=true）：bad_action
    //   只用 asOf 时已分类的 token（category_visible_at≤asOf），事后分类视为 null →
    //   buildProfileFromTicks bad_action 循环 continue，与实盘同口径。实盘 asOf=now（已分类 token
    //   可见时刻<now 自然保留）、web 默认 false → 零影响。
    this._alignClassifiedAsOf = !!deps.alignClassifiedAsOf;

    // 性能探针（仅 process.env.TPA_PROFILE 启用：回测量化 TPA DB 往返瓶颈；无开关 _prof=null 全早返零开销）
    this._prof = process.env.TPA_PROFILE ? {
      fetchOffline: { n: 0, ms: 0, samples: [] },       // _fetchOfflineProfileBatch（wallet_offline_profiles）
      fetchTicks: { n: 0, ms: 0, samples: [] },          // _fetchWalletTicksBatch（wss_price_ticks，miss 全量/stale 增量）
      fetchTokenProfiles: { n: 0, ms: 0, samples: [] },  // _fetchTokenProfiles（token_profiles）
      preloadOffline: { n: 0, ms: 0, samples: [] },      // preloadOfflineProfiles（启动一次 SELECT 全表，对照 fetchOffline 归零）
      fresh: 0, stale: 0, miss: 0,                        // 三路分类计数（per holder）
      cacheHit: 0, cacheMiss: 0,                          // _walletProfileCache 命中（跨 token 复用削减）
      analyzeN: 0, analyzeMs: 0,                          // _analyze 整体（含 CPU build，对照 DB 往返占比）
    } : null;
  }

  // ── 性能探针（guarded by _prof；无 TPA_PROFILE 时全早返零开销）──
  _profTock(key, t0) {
    if (!this._prof) return;
    const b = this._prof[key];
    const dt = Date.now() - t0;
    b.n++; b.ms += dt;
    if (b.samples.length < 5000) b.samples.push(dt); // 采样上限防内存膨胀
  }
  _p95(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return Number(s[Math.floor(s.length * 0.95)].toFixed(1));
  }
  /** 引擎（BacktestEngine._finalizeBacktest）调，返回 TPA DB 往返/画像构建汇总；未启用探针返 null。 */
  getProfileStats() {
    if (!this._prof) return null;
    const p = this._prof;
    const sum = (b) => ({ n: b.n, ms: Number(b.ms.toFixed(0)), avgMs: b.n ? Number((b.ms / b.n).toFixed(1)) : 0, p95Ms: this._p95(b.samples) });
    const fsm = p.fresh + p.stale + p.miss;
    const cache = p.cacheHit + p.cacheMiss;
    return {
      fetchOffline: sum(p.fetchOffline),
      fetchTicks: sum(p.fetchTicks),
      fetchTokenProfiles: sum(p.fetchTokenProfiles),
      preloadOffline: sum(p.preloadOffline),
      fresh: p.fresh, stale: p.stale, miss: p.miss,
      freshPct: fsm ? Number((p.fresh / fsm * 100).toFixed(1)) : 0,
      missPct: fsm ? Number((p.miss / fsm * 100).toFixed(1)) : 0,
      cacheHit: p.cacheHit, cacheMiss: p.cacheMiss,
      cacheHitPct: cache ? Number((p.cacheHit / cache * 100).toFixed(1)) : 0,
      analyzeN: p.analyzeN, analyzeMs: Number(p.analyzeMs.toFixed(0)),
    };
  }

  /**
   * 启动时一次性预加载 wallet_offline_profiles 全表到内存 Map（回测 BacktestEngine._initializeDataSources
   * 与 live 引擎启动序列均调）。消除 _fetchOfflineProfile 的逐钱包 round-trip。
   * 全表行数 = step4 产出的高频钱包数（threshold 3 过滤后，量级数千-数万）。
   * ★单独 _offlineProfilePreloaded Map，绝不写入 _walletProfileCache（后者 TTL 命中会短路 fresh/stale/miss
   *   分类，丢 stale 增量合并 → 口径错）。web（每请求 new）不 preload → 保持 null → fetch 自动 fallback DB。
   * 用 PostgREST（supabase-js）cursor 分页读全表（range offset 在大 JSONB 表不稳，母版实证丢 35% 行）。
   * try/catch：失败 log warn + Map 保持 null → fetch 函数回退 DB（优化失效不影响正确性）。
   * @param {Object} supabase 引擎持有的 supabase client（dbManager.getClient()）
   * @returns {Promise<{rows:number, ms:number}>}
   */
  async preloadOfflineProfiles(supabase) {
    const _t0 = this._prof ? Date.now() : 0;
    const t0 = Date.now();
    const CACHE_FILE = path.join(process.cwd(), 'data', 'offline-cache', 'wallet_offline_profiles.jsonl.gz');
    try {
      if (!supabase) throw new Error('supabase client 未传入');
      // ① 文件缓存优先：step4 重建后清空文件失效（见 build-wallet-profiles 末尾 rm）；省全表 SELECT
      if (fs.existsSync(CACHE_FILE)) {
        // ★时效校验（兜底防 step4 脱节，详见构造函数 _offlineCacheMaxAgeMs 注释）：mtime 超 maxAge →
        //   视为过期重 SELECT，避免实盘机缓存落后 step4 漏加载新 holder。step4 删缓存是主防线，此为兜底。
        let cacheExpired = false;
        if (this._offlineCacheMaxAgeMs > 0) {
          try {
            const mtimeMs = fs.statSync(CACHE_FILE).mtimeMs;
            if (Date.now() - mtimeMs > this._offlineCacheMaxAgeMs) {
              cacheExpired = true;
              log('warn', `offline cache 过期(mtime ${new Date(mtimeMs).toISOString()} 已 ${((Date.now() - mtimeMs) / 3600000).toFixed(1)}h > 阈值 ${this._offlineCacheMaxAgeMs / 3600000}h) → 重 SELECT（防 step4 脱节漏 holder）`);
            }
          } catch (e) { /* stat 失败 → 走原缓存解析（下文 _readOfflineCacheFile 兜底判损坏） */ }
        }
        if (!cacheExpired) {
          const cached = await this._readOfflineCacheFile(CACHE_FILE);
          if (cached && cached.size) {
            this._offlineProfilePreloaded = cached;
            if (this._prof) this._profTock('preloadOffline', _t0);
            const ms = Date.now() - t0;
            log('info', `preloadOfflineProfiles(文件缓存): ${cached.size} 行 / ${(ms / 1000).toFixed(1)}s → fetchOffline 改内存读`);
            return { rows: cached.size, ms, source: 'cache' };
          }
          log('warn', `offline cache 文件存在但解析为空/损坏 → 重 SELECT: ${CACHE_FILE}`);
        }
      }
      // ② cache 不存在/损坏 → SELECT 全表（cursor 分页：.gt(address)+order+limit，仅空页终止确保载全）
      const map = new Map();
      const PAGE = 1000;
      let lastAddress = null;
      let pages = 0;
      while (true) {
        let q = supabase.from('wallet_offline_profiles')
          .select('address,data_through,profile').order('address').limit(PAGE);
        if (lastAddress) q = q.gt('address', lastAddress);
        const { data, error } = await q;
        if (error) throw error;
        pages++;
        for (const r of (data || [])) {
          if (r && r.address && r.data_through && r.profile) {
            map.set(r.address, {
              dataThroughMs: new Date(r.data_through).getTime(),
              dataThroughIso: r.data_through,
              profile: r.profile,
            });
          }
        }
        if (!data || data.length === 0) break; // cursor 真正终止 = 空页（中间页 timeout 截断返部分不 break，lastAddress 续传至真正末尾）
        lastAddress = data[data.length - 1].address;
      }
      this._offlineProfilePreloaded = map;
      // ③ 落盘 cache（异步写，失败不阻塞；下次启动读文件省 SELECT）
      this._writeOfflineCacheFile(CACHE_FILE, map).catch(e => log('warn', `offline cache 落盘失败(不阻塞)`, { error: e.message }));
      if (this._prof) this._profTock('preloadOffline', _t0);
      const ms = Date.now() - t0;
      log('info', `preloadOfflineProfiles(DB): ${map.size} 行 / ${(ms / 1000).toFixed(1)}s（PostgREST ${pages} 页，已落盘 cache）→ fetchOffline 改内存读`);
      return { rows: map.size, ms, source: 'db' };
    } catch (e) {
      const ms = Date.now() - t0;
      log('warn', `preloadOfflineProfiles 失败, 回退 DB 按需查 (${(ms / 1000).toFixed(1)}s)`, { error: e.message });
      // _offlineProfilePreloaded 保持 null → fetch 函数 fallback DB（行为同未优化）
      return { rows: 0, ms };
    }
  }

  /** 流式读 gzip jsonl cache → Map（每行 {address,data_through,profile}）。损坏/空返 null → 调用方重 SELECT。 */
  _readOfflineCacheFile(file) {
    return new Promise((resolve) => {
      const map = new Map();
      const rl = readline.createInterface({
        input: fs.createReadStream(file).pipe(zlib.createGunzip()),
        crlfDelay: Infinity,
      });
      rl.on('line', (line) => {
        if (!line) return;
        try {
          const r = JSON.parse(line);
          if (r && r.address && r.data_through && r.profile) {
            map.set(r.address, {
              dataThroughMs: new Date(r.data_through).getTime(),
              dataThroughIso: r.data_through,
              profile: r.profile,
            });
          }
        } catch (e) { /* 单行损坏跳过；全空由 size 判断重 SELECT */ }
      });
      rl.on('close', () => resolve(map.size ? map : null));
      rl.on('error', () => resolve(null));
    });
  }

  /** 流式写 gzip jsonl cache（每行一个 profile JSON，避免 V8 单字符串超长）。 */
  _writeOfflineCacheFile(file, map) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const out = fs.createWriteStream(file);
      const gz = zlib.createGzip();
      gz.pipe(out);
      for (const [addr, v] of map) {
        gz.write(JSON.stringify({ address: addr, data_through: v.dataThroughIso, profile: v.profile }) + '\n');
      }
      gz.end();
      out.on('finish', resolve);
      out.on('error', reject);
    });
  }

  /**
   * 注入本实验 historical ticks，预建 trader→ticks 索引（仅回测 BacktestEngine）。
   * 之后 _fetchWalletTicksBatch 读索引零 DB round-trip（miss/stale 路 ticks 全在本实验内）。
   * 口径注记（架构性偏离 #4）：注入 = BacktestEngine._loadWssTicks 的实验口径（platform 过滤后）；
   *   DB 直查路径（live/web）天然跨平台（钱包画像跨平台全局）。增量段缺异平台 tick，已接受。
   *   ★须注入过滤前的原始全量（token 集合全集），勿再窄化——inc 段漏 tick 会丢 bad 计数。
   * BacktestEngine._initializeDataSources 在 preloadOfflineProfiles 后调一次（同步，启动期一次性建索引）。
   * @param {Array<Object>} ticks 本实验全量 ticks（按 block_time 序；buildProfileFromTicks bad_action
   *   用绝对 block_time 判定，不依赖数组序）
   * @returns {number} 索引内 trader 数
   */
  setHistoricalTicks(ticks) {
    if (!Array.isArray(ticks) || !ticks.length) { this._walletTicksPreloaded = null; return 0; }
    const idx = new Map();
    for (const t of ticks) {
      if (!t.trader_address) continue;
      let arr = idx.get(t.trader_address);
      if (!arr) { arr = []; idx.set(t.trader_address, arr); }
      arr.push(t);
    }
    this._walletTicksPreloaded = idx;
    if (process.env.DBG_WALLET) {
      const _a = idx.get(process.env.DBG_WALLET);
      console.error(`[DBG_SETHIST] ${process.env.DBG_WALLET.slice(0, 10)} injected=${_a ? _a.length : 0} ticks / ${idx.size} traders`);
    }
    return idx.size;
  }

  // （live 三件套 initLiveTicksBuffer/preloadRecentTicks/ingestLiveTick 不迁——架构性偏离 #1，
  //   见文件头注。watcher 架构 DB 即真相，live 直查 as-of 窗口永远完整。）

  /**
   * 批量预加载 token profile 塞满 _tokenProfileCache（两条路径共用）：
   * - 回测：BacktestEngine._initializeDataSources 在 setHistoricalTicks 后调一次（本实验全部 token
   *   一次预载 → 之后触发的 _fetchTokenProfiles 全 cache 命中零 DB）。回测数据冻结，token 分类
   *   （category/闪崩段/firstTickTime）客观稳定（缓存不过期），启动期一次覆盖整个回测期。
   * - live 预热：WssTradingEngine 启动 fire-and-forget 调 prewarmLiveTokenProfiles（BSC live 无
   *   ticks 缓冲恒 no-op，见下）。
   * .has() 过滤已缓存 token（幂等：OPB 已喂入的新分类不会被旧 DB 快照覆盖）。
   * @param {string[]} tokenAddrs unique token_address 数组
   * @param {object} supabase
   * @returns {Promise<number>} 预加载后 _tokenProfileCache 内 token 数
   */
  async preloadTokenProfiles(tokenAddrs, supabase) {
    if (!Array.isArray(tokenAddrs) || !tokenAddrs.length) return this._tokenProfileCache.size;
    const missing = tokenAddrs.filter(a => !this._tokenProfileCache.has(a));
    if (!missing.length) return this._tokenProfileCache.size;
    const t0 = Date.now();
    // 并发预载：chunk=100（防 .in() URL 超长静默吞错）× 8 worker 池（每 token 只进一个 chunk → Map.set 无竞争）。
    //   单批失败 warn 后不写 cache（该批 token 运行期仍可按需重查；宁慢，勿把 token 永久卡成 null）。
    const chunks = [];
    for (let i = 0; i < missing.length; i += 100) chunks.push(missing.slice(i, i + 100));
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const batch = chunks[next++];
        const resolved = await this._queryTokenProfileChunk(batch, supabase);
        if (resolved === null) continue; // 查询失败：不写 cache（该批 token 留待运行期按需查）
        for (const a of batch) this._tokenProfileCache.set(a, this._normalizeTokenProfile(resolved.get(a) || null)); // miss 写 null 防重查
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, chunks.length) }, worker));
    log('info', `preloadTokenProfiles: ${missing.length} token（${chunks.length} 批）/ ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return this._tokenProfileCache.size;
  }

  /**
   * live 预热：从 _walletTicksPreloaded 收集 distinct token_address → preloadTokenProfiles 一次预载。
   * ★BSC live 无 ticks 缓冲（架构性偏离 #1，initLiveTicksBuffer 不迁）→ _walletTicksPreloaded 仅回测
   *   setHistoricalTicks 填充 → live 调用恒返 null（干净 no-op，保留函数体对齐母版结构，未来 live 补
   *   缓冲即生效）；回测已直接用 token 集合 preloadTokenProfiles，本函数回测也无需调。
   * @param {object} supabase
   * @returns {Promise<{tokens:number,cached:number,ms:number}|null>} null=缓冲未初始化/无 token
   */
  async prewarmLiveTokenProfiles(supabase) {
    if (!this._walletTicksPreloaded || this._walletTicksPreloaded.size === 0) return null;
    const tokens = new Set();
    for (const ticks of this._walletTicksPreloaded.values()) {
      for (const t of ticks) tokens.add(t.token_address);
    }
    if (!tokens.size) return null;
    const t0 = Date.now();
    const cached = await this.preloadTokenProfiles([...tokens], supabase);
    return { tokens: tokens.size, cached, ms: Date.now() - t0 };
  }

  /**
   * 写入/覆盖单 token 的 _tokenProfileCache 条目。live OPB 在线分类落库成功后由引擎回调喂入
   * （OPB 只写库不留内存 → 无此钩子时 token 在分类完成前被查过会 stuck-null 永不更新，此为该缺陷的修复）。
   * 无条件 set（含覆盖旧 null）。前视安全：live _alignClassifiedAsOf=false（读时不做 asOf 过滤）；
   * 传入 DB 行形状（category 顶层列 + profile JSONB + classified_at/category_visible_at，与
   * _queryTokenProfileChunk 读回同形状）；回测不构造 OPB 不受影响。
   * @param {string} tokenAddress
   * @param {object|null} tokenProfilesRow token_profiles DB 行原始形状（snake_case）
   */
  upsertTokenProfileCache(tokenAddress, tokenProfilesRow) {
    this._tokenProfileCache.set(tokenAddress, this._normalizeTokenProfile(tokenProfilesRow));
  }

  // ── 公共：引擎 _onFactorsUpdated 调用 ──

  /**
   * 触发检测 + 异步分析。触发条件用 FA 全量计数器（richer-js state.tradeCount / state.totalBuyBnb，
   * processTick 无 skip 守卫直加）+ 时间基准门二选一（blocks：tick.block_number − state.firstBlockNumber；
   * ageSeconds：state.firstTickAt）。
   *
   * @returns {Promise<void>|null} 未触发/未启用返回 null；触发则返回 _analyze 的 promise（含 .catch 兜底）。
   *   live 引擎可忽略返回值（fire-and-forget）；backtest 引擎应 `await` 以保证同 tick 内 verdict 就绪。
   *
   * @param {string} tokenAddress
   * @param {Object} factors 当前 tick 因子快照（取 currentPriceBnb 喂触发快照观察）
   * @param {Object} faState FactorAggregator token state（tradeCount/totalBuyBnb/firstBlockNumber/firstTickAt/_traderNetTokens/...）
   * @param {Object} tick 当前 tick（live=factorsUpdated payload 的 tick（含 block_number）；backtest=wss_price_ticks 行（含 block_number+block_time））
   * @param {number} asOfTime as-of 毫秒时间戳（live=tick.timestamp/now；backtest=tick block_time ms）
   */
  checkAndTrigger(tokenAddress, factors, faState, tick, asOfTime) {
    if (!this._enabled) return null;
    if (!this._trigger) throw new Error('[TokenPositionAnalyzer] trigger 未配置（TRIGGER_NOT_USED 路径不可调用 checkAndTrigger）');
    if (!faState || !tokenAddress) return null;
    if (this._analyzed.has(tokenAddress)) return null; // v1 单次

    const firstTickAt = faState.firstTickAt || 0;
    const ageSeconds = firstTickAt > 0 ? Math.max(0, (asOfTime - firstTickAt) / 1000) : 0;
    const rawTradeCount = faState.tradeCount || 0;
    // ★faState.totalBuyBnb 已是 BNB 浮点（FA processTick 直接累加 tick.bnb_amount），勿再做任何单位换算。
    const rawBuyBnb = faState.totalBuyBnb || 0;

    // 时间基准门（blocks XOR ageSeconds，构造期已校验恰好一个）：
    //   blocks：tick.block_number − faState.firstBlockNumber ≥ blocks（块基准=首带 block 的 tick，FA processTick write-once 赋值）。
    //     无块证据（基准或当前 tick 任一 null）fail-closed 本 tick 不触发，等下一个带 block 的 tick。
    //   ageSeconds：age>此值（复现口径逐字不变）。
    if (this._trigger.blocks != null) {
      const firstBlock = faState.firstBlockNumber;
      const tickBlock = tick ? tick.block_number : null;
      if (firstBlock == null || tickBlock == null) return null;
      if (Number(tickBlock) - Number(firstBlock) < this._trigger.blocks) return null;
    } else if (ageSeconds <= this._trigger.ageSeconds) return null;
    if (rawTradeCount <= this._trigger.tradeCount) return null;
    if (rawBuyBnb <= this._trigger.buyBnb) return null;

    // 持仓人数门：当前 net>0 持仓者 < minHolders 不触发（拦 holder 缩减的死盘，详见构造器 trigger 注释）
    let holderCount = 0;
    if (faState._traderNetTokens) {
      for (const net of faState._traderNetTokens.values()) if (net > 0) holderCount++;
    }
    if (holderCount < this._trigger.minHolders) return null;

    // 命中 → 标记 + 异步分析
    this._analyzed.add(tokenAddress);
    const snapshot = {
      ageSeconds: Number(ageSeconds.toFixed(2)),
      tradeCount: rawTradeCount,
      buyBnb: Number(rawBuyBnb.toFixed(4)),
      currentPriceBnb: factors?.currentPriceBnb ?? null, // BSC 原生价（USD 输出仅 blockLowMcapUsd，FA 偏离 #4）
    };
    if (this._trigger.blocks != null && faState.firstBlockNumber != null && tick?.block_number != null) {
      snapshot.blockDiff = Number(tick.block_number) - Number(faState.firstBlockNumber); // blocks 门触发时点观察（落表 trigger_snapshot）
    }
    log('info', `触发分析 ${tokenAddress.slice(0, 12)}… age=${snapshot.ageSeconds}s tc=${rawTradeCount} buyBnb=${snapshot.buyBnb}`);

    // 返回 promise：backtest await 保证同 tick verdict 就绪；live 忽略即 fire-and-forget。
    // .catch 兜底：失败保守留 verdict=pending；不重置 _analyzed 避免反复失败重试拖垮 tick。
    return this._analyze(tokenAddress, factors, faState, asOfTime, snapshot).catch(err => {
      log('error', `分析失败 ${tokenAddress.slice(0, 12)}…`, { error: err.message });
    });
  }

  /**
   * 取 token 的 verdict（buy/sell 评估入口检查用）。
   * @returns {{verdict:'pending'|'approve'|'block', reasons?:string[], factors?:Object}|null}
   *     未启用 → null（调用方视为放行）；已启用未触发 → pending；触发后 approve/block。
   */
  getVerdict(tokenAddress) {
    if (!this._enabled) return null;
    const v = this._verdictCache.get(tokenAddress);
    return v ? v : { verdict: 'pending' };
  }

  /** 模块是否启用。 */
  isEnabled() { return !!this._enabled; }

  /** 是否 enforce 模式（配置标记；去门控化后仅落表/展示记录该实验的 enforce 配置，无门控差异）。 */
  isEnforceMode() { return !!this._enforce; }

  getStats() {
    return {
      enabled: this._enabled,
      enforce: this._enforce,
      analyzedCount: this._analyzed.size,
      profileCacheSize: this._walletProfileCache.size,
    };
  }

  // ── 异步分析主流程 ──

  async _analyze(tokenAddress, factors, faState, asOfTime, snapshot) {
    const _t0 = this._prof ? Date.now() : 0;
    const _tWall = Date.now(); // 运行耗时观察因子口径（无条件记录，不受 _prof 开关控制）
    // 1-4. holders top N → as-of 画像 → 评分/庄散聚合（共享管线）。
    const topHolders = this._collectTopHolders(faState);
    const metrics = await this._computeHolderMetrics(topHolders, faState, asOfTime);
    const { walletProfiles, walletScoreSummary, zhuangRetail, zhuangRetailRatio, walletHoldingPct } = metrics;

    const holdingFactors = { TPAPre_walletHoldingPct: walletHoldingPct };
    // TPAPre_tokenScore 暴露为 holdingFactors（门→因子：供 strategy condition 引用 TPAPre_tokenScore>X）。
    holdingFactors.TPAPre_tokenScore = walletScoreSummary?.totalScore ?? null;
    // 庄散加权分注入 holdingFactors（TPAPre_ 前缀）：verdict/setHoldingFactors/_persist 均消费 holdingFactors，
    //   注入一处三处具备。zhuangRetail==null（holderCount=0）不写入 → 条件引用时因子缺失 fail-closed。
    if (zhuangRetail) {
      holdingFactors.TPAPre_zhuangScore = zhuangRetail.zhuangScore;
      holdingFactors.TPAPre_retailScore = zhuangRetail.retailScore;
      holdingFactors.TPAPre_newWalletScore = zhuangRetail.newWalletScore;
      holdingFactors.TPAPre_neutralScore = zhuangRetail.neutralScore;
      holdingFactors.TPAPre_minZR = zhuangRetail.minZR;
      holdingFactors.TPAPre_gapZR = zhuangRetail.gapZR;
      // 庄散比 + 4 桶占比（verdict 决策口径）：与 _decideVerdict 同源 computeZhuangRetailRatio。
      //   持久化供 web 读落表（approve 行 block_reasons=[] 无 ratio 字符串，须结构化字段）。
      //   Infinity sanitize：JSON.stringify(Infinity) 静默变 null，故 ratio=null + infinite=true 区分
      //   "散户=0的∞"与"无数据"。
      holdingFactors.TPAPre_zhuangPct = zhuangRetail.zhuangPct;
      holdingFactors.TPAPre_newWalletPct = zhuangRetail.newWalletPct;
      holdingFactors.TPAPre_retailPct = zhuangRetail.retailPct;
      holdingFactors.TPAPre_neutralPct = zhuangRetail.neutralPct;
      holdingFactors.TPAPre_zhuangHolderCount = zhuangRetail.holderCount;
      holdingFactors.TPAPre_zhuangRetailRatio = Number.isFinite(zhuangRetailRatio) ? Number(zhuangRetailRatio.toFixed(3)) : null;
      holdingFactors.TPAPre_zhuangRetailRatioInfinite = !Number.isFinite(zhuangRetailRatio);
    }

    // 6. verdict（评分体系收口后唯一路径：tokenScore + 庄散比；holdingFactors 供可选 whp 放宽路径引用）
    const { verdict, blockReasons } = this._decideVerdict(walletScoreSummary, zhuangRetail, holdingFactors);

    // 6b. 运行耗时观察因子：触发→完成 wall clock 耗时 + 画像就绪时代币年龄（early 竞态实锤用，
    //     随 holdingFactors 落表三路；analyzedAgeSec=触发年龄+耗时近似）。
    const _durMs = Date.now() - _tWall;
    holdingFactors.TPAPre_analyzeDurationMs = _durMs;
    holdingFactors.TPAPre_analyzedAgeSec = Number((snapshot.ageSeconds + _durMs / 1000).toFixed(2));

    // 7. 回填 holding 因子到 FA 缓存（供 scorer/condition 读）
    this._faClass?.setHoldingFactors?.(tokenAddress, holdingFactors);

    // 7b. 冻结 retention（大户走没走）基准：buildFactorMap 每 tick 据 state._traderNetTokens 算
    //     netZ@T → retention=netZ@T/netZ@D。
    //   ★新口径：大户集独立从 faState._traderMaxNetTokens(maxNet>0) 枚举 —— 不复用 verdict
    //     holders(walletProfiles/net>0)，因清仓大户触发时 netTokens≈0 被漏，但其 maxNet 保留 →
    //     独立枚举才不丢"触发前已跑路的庄"。
    //   netZ@D = Σ 大户 maxNetTokens（建仓峰值，含清仓大户）；classifyHolder 仅依赖 offline profile
    //   字段（不读 netTokens/floatPct）。verdict/tokenScore/庄散比/floatPct 仍用上方 walletProfiles
    //   （步骤 4-6），此处只动 retention，互不影响。
    {
      const retCandidates = [];
      if (faState._traderMaxNetTokens) {
        for (const [addr, maxNet] of faState._traderMaxNetTokens) {
          if (maxNet > 0) retCandidates.push({ address: addr, net: maxNet });
        }
      }
      retCandidates.sort((a, b) => b.net - a.net);
      const topRet = retCandidates.slice(0, this._maxHolders);
      const retProfiles = await this._computeWalletProfilesBatch(topRet, asOfTime);
      const _creatorAddr = faState.creatorAddress || null;
      for (const p of retProfiles) p.isCreator = !!(_creatorAddr && p.address && p.address === _creatorAddr);

      const zhuangAddresses = [];
      let netZAtDecision = 0;
      const _maxMap = faState._traderMaxNetTokens;
      for (const p of retProfiles) {
        if (classifyHolder(p) !== 'zhuang') continue;  // 行为大户判定，去 floatPct>0 门（清仓大户 floatPct≈0 仍纳入）
        if (p.address) zhuangAddresses.push(p.address);
        netZAtDecision += (_maxMap.get(p.address) || 0);  // ★峰值求和（非 netTokens）
      }
      if (zhuangAddresses.length && netZAtDecision > 0) {
        this._faClass?.setRetentionBasis?.(tokenAddress, { zhuangAddresses, netZAtDecision });
      }
    }

    // 8. 缓存 verdict
    const verdictEntry = { verdict, reasons: blockReasons, factors: holdingFactors, asOf: asOfTime, snapshot };
    this._verdictCache.set(tokenAddress, verdictEntry);

    // 8b. K 线 asofRelFirst 冻结：approve 时把审批时刻注入 FA，FA 用此刻 _relPriceBnb（processTick 已推进）
    //     冻结"相对首可靠价涨幅"为静态因子（复刻 offline asofRelFirst），供 entry condition 消费。
    //     ⚠️flap creator=工厂地址（架构性偏离 #5）不影响此处；setAsofMs 幂等（已冻结跳过）。
    if (verdict === 'approve' && this._factorAggregator) {
      this._factorAggregator.setAsofMs(tokenAddress, asOfTime);
    }

    log('info', `✓ ${tokenAddress.slice(0, 12)}… verdict=${verdict} holders=${walletProfiles.length} ${blockReasons.length ? 'block:[' + blockReasons.join(',') + ']' : ''}`);

    // 9. 落表
    await this._persist(tokenAddress, asOfTime, snapshot, verdict, blockReasons, holdingFactors);
    if (this._prof) { this._prof.analyzeN++; this._prof.analyzeMs += Date.now() - _t0; }
  }

  // ── 共享 holder 指标管线（_analyze[TPAPre_] 消费；输出无前缀标量，调用方自行映射 TPAPre_ 前缀）──

  /** 步骤1：holders（net>0）按持仓量降序取 top N（maxHoldersToAnalyze，默认 20）。 */
  _collectTopHolders(faState) {
    const holders = [];
    if (faState._traderNetTokens) {
      for (const [addr, net] of faState._traderNetTokens) {
        if (net > 0) holders.push({ address: addr, net });
      }
    }
    holders.sort((a, b) => b.net - a.net);
    return holders.slice(0, this._maxHolders);
  }

  /**
   * 步骤2-4：per-holder as-of 画像（批量）→ floatPct/isCreator 打标 → 钱包评分 + 庄散聚合。
   * 输出无前缀标量（调用方自行映射 TPAPre_ 前缀）；_computeWalletScores 消费
   * holdingFactors.TPAPre_walletHoldingPct（scorer 公共接口键映射的历史口径，shim 仅本地使用）。
   */
  async _computeHolderMetrics(topHolders, faState, asOfTime) {
    // 2. per-holder as-of 画像（批量：同 token 所有 holder 一次 IN 查 offline + ticks，往返 N→1）。
    const walletProfiles = await this._computeWalletProfilesBatch(topHolders, asOfTime);

    // 3. floatTotal（Σ topHolders netTokens，供 floatPct 归一化口径一致）+ holding 因子（仅 walletHoldingPct）。
    const floatTotal = this._computeFloatStats(topHolders);
    const holdingFactors = this._buildHoldingFactors(faState);
    const walletHoldingPct = holdingFactors.TPAPre_walletHoldingPct;

    // 补 floatPct（落表明细 + 集中度惩罚用）+ isCreator（classifyHolder creator 豁免 sniper：发币者持仓
    // 集中抛售是控盘行为。⚠️flap creator=工厂共享地址 → isCreator 事实失效，真实操纵者不获豁免=更严方向）。
    const _creatorAddr = faState.creatorAddress || null;
    for (const p of walletProfiles) {
      p.floatPct = floatTotal > 0 ? Number(((p.netTokens / floatTotal) * 100).toFixed(2)) : 0;
      p.isCreator = !!(_creatorAddr && p.address && p.address === _creatorAddr);
    }

    // 4. 钱包评分(token 总分) + 庄散聚合（verdict 收口后恒算：tokenScore/zhuangRetailRatio 是 verdict 操作数）。
    //    scoreTokenFromHolders 已将 per-holder score 写回 walletProfiles；computeZhuangRetail 依赖之。
    const walletScoreSummary = this._computeWalletScores(walletProfiles, holdingFactors);
    const zhuangRetailAgg = computeZhuangRetail(walletProfiles);
    const zhuangRetailRatioVal = computeZhuangRetailRatio(zhuangRetailAgg);
    return { walletProfiles, floatTotal, walletHoldingPct, walletScoreSummary, zhuangRetail: zhuangRetailAgg, zhuangRetailRatio: zhuangRetailRatioVal };
  }

  // ── per-holder as-of 画像 ──

  /**
   * 算某钱包截至 asOf 的画像（带 (wallet) TTL 缓存）。
   * @returns {Promise<Object>} { address, rawTotal, tokenCount, buckets, ..., source, dataThroughMs }
   */
  async _computeWalletProfile(address, asOfTime, opts = {}) {
    const cacheKey = address; // TTL(10min) 已保证时效，无需 asOfDay 分桶
    const cached = this._walletProfileCache.get(cacheKey);
    if (cached && (asOfTime - cached.ts) < this._cacheTtlMs) {
      return { ...cached.profile, address };
    }

    const profile = await this._fetchAndBuildProfile(address, asOfTime, opts);

    this._walletProfileCache.set(cacheKey, { ts: asOfTime, profile });
    // 缓存无界增长保护：粗 cap（backtest 单实验 token 数有限，holder 去重后通常 < 数万）
    if (this._walletProfileCache.size > 200000) {
      this._walletProfileCache.clear();
    }
    return { ...profile, address };
  }

  /**
   * 算某钱包截止 asOf 的画像（单一离线+增量路径，所有钱包统一处理）：
   *   1. 查 wallet_offline_profiles（step4 高频钱包全历史预计算）
   *      - 未命中（小钱包或离线表未填充）→ 实时 fetch [asOf-lookback, asOf] 全量 buildProfileFromTicks
   *      - asOf <= data_through → 直接用离线 profile（近似；母版用户确认 OK：钱包质量特征稳定，token_profiles 全局）
   *      - asOf >  data_through → 离线 + fetch [data_through, asOf] 增量 mergeOfflineProfile
   *   2. isSniper 不落字段：使用点（wallet-scorer _isSniperLike 内部 tokenCount>=300 现算）。
   * ⚠️画像收口：不读 wallets.category/tags/clusters，bad_action 口径单一源 = buildProfileFromTicks。
   */
  async _fetchAndBuildProfile(address, asOfTime, opts = {}) {
    const supabase = this._getClient();
    const asOfIso = new Date(asOfTime).toISOString();

    const runtime = {};

    // 1. 查离线 profile（wallet_offline_profiles：高频钱包全历史预计算）。
    // ★asOfStrict（web decision 重算）：跳过 offline——offline 是 buildProfileFromTicks【全历史】口径
    //   （effectiveTradeCount/badCount14d 为累积计数），与决策时刻【14d 窗口截止 asOf】口径不同；
    //   路径2/3 用 offline 会让计数虚高→maliciousCap 误升→score 暴跌。跳过后走路径1 fetch[asOf-lookback, asOf]，
    //   与回测完全同口径。
    const offline = opts.asOfStrict ? null : await this._fetchOfflineProfile(supabase, address);

    // collectBreakdown（trader 详情页三栏展示用）：breakdown.offline/inc 透出中间段（builder 产出格式），
    // 供调用方各自 _packProfile 展示；不影响默认路径（_computeWalletProfile 不传 opts → 返回 profile）。
    const breakdown = opts.collectBreakdown ? { offline: null, inc: null } : null;

    let built;
    if (!offline) {
      // 未命中 → 实时 fetch [asOf-lookback, asOf] 全量（小钱包数据少，14d 够；高频钱包离线表已覆盖）
      const lookbackIso = new Date(asOfTime - this._profileLookbackDays * 86400000).toISOString();
      const ticks = await this._fetchWalletTicks(supabase, address, lookbackIso, asOfIso);
      built = await this._buildProfileFromTicks(ticks, supabase, asOfTime);
      runtime.source = 'realtime';
      // 未命中离线：增量栏 = 全量实时（无离线栏）
      if (breakdown) breakdown.inc = built;
    } else if (asOfTime <= offline.dataThroughMs) {
      // asOf <= data_through → 直接用离线（近似：钱包质量特征稳定 + token_profiles 全局）
      // 注：asOfStrict 模式 offline=null 已走路径1，不会到此分支。
      built = offline.profile;
      runtime.source = 'offline';
      runtime.dataThroughMs = offline.dataThroughMs;
      // 无增量（now ≤ data_through）：仅离线栏
      if (breakdown) breakdown.offline = offline.profile;
    } else {
      // asOf > data_through → 离线 + fetch [data_through, asOf] 增量合并
      const incTicks = await this._fetchWalletTicks(supabase, address, offline.dataThroughIso, asOfIso);
      const inc = await this._buildProfileFromTicks(incTicks, supabase, asOfTime);
      built = mergeOfflineProfile(offline.profile, inc);
      // low-level bad_action 独立 merge（offline.profile 来自 DB JSONB + inc 来自 compute）
      if (this._lowLevelBadAction && this._lowLevelBadAction.enabled !== false) {
        built.lowLevelBadAction = mergeLowLevelBadAction(offline.profile.lowLevelBadAction, inc.lowLevelBadAction);
      }
      // good-action 独立 merge（offline.profile 来自 DB JSONB + inc 来自 compute）
      if (this._goodAction && this._goodAction.enabled !== false) {
        built.goodAction = mergeGoodAction(offline.profile.goodAction, inc.goodAction);
      }
      // tiny-level bad_action 独立 merge（offline.profile 来自 DB JSONB + inc 来自 compute）
      if (this._tinyLevelBadAction && this._tinyLevelBadAction.enabled !== false) {
        built.tinyLevelBadAction = mergeTinyLevelBadAction(offline.profile.tinyLevelBadAction, inc.tinyLevelBadAction);
      }
      runtime.source = 'offline+inc';
      runtime.dataThroughMs = offline.dataThroughMs;
      if (breakdown) { breakdown.offline = offline.profile; breakdown.inc = inc; }
    }

    const profile = this._packProfile(built, runtime);
    if (breakdown) return { profile, breakdown };
    return profile;
  }

  /**
   * 查 wallet_offline_profiles 单条（高频钱包全历史预计算 profile）。
   * @returns {Promise<{dataThroughMs:number, dataThroughIso:string, profile:Object}|null>}
   */
  async _fetchOfflineProfile(supabase, address) {
    // 预加载（_offlineProfilePreloaded 已填充）→ 内存读，零 round-trip；web/live（null）→ 下方 fallback DB 单查
    if (this._offlineProfilePreloaded) return this._offlineProfilePreloaded.get(address) || null;
    const { data, error } = await supabase.from('wallet_offline_profiles')
      .select('data_through,profile')
      .eq('address', address)
      .limit(1)
      .maybeSingle();
    if (error || !data || !data.profile) return null;
    return { dataThroughMs: new Date(data.data_through).getTime(), dataThroughIso: data.data_through, profile: data.profile };
  }

  /**
   * 打包 profile（builder/merge 产出 + 运行时来源）→ 内存标准对象（喂 scorer / 落表）。
   * ★isSniper 不作为字段：使用点从 tokenCount >= HIGH_FREQ_THRESHOLD(200) 现算（不落表、不存 JSONB）。
   * ⚠️画像收口后不含 tags/category/clusterIds（不读 wallets.*）；badAction 单一源 = buildProfileFromTicks。
   * @param {Object} built buildProfileFromTicks / mergeOfflineProfile 产出（统计量；无 perToken）
   * @param {Object} [runtime] { source, dataThroughMs, sampleApprox, scoreFallback }
   */
  _packProfile(built, runtime = {}) {
    const tokenCount = built.tokenCount ?? built.rawTotal ?? 0;
    const isHighFreq = tokenCount >= HIGH_FREQ_THRESHOLD; // ★isSniper 使用点（>=200 现算）
    return {
      rawTotal: built.rawTotal ?? tokenCount,
      tokenCount,                                      // distinct token 数（isSniper/新钱包判定源；rawTotal 同值兼容历史）
      buckets: isHighFreq ? null : (built.buckets ?? null),   // 高频钱包不算桶（避免与 dust/lowAll 桶双重计数）
      dustRatio: isHighFreq ? 0 : (built.dustRatio ?? 0),
      lowRatio: isHighFreq ? 0 : (built.lowRatio ?? 0),
      lowTinyRatio: isHighFreq ? 0 : (built.lowTinyRatio ?? 0),
      badAction: !!built.badAction,
      // 钱包评分 raw 统计量（BNB 浮点，scorer 直读无转换）
      totalBnb: built.totalBnb ?? 0,
      tickCount: built.tickCount ?? 0,
      aggregatedTradeCount: built.aggregatedTradeCount ?? null, // ★连续同向聚合后意图数（avg 分母；展示用，scorer 不读）
      avgBnb: built.avgBnb ?? 0,
      buyCount: built.buyCount ?? 0,
      sellCount: built.sellCount ?? 0,
      largeTradeCount: built.largeTradeCount ?? 0,
      effectiveTradeCount: built.effectiveTradeCount ?? 0,
      // ★Tier2 暴力block集中抛售（wallet-scorer multiplier 衰减用；buildProfileFromTicks/mergeOfflineProfile 产出）
      tier2CrashBlockSellCount: built.tier2CrashBlockSellCount ?? 0,
      tier2Ratio: built.tier2Ratio ?? null, // null=effectiveTradeCount=0 低频钱包无分母（count 必=0 不触发衰减）
      badCount14d: built.badCount14d ?? 0,
      badRatio: built.badRatio ?? 0,
      earlyLargeBuyCount: built.earlyLargeBuyCount ?? 0,
      crashLargeSellCount: built.crashLargeSellCount ?? 0,
      badBuyCount: built.badBuyCount ?? 0,
      badSellCount: built.badSellCount ?? 0,
      badBuyRatio: built.badBuyRatio ?? 0,
      badSellRatio: built.badSellRatio ?? 0,
      // 持仓时间（per-token 大额 FIFO 配对；null=无已平仓较大额 token 口径失效）
      avgHoldSeconds: built.avgHoldSeconds ?? 0,
      medianHoldSeconds: built.medianHoldSeconds ?? null,
      firstSeenMs: built.firstSeenMs ?? null,
      sampleApprox: !!runtime.sampleApprox,
      scoreFallback: !!runtime.scoreFallback,
      source: runtime.source || null,                  // 'offline' | 'offline+inc' | 'realtime'（展示/诊断）
      dataThroughMs: runtime.dataThroughMs ?? null,    // 离线 profile 截止时间（展示）
      // low-level bad_action 独立特性（纯观察，不进 scorer；enabled 时由 compute/merge 填充，否则 null）
      lowLevelBadAction: built.lowLevelBadAction ?? null,
      // good-action 独立特性（纯观察，不进 scorer；enabled 时由 compute/merge 填充，否则 null）
      goodAction: built.goodAction ?? null,
      // tiny-level bad_action 独立特性（0.2/0.2 档；enabled 时由 compute/merge 填充，否则 null）
      tinyLevelBadAction: built.tinyLevelBadAction ?? null,
    };
  }

  /**
   * id 分页取钱包 ticks（PostgREST cap 1000，须 id 游标分页）。
   * 只取算画像所需列（bnb_amount BNB 浮点 + block_number Tier2 用）。跨平台全局：无 platform 过滤
   *   （钱包画像是地址属性，与离线表/三路径口径严格同构）。
   * 全量取（不短路）：实时路径只服务小钱包（高频钱包离线表已覆盖）；增量路径窗口= step4 间隔（ticks 少）。
   * @param {string} sinceIso 起始 block_time（实时路径=asOf-lookback；增量路径=data_through）
   * @param {string} asOfIso 截止 block_time（exclusive，防泄漏）
   * @returns {Promise<Array>} ticks
   */
  async _fetchWalletTicks(supabase, address, sinceIso, asOfIso) {
    const COLS = 'id,token_address,bnb_amount,price_usd,trade_type,block_time,block_number';
    const rows = [];
    let lastId = 0; // ★wss_price_ticks.id 是 BIGINT IDENTITY；id asc 数字游标分页（首页 .gt('id',0) 返回全部）
    let guard = 0;
    while (guard++ < 200) {
      const page = await supabase
        .from('wss_price_ticks')
        .select(COLS)
        .eq('trader_address', address)
        .gt('block_time', sinceIso)
        .lt('block_time', asOfIso)
        .gt('id', lastId)
        .order('id', { ascending: true })
        .limit(1000);
      // ★查询失败显式 throw（母版 2026-09-02 教训照搬）：静默吞错会把超时/网络错误当成"窗口内 0 笔"
      //   → noTicks → 该钱包无分。throw 让上层可区分"查询失败"与"真无 ticks"（暴露问题勿遮蔽）。
      if (page.error) throw new Error(`fetchWalletTicks 失败 ${address.slice(0, 10)}: ${page.error.message}`);
      const data = page.data || [];
      if (data.length === 0) break;
      for (const r of data) rows.push(r);
      lastId = data[data.length - 1].id;
      if (data.length < 1000) break; // 取完
    }
    return rows;
  }

  /**
   * 批量查 wallet_offline_profiles（address IN，batch 100 防 URL 超长）。
   * 替代 per-holder 串行 _fetchOfflineProfile PK 查询（_analyze 多 holder 场景）。
   * @returns {Promise<Map<string,{dataThroughMs:number,dataThroughIso:string,profile:Object}>>}
   */
  async _fetchOfflineProfileBatch(supabase, addresses) {
    const _t0 = this._prof ? Date.now() : 0;
    const map = new Map();
    // 预加载（_offlineProfilePreloaded 已填充）→ 内存读子集，零 round-trip；web（null）→ 下方 IN100 fallback DB
    if (this._offlineProfilePreloaded) {
      for (const a of addresses) {
        const v = this._offlineProfilePreloaded.get(a);
        if (v) map.set(a, v);
      }
      if (this._prof) this._profTock('fetchOffline', _t0);
      return map;
    }
    for (let i = 0; i < addresses.length; i += 100) {
      const batch = addresses.slice(i, i + 100);
      const { data, error } = await supabase.from('wallet_offline_profiles')
        .select('address,data_through,profile').in('address', batch);
      if (error) { log('warn', `_fetchOfflineProfileBatch batch ${i} 失败`, { error: error.message }); continue; }
      for (const r of (data || [])) {
        if (r && r.profile) {
          map.set(r.address, {
            dataThroughMs: new Date(r.data_through).getTime(),
            dataThroughIso: r.data_through,
            profile: r.profile,
          });
        }
      }
    }
    if (this._prof) this._profTock('fetchOffline', _t0);
    return map;
  }

  /**
   * 批量 id 游标分页取多钱包 ticks（trader_address IN + block_time 窗口，batch 100 防 URL 超长）。
   * 替代 per-holder 串行 _fetchWalletTicks（_analyze 多 holder 场景）：N 次往返 → ⌈N/100⌉ × 页数。
   * 返回按 trader_address 分组的 ticks（COLS 含 trader_address 供分组）。
   * @returns {Promise<Map<string,Array>>} address → ticks[]
   */
  async _fetchWalletTicksBatch(supabase, addresses, sinceIso, asOfIso) {
    const _t0 = this._prof ? Date.now() : 0;
    // 注入索引命中 → 内存读零 DB round-trip（仅回测：setHistoricalTicks 注入本实验全量 ticks）。
    //   live 不缓冲（架构性偏离 #1）→ DB 直查 as-of 窗口（watcher 落库全局流，永远完整）。
    if (this._walletTicksPreloaded) {
      const byAddr = new Map();
      const sinceMs = new Date(sinceIso).getTime();
      const asOfMs = new Date(asOfIso).getTime();
      for (const a of addresses) {
        const all = this._walletTicksPreloaded.get(a);
        if (a === process.env.DBG_WALLET) {
          const f0 = all ? all.filter(t => { const ms = new Date(t.block_time).getTime(); return ms > sinceMs && ms < asOfMs; }) : null;
          console.error(`[DBG_FETCHTICKS] ${a.slice(0, 10)} window(${sinceIso} → ${asOfIso}) preloaded.all=${all ? all.length : 0} filtered=${f0 ? f0.length : 0}`);
        }
        if (all) {
          const f = all.filter(t => { const ms = new Date(t.block_time).getTime(); return ms > sinceMs && ms < asOfMs; });
          if (f.length) byAddr.set(a, f); // mimic DB：仅非空 set（与 DB 路径 byAddr 行为一致）
        }
      }
      if (this._prof) this._profTock('fetchTicks', _t0);
      return byAddr;
    }
    const COLS = 'id,trader_address,token_address,bnb_amount,price_usd,trade_type,block_time,block_number';
    const byAddr = new Map();
    for (let i = 0; i < addresses.length; i += 100) {
      const batch = addresses.slice(i, i + 100);
      let lastId = 0; let guard = 0;
      while (guard++ < 200) {
        const page = await supabase.from('wss_price_ticks').select(COLS)
          .in('trader_address', batch)
          .gt('block_time', sinceIso).lt('block_time', asOfIso)
          .gt('id', lastId).order('id', { ascending: true }).limit(1000);
        // 查询失败显式 throw（同 _fetchWalletTicks：吞错会把超时伪装成"窗口内 0 笔"）
        if (page.error) throw new Error(`fetchWalletTicksBatch 失败 batch@${lastId}: ${page.error.message}`);
        const data = page.data || [];
        if (data.length === 0) break;
        for (const r of data) {
          let arr = byAddr.get(r.trader_address);
          if (!arr) { arr = []; byAddr.set(r.trader_address, arr); }
          arr.push(r);
        }
        lastId = data[data.length - 1].id;
        if (data.length < 1000) break; // 取完
      }
    }
    if (this._prof) this._profTock('fetchTicks', _t0);
    return byAddr;
  }

  /**
   * 批量算多 holder 的 as-of 画像（_analyze 专用，替代串行 _computeWalletProfile 循环）。
   * 编排：cache 过滤 → 批量 offline（IN）→ 分离 fresh/stale/miss → 分组批量拉 ticks（IN+block_time+id 分页）
   *   → 预热 token_profiles 缓存 → 逐个 buildProfileFromTicks/mergeOfflineProfile（CPU 无 DB）→ pack + 回填 cache。
   * 三路径语义与 _fetchAndBuildProfile 一致：
   *   fresh(asOf≤data_through 直用 offline，回测常态，零 tick 查询) /
   *   stale(asOf>data_through 增量 merge，[data_through,asOf]) /
   *   miss(无 offline，realtime 全量 [asOf-lookback,asOf])。
   * web 单 holder 路径继续用 _computeWalletProfile（不变）。
   * @param {Array<{address:string,net:number}>} holders 已 top-N 截断
   * @returns {Promise<Array<Object>>} walletProfiles（按 holders 顺序；含 address/netTokens + _packProfile 字段）
   */
  async _computeWalletProfilesBatch(holders, asOfTime) {
    const supabase = this._getClient();
    const results = new Array(holders.length);

    // a. _walletProfileCache 过滤（同 _computeWalletProfile：cacheKey=address，TTL=cacheTtlMs）
    const uncachedIdx = [];
    for (let i = 0; i < holders.length; i++) {
      const h = holders[i];
      const cached = this._walletProfileCache.get(h.address);
      if (cached && (asOfTime - cached.ts) < this._cacheTtlMs) {
        results[i] = { ...cached.profile, address: h.address, netTokens: h.net };
        if (this._prof) this._prof.cacheHit++;
      } else {
        uncachedIdx.push(i);
        if (this._prof) this._prof.cacheMiss++;
      }
    }
    if (!uncachedIdx.length) return results;

    const uncachedAddrs = uncachedIdx.map(i => holders[i].address);

    // b. 批量 offline（IN，一次拿回所有 hit profile）
    const offlineMap = await this._fetchOfflineProfileBatch(supabase, uncachedAddrs);

    // c. 分类 fresh(stale)/miss
    const missAddrs = [];
    const staleEntries = []; // { addr, off }
    const freshMap = new Map();
    for (const i of uncachedIdx) {
      const addr = holders[i].address;
      const off = offlineMap.get(addr);
      if (!off) missAddrs.push(addr);
      else if (asOfTime <= off.dataThroughMs) freshMap.set(addr, off);
      else staleEntries.push({ addr, off });
    }
    const staleAddrSet = new Set(staleEntries.map(s => s.addr));
    if (this._prof) { this._prof.fresh += freshMap.size; this._prof.stale += staleEntries.length; this._prof.miss += missAddrs.length; }

    // d. 批量拉 ticks（miss 全量 + stale 增量 并发：两者地址集互斥独立，Promise.all 减串行等待）。
    //    supabase-js 走 PostgREST over HTTPS，每查询独立 HTTP 请求，2 路并发无连接池问题。
    const asOfIso = new Date(asOfTime).toISOString();
    const lookbackIso = new Date(asOfTime - this._profileLookbackDays * 86400000).toISOString();

    // d1. miss 全量 [asOf-lookback, asOf]；d2. stale 增量 [min(data_through), asOf] 内存按各 data_through 截取
    //    （取 min(data_through) 统一拉；多 holder data_through 差异越大浪费越多，但增量本身量小）
    const [missTicksMap, staleTicksMap] = await Promise.all([
      missAddrs.length
        ? this._fetchWalletTicksBatch(supabase, missAddrs, lookbackIso, asOfIso)
        : Promise.resolve(new Map()),
      (async () => {
        if (!staleEntries.length) return new Map();
        const staleAddrs = staleEntries.map(s => s.addr);
        const minThroughMs = Math.min(...staleEntries.map(s => s.off.dataThroughMs));
        const rawTicksMap = await this._fetchWalletTicksBatch(supabase, staleAddrs, new Date(minThroughMs).toISOString(), asOfIso);
        const throughByAddr = new Map(staleEntries.map(s => [s.addr, s.off.dataThroughMs]));
        const m = new Map();
        for (const [addr, ticks] of rawTicksMap) {
          const dtMs = throughByAddr.get(addr);
          m.set(addr, dtMs ? ticks.filter(t => new Date(t.block_time).getTime() > dtMs) : ticks);
        }
        return m;
      })(),
    ]);

    // e. 预热 token_profiles 缓存（所有 ticks 涉及 token 一次 _fetchTokenProfiles，后续逐个 build 缓存命中零查询）
    const allTickTokens = new Set();
    for (const ticks of missTicksMap.values()) for (const t of ticks) if (t.token_address) allTickTokens.add(t.token_address);
    for (const ticks of staleTicksMap.values()) for (const t of ticks) if (t.token_address) allTickTokens.add(t.token_address);
    if (allTickTokens.size) await this._fetchTokenProfiles([...allTickTokens], supabase);

    // f. 逐个 build（CPU 无 DB）+ pack + 回填 cache
    for (const i of uncachedIdx) {
      const addr = holders[i].address;
      const runtime = {};

      let built;
      const fresh = freshMap.get(addr);
      if (fresh) {
        built = fresh.profile;
        runtime.source = 'offline'; runtime.dataThroughMs = fresh.dataThroughMs;
        if (addr === process.env.DBG_WALLET) console.error(`[DBG_BUILD_FRESH] ${addr.slice(0, 10)} dataThrough=${new Date(fresh.dataThroughMs).toISOString()} (不取 inc!) offline.bad14d=${fresh.profile.badCount14d}`);
      } else if (staleAddrSet.has(addr)) {
        const off = offlineMap.get(addr);
        const incTicks = staleTicksMap.get(addr) || [];
        const inc = await this._buildProfileFromTicks(incTicks, supabase, asOfTime, { cachedOnly: true });
        built = mergeOfflineProfile(off.profile, inc);
        if (this._lowLevelBadAction && this._lowLevelBadAction.enabled !== false) {
          built.lowLevelBadAction = mergeLowLevelBadAction(off.profile.lowLevelBadAction, inc.lowLevelBadAction);
        }
        // good-action 独立 merge（batch 路径）
        if (this._goodAction && this._goodAction.enabled !== false) {
          built.goodAction = mergeGoodAction(off.profile.goodAction, inc.goodAction);
        }
        // tiny-level bad_action 独立 merge（batch 路径）
        if (this._tinyLevelBadAction && this._tinyLevelBadAction.enabled !== false) {
          built.tinyLevelBadAction = mergeTinyLevelBadAction(off.profile.tinyLevelBadAction, inc.tinyLevelBadAction);
        }
        runtime.source = 'offline+inc'; runtime.dataThroughMs = off.dataThroughMs;
        if (addr === process.env.DBG_WALLET) {
          console.error(`[DBG_BUILD_STALE] ${addr.slice(0, 10)} dataThrough=${new Date(off.dataThroughMs).toISOString()} incTicks=${incTicks.length} | inc: bad14d=${inc.badCount14d} badBuy=${inc.earlyLargeBuyCount} badSell=${inc.crashLargeSellCount} rawTotal=${inc.rawTotal} | offline.bad14d=${off.profile.badCount14d} | merged.bad14d=${built.badCount14d} badAction=${built.badAction}`);
        }
      } else {
        // miss → realtime 全量
        const ticks = missTicksMap.get(addr) || [];
        built = await this._buildProfileFromTicks(ticks, supabase, asOfTime, { cachedOnly: true });
        runtime.source = 'realtime';
        if (addr === process.env.DBG_WALLET) console.error(`[DBG_BUILD_MISS] ${addr.slice(0, 10)} realtime ticks=${ticks.length} bad14d=${built.badCount14d} badAction=${built.badAction}`);
      }

      const profile = this._packProfile(built, runtime);
      this._walletProfileCache.set(addr, { ts: asOfTime, profile });
      results[i] = { ...profile, address: addr, netTokens: holders[i].net };
    }

    // cache 无界增长保护（同 _computeWalletProfile）
    if (this._walletProfileCache.size > 200000) this._walletProfileCache.clear();
    return results;
  }

  /**
   * 从钱包 as-of ticks 算完整 profile（薄壳）：批量查 token_profiles → 调共享 buildProfileFromTicks。
   * 算法（rawTotal/金额桶/bad_action/持仓时间）在 ./wallet-profile-builder，实时/离线/增量合并共用。
   * @param {Array} ticks wss_price_ticks 行
   * @param {Object} supabase supabase client
   * @param {number} asOfMs 评估时间戳(ms)；badAction24h 用 asOfMs-24h 作 recentSince（null → 不算 24h 布尔）
   * @returns {Object} profile（camelCase；统计量 + 持仓时间；无 perToken）
   */
  async _buildProfileFromTicks(ticks, supabase, asOfMs, { cachedOnly = false } = {}) {
    const tokens = [...new Set((ticks || []).map(t => t.token_address).filter(Boolean))];
    // cachedOnly=true：_computeWalletProfilesBatch 路径专用。该路径已用 allTickTokens（miss/stale holder
    //   的 token 并集）预热 _tokenProfileCache，而本 holder ticks 的 tokens ⊆ allTickTokens（同
    //   missTicksMap/staleTicksMap 来源），故直读 cache 与 _fetchTokenProfiles 返回值逐 key 一致
    //   （含 miss 写 null 防重查），口径零影响；省去 per-holder 函数调用/DB 补查开销。
    //   web 单 holder 路径无预热，默认 cachedOnly=false 走原 _fetchTokenProfiles。
    let tokenProfiles;
    if (cachedOnly) {
      tokenProfiles = new Map();
      for (const a of tokens) tokenProfiles.set(a, this._tokenProfileCache.get(a) || null);
    } else {
      tokenProfiles = await this._fetchTokenProfiles(tokens, supabase);
    }
    // ★对齐实盘（_alignClassifiedAsOf，仅回测 BacktestEngine=true）：分类可见时刻 > asOf 的 token 视为
    //   未分类 → null。根因：bad_buy 窗口 age∈[0,3s)，但 token 分类需 idle 后才能算 category（maxMC/
    //   drawdown/flashCrash 都要代币跑完才知）。回测 _tokenProfileCache 预加载含【事后分类】→
    //   buildProfileFromTicks 算出 bad_action → 实盘决策时根本拿不到（物理矛盾）= look-ahead。
    //   可见时刻优先 category_visible_at（firstIdle 口径：实时 OPB 首次触发分类的时间点，分类时落库、
    //   离线重写保最早）——回答"实盘 asOf 时真能读到该 category 吗"。
    //   null 后 builder bad_action 循环 if(!prof)continue → 未分类 token 上的买入/抛售不计 bad_action。
    //   实盘 asOf=now，已分类 token 可见时刻<now 自然保留；web 默认 false 不过滤 → 零影响。
    if (this._alignClassifiedAsOf && asOfMs) {
      for (const [a, p] of tokenProfiles) {
        if (!p) continue;
        // 优先 category_visible_at（firstIdle 口径）；老数据无此字段回退 classified_at
        const visMs = p.categoryVisibleAtMs ?? p.classifiedAtMs;
        if (visMs != null && visMs > asOfMs) tokenProfiles.set(a, null);
      }
    }
    const largeTradeBnb = (this._walletScoreParams && this._walletScoreParams.largeTradeBnb != null)
      ? this._walletScoreParams.largeTradeBnb : 1.0; // 默认对齐 BAD_BUY_BNB（保证 badCount ⊆ largeCount）
    const profile = buildProfileFromTicks(ticks, tokenProfiles, { largeTradeBnb, asOfMs });
    // low-level bad_action 独立特性（纯观察）：若 enabled 调独立 compute 挂到 profile.lowLevelBadAction
    if (this._lowLevelBadAction && this._lowLevelBadAction.enabled !== false) {
      profile.lowLevelBadAction = computeLowLevelBadAction(ticks, tokenProfiles, this._lowLevelBadAction);
    }
    // good-action 独立特性（纯观察）：若 enabled 调独立 compute 挂到 profile.goodAction
    if (this._goodAction && this._goodAction.enabled !== false) {
      profile.goodAction = computeGoodAction(ticks, tokenProfiles, this._goodAction);
    }
    // tiny-level bad_action 独立特性：若 enabled 调独立 compute 挂到 profile.tinyLevelBadAction
    if (this._tinyLevelBadAction && this._tinyLevelBadAction.enabled !== false) {
      profile.tinyLevelBadAction = computeTinyLevelBadAction(ticks, tokenProfiles, this._tinyLevelBadAction);
    }
    return profile;
  }

  /**
   * token_profiles DB 行原始形状（category 顶层列 + profile JSONB snake_case）→ 内部缓存形状（camelCase）。
   * 单一源：_queryTokenProfileChunk（DB 读回）与 upsertTokenProfileCache（OPB 在线分类喂入）共用，
   * 保证两条写入路径形状严格一致。r 为空返回 null（miss 语义）。
   * first_tick_time 落库为 ISO 字符串（TIMESTAMPTZ 惯例，build-token-profiles.cjs / OPB 写入）→
   *   此处归一 ms（builder 与 buy.bt 数字比较口径）；flash_crash_period 的 peakTime/floorTime 是
   *   token-classifier 产的 ms 数字，原样透传。
   */
  _normalizeTokenProfile(r) {
    if (!r) return null;
    const p = (r.profile && typeof r.profile === 'object') ? r.profile : {};
    const ftRaw = p.first_tick_time;
    return {
      category: r.category || p.category || null,
      flashCrashPeriod: p.flash_crash_period || null, // {peakTime,peakPrice,floorTime,floorPrice}（ms 数字）
      violentCrashBlocks: p.violent_crash_blocks || [], // Tier2 暴力集中抛售 block（number[]；分类时算）
      firstTickTime: ftRaw != null ? (typeof ftRaw === 'string' ? Date.parse(ftRaw) : ftRaw) : null,
      classifiedAtMs: (r.classified_at || p.classified_at) ? Date.parse(r.classified_at || p.classified_at) : null, // 分类时刻（老 token 无 category_visible_at 时的回退过滤基准）
      categoryVisibleAtMs: (r.category_visible_at || p.category_visible_at) ? Date.parse(r.category_visible_at || p.category_visible_at) : null, // ★分类可见时刻（firstIdle 口径，_alignClassifiedAsOf 优先用）
    };
  }

  /**
   * 单 chunk（≤100 token，防 .in() URL 超长）查 token_profiles 表（token_address 全局 PK，每 token 一行）。
   * ⚠️ batch=100 非 500：.in('token_address', batch) 地址 URL 超 nginx 限制会 fetch failed 静默返空 →
   *   token 分类全读成 null → firstTickTime/flashCrashPeriod/category 全缺 → 评分靶向率
   *   (earlyLargeBuy/crashLargeSell) 全 0 → 豁免满分（母版 FEZ7 案实证）。此处对齐 100。
   * 返回 Map(addr→token_profiles DB 行)；查询失败返回 null（区别于空 Map=查到全 miss，调用方自决失败时是否写 cache）。
   * _fetchTokenProfiles（运行期按需）与 preloadTokenProfiles（启动预载）共用。
   */
  async _queryTokenProfileChunk(batch, supabase) {
    const { data, error } = await supabase.from('token_profiles')
      .select('token_address,category,profile,classified_at,category_visible_at')
      .in('token_address', batch);
    if (error) {
      log('warn', `token_profiles 批量查询失败（${batch.length} token）: ${error.message}`);
      return null;
    }
    const resolved = new Map();
    for (const r of (data || [])) {
      if (r && !resolved.has(r.token_address)) resolved.set(r.token_address, r); // PK 唯一行
    }
    return resolved;
  }

  /**
   * 批量查 token_profiles → { category, flashCrashPeriod, firstTickTime }。
   * token 分类属性（category/闪崩段/t0）客观稳定，缓存不过期（同实验跨 holder / 跨盘共享，命中率高）。
   * 缓存 miss（token 无行，如未分类的新 token）写 null 防重查。
   */
  async _fetchTokenProfiles(tokenAddrs, supabase) {
    const _t0 = this._prof ? Date.now() : 0;
    const missing = tokenAddrs.filter(a => !this._tokenProfileCache.has(a));
    if (missing.length) {
      for (let i = 0; i < missing.length; i += 100) {
        const batch = missing.slice(i, i + 100);
        // 查询失败（null）按原语义与全 miss 同途：整批写 null 防重查（fail-closed 缓存，行为与母版一致）。
        const resolved = (await this._queryTokenProfileChunk(batch, supabase)) || new Map();
        for (const a of batch) {
          // 无行（未分类新 token）→ _normalizeTokenProfile(null)=null 防重查
          this._tokenProfileCache.set(a, this._normalizeTokenProfile(resolved.get(a) || null));
        }
      }
    }
    const map = new Map();
    for (const a of tokenAddrs) map.set(a, this._tokenProfileCache.get(a) || null);
    if (this._prof) this._profTock('fetchTokenProfiles', _t0);
    return map;
  }

  // ── floatTotal：topHolders netTokens 之和，供 floatPct 归一化（评分集中度/落表明细用）──
  _computeFloatStats(holders) {
    let floatTotal = 0;
    for (const { net } of holders) floatTotal += net;
    return floatTotal;
  }

  _buildHoldingFactors(faState) {
    // 低流通降权信号（applyLowFloatPenalty 消费；持久化供 web decision 读）：
    //   walletHoldingPct=代币从池子流入钱包占比 %（Σ(买−卖)token / totalSupply ×100，全量无 skip）。
    //   分母 totalSupply（four.meme=TokenCreate d[5] / flap=1e9 固定，FA.registerToken 回填）；
    //   缺失(=0) → null fail-closed（架构性偏离 #2：FA 偏离 #1 先例，替母版常数 1e9 分母）。
    //   庄散加权分/占比由 _analyze 在评分后注入（computeZhuangRetail 附属输出），此处不产。
    const supply = faState.totalSupply || 0;
    const netTokens = (faState.totalBuyTokens || 0) - (faState.totalSellTokens || 0);
    return {
      TPAPre_walletHoldingPct: supply > 0 ? Number(((netTokens) / supply * 100).toFixed(2)) : null,
    };
  }

  // ── verdict（评分体系收口后唯一路径）：approve = zhuangCondition 对
  //    { tokenScore, zhuangRetailRatio, 庄散加权分 } 求值为 true。
  //    tokenScore/zhuangRetailRatio 为 null（无数据）→ 比较返回 false → fail-closed block。retail=0 → ratio=∞。
  _decideVerdict(scoreSummary, zhuangRetail, holdingFactors) {
    const tokenScore = scoreSummary?.totalScore ?? null;
    // zhuangRetailRatio = (庄+新钱包)/散户（单一真相源 computeZhuangRetailRatio，与 _analyze 注入
    //   holdingFactors 同源）。retail=0 → ∞（庄+新绝对主导，视为满足）；无庄散数据 → null。
    const zhuangRetailRatio = computeZhuangRetailRatio(zhuangRetail);
    const factors = {
      TPAPre_tokenScore: tokenScore, TPAPre_zhuangRetailRatio: zhuangRetailRatio,
      // 庄散加权分（与 _analyze 注入 holdingFactors 的字段对称，供 zhuangCondition 引用）
      TPAPre_zhuangScore: zhuangRetail?.zhuangScore ?? null,
      TPAPre_retailScore: zhuangRetail?.retailScore ?? null,
      TPAPre_newWalletScore: zhuangRetail?.newWalletScore ?? null,
      TPAPre_neutralScore: zhuangRetail?.neutralScore ?? null,
      TPAPre_minZR: zhuangRetail?.minZR ?? null,
      TPAPre_gapZR: zhuangRetail?.gapZR ?? null,
      // TPAPre_walletHoldingPct（池子净吸收进度 %）：可选 verdict 操作数，默认 condition 不引用。
      TPAPre_walletHoldingPct: holdingFactors?.TPAPre_walletHoldingPct ?? null,
    };
    const { ev, ast } = this._zhuang;
    if (ev.evaluate(ast, factors)) return { verdict: 'approve', blockReasons: [] };
    const failed = ev._extractLeafConditions(ast)
      .filter(node => !ev._evaluateComparison(node, factors))
      .map(node => this._formatFailedLeaf(node, ev, factors));
    return { verdict: 'block', blockReasons: failed.length ? failed : ['zhuangCondition 未满足'] };
  }

  /** 解析+校验条件表达式，返回 { ev, ast }。fail-fast：非法表达式/未知因子 → 抛错（构造期暴露配置问题）。 */
  _compileCondition(conditionStr, allowedFactors, fieldName) {
    const ev = new ConditionEvaluator();
    let ast;
    try {
      ast = ev.parseCondition(conditionStr);
    } catch (e) {
      throw new Error(`TokenPositionAnalyzer ${fieldName} 解析失败: "${conditionStr}" → ${e.message}`);
    }
    const { valid, errors } = ev.validateCondition(ast, new Set(allowedFactors));
    if (!valid) {
      throw new Error(`TokenPositionAnalyzer ${fieldName} 校验失败: "${conditionStr}" → ${errors.join('; ')}（可用因子: ${allowedFactors.join(', ')}）`);
    }
    return { ev, ast };
  }

  /** 把一个失败的叶子比较节点格式化为人类可读原因：`factor op thresh（实际 value）`。 */
  _formatFailedLeaf(node, ev, factors) {
    const actual = ev._getOperandValue(node.left, factors);
    let disp;
    if (actual == null) disp = 'null';
    else if (typeof actual === 'number' && !isFinite(actual)) disp = actual > 0 ? '∞' : '-∞';
    else if (typeof actual === 'number') disp = Number(actual.toFixed(2));
    else disp = actual;
    return `${node.left} ${node.operator} ${node.right}（实际 ${disp}）`;
  }

  // ── 落表 ──
  async _persist(tokenAddress, asOfTime, snapshot, verdict, blockReasons, holdingFactors) {
    if (!this._experimentId) return; // 无 experiment_id（如引擎未注入）则只内存缓存
    try {
      const row = {
        experiment_id: this._experimentId,
        token_address: tokenAddress,
        trigger_no: 1, // 触发时刻首次分析（TPAPre_）
        as_of: new Date(asOfTime).toISOString(),
        trigger_snapshot: snapshot,
        verdict,
        block_reasons: blockReasons,
        holding_factors: holdingFactors,
        // wallet_profiles/wallet_score_summary 不落表（对齐母版现行：TPA 只落检测结果一串，钱包明细/
        //   聚合分不存。计算管线全保留——totalScore 即决策因子 TPAPre_tokenScore，数值在
        //   holding_factors.TPAPre_tokenScore 有镜像，下游改读镜像）。
        enforce: !!this._enforce,
      };
      // 落表接管：回测注入 persistSink（BacktestWriteBuffer 攒批，flush 时同 onConflict 批量 upsert）。
      //   决策路径不依赖落表（verdict/setHoldingFactors 在 _persist 前已内存生效），仅写库时机后移；
      //   分支置于 _getClient 之前，sink 路径全程零 DB 触碰。
      if (this._persistSink) {
        this._persistSink(row);
        return;
      }
      // upsert(onConflict 三列)：--force 重启清 trades/signals 但不清本表，旧 shadow 记录残留致
      // (experiment_id,token_address,trigger_no) duplicate key warn。改 upsert 覆盖（--force 后重算覆盖合理）。
      const supabase = this._getClient();
      const { error } = await supabase.from('token_position_analyses')
        .upsert(row, { onConflict: 'experiment_id,token_address,trigger_no' });
      if (error) log('warn', `落表失败 ${tokenAddress.slice(0, 12)}…`, { error: error.message });
    } catch (err) {
      log('warn', `落表异常 ${tokenAddress.slice(0, 12)}…`, { error: err.message });
    }
  }

  /**
   * 钱包评分（独立维度）：对每个 holder profile 调 WalletScorer 算 score，按 floatPct 加权累加代币总评分。
   * 委托 wallet-scorer.scoreTokenFromHolders（评分逻辑唯一真相源；TPA/web/分析脚本共用，根治分叉）。
   * ⚠️ 隔离不变量：严禁写 holding_factors / 调 setHoldingFactors / 入 _decideVerdict（由 _analyze 统一编排）。
   * @param {Array} walletProfiles _computeWalletProfile 产出（已补 floatPct）
   * @returns {Object} walletScoreSummary
   */
  _computeWalletScores(walletProfiles, holdingFactors) {
    // ★scorer 入参键映射：holdingFactors 已改 TPAPre_ 前缀，scorer 公共接口仍期望 walletHoldingPct
    //   （web/分析脚本共用 scorer，不改其入参键），在此单点映射。
    return scoreTokenFromHolders(walletProfiles, { walletHoldingPct: holdingFactors?.TPAPre_walletHoldingPct }, this._walletScore, this._walletScoreParams);
  }

  _getClient() {
    const { dbManager } = require('./dbManager');
    return dbManager.getClient();
  }

  destroy() {
    this._analyzed.clear();
    this._verdictCache.clear();
    this._walletProfileCache.clear();
    this._enabled = false;
  }
}

module.exports = {
  TokenPositionAnalyzer,
  HOLDING_FACTOR_KEYS,
  DEFAULT_CONFIG,
  mergeConfig,
  TRIGGER_NOT_USED,
  zhuangScoreGatesToCondition,
};
