/**
 * 交易信号页面JavaScript
 * 实现K线图展示和交易信号标记
 * Version: 4.0 - 添加拒绝信号标记和统计
 */

// 叙事分类映射（token_narrative.token_category；语义对齐 jev-questions
// event_category 题集，与 token-returns 页同款）
const NARRATIVE_CATEGORY_MAP = {
  'event:A': { label: '形象IP', title: 'A · 形象 IP：meme 角色/吉祥物/虚拟形象/卡通 IP/表情包角色' },
  'event:B': { label: '产品', title: 'B · 非 Web3 产品：app/游戏/硬件/网站/消费品发布或更新' },
  'event:C': { label: '个人', title: 'C · 个人声明：个人身份发言（非机构官方口径）' },
  'event:D': { label: '机构', title: 'D · 机构行动：公司/组织官方账号公告或行动' },
  'event:E': { label: '热点', title: 'E · 社会热点：正在平台传播的趋势/病毒内容/热梗' },
  'event:F': { label: '发现', title: 'F · 发现：作者原创的隐藏模式/数据洞察/叙事发现' },
  'event:G': { label: '预测', title: 'G · 预测：未来事件预测（有推理但证据不足）' },
  'event:W': { label: 'Web3', title: 'W · Web3 项目：区块链/加密产品发布或更新' },
  'project':              { label: '项目', title: 'prestage · 项目币/发行方自发' },
  'account_based_meme':   { label: '账号型', title: 'prestage · 账号型 meme（账号/社区 token）' },
  'web3_native_ip_early': { label: '原生IP', title: 'prestage · Web3 原生 IP 早期' },
  'super_ip_fast':        { label: '快车道', title: '已废弃 · superIP 快车道（C83 前旧行）' },
};

// T117 门链明细展示（2026-11-07）：cheat 16 题中文标签 + 门链拒因映射 + 档位配色
const CHEAT_QUESTION_LABELS = {
  equalAmountSplit: '等额拆单', coordinatedSellBack: '协同卖回', creatorFrontRun: '创建者抢跑',
  sellDispersion: '卖出分散', stallBurstWave: '停滞突发波', amountTiering: '金额分层',
  sameBlockBuyWave: '同块购买波', insiderSupplySell: '内部筹码卖出', slowGrindPump: '机器缓推',
  washPair: '对倒配对', holdingsBalance: '持仓失衡', burstSpikeConcentration: '尖刺集中',
  strongBackerPressure: '强庄压力', activityLevel: '活跃度', bundledDominance: '捆绑交易主导',
  abnormalBehavior: '异常行为占比',
};
const GATE_REASON_LABELS = {
  cheat_gate_cheat: '作弊门拉黑拒（cheat 终态：拉黑+清仓联动，该代币后续买信号全部短路拒）',
  cheat_gate_unhealthy: '作弊门 unhealthy 拒（G17 通道触发；cheatRecheck 腿下个买信号自动重判）',
  bp_gate_assessment: 'BP 门判定拒（点位评估 poor，不在放行档 good/neutral）',
  bp_gate_insufficient_ticks: 'BP 门锚窗 tick 不足拒（数据不足=挡住，BP10 翻案 2026-11-07）',
};
// T143 因子购买前检查门拒因映射（factor_gate_<code> 动态后缀——前缀匹配；
// FP1 纯代码零 Jev，判定树=judgeRetailPvp 三步+CD 四臂升格门）
const FACTOR_GATE_REASON_LABELS = [
  [/^factor_gate_pvp_no_big_participation$/, '散户 PVP——无大户参与（买入过的 0.2 级单笔钱包 <2 且无 0.29+（0.3 视同）单笔；BP84 追裁定「只要买入过即可，不要求在场」）'],
  [/^factor_gate_pvp_absorption_dust$/, '散户 PVP——大户持续卖且承接不在场（向小散出货无人接；承接=win30 买 ≥3 笔 ∧ ≥0.1 BNB）'],
  [/^factor_gate_pvp_zero_absorption$/, '散户 PVP——承接归零（在场持有但买方归零/仅尘埃=对倒停摆死盘）'],
  [/^factor_gate_cd400_dump_no_absorption$/, 'CD400 贴锚砸块零承接（锚窗末 ≤60s 达标砸块 ≥4 独立卖方 ≥0.5 BNB 且块后承接 <0.05 BNB）'],
  [/^factor_gate_cd403_dump_low_absorption$/, 'CD403 超大量捆绑砸盘承接比（达标砸块卖方 ≥8 且承接比 <0.3=承接一成上下）'],
  [/^factor_gate_cd401_burst_exit_sell_pressure$/, 'CD401 burst 出口段卖压（流量簇卖占比 ≥30% ∧ 卖额 ≥0.3 BNB；sbw 机械化代理线）'],
  [/^factor_gate_cd405_burst_bundled_wave$/, 'CD405 burst 捆绑收割（波窗单块或相邻两 slot 去尘捆绑钱包 ≥7）'],
];
// G17 触发通道码中文映射（拒因块具体原因——前缀匹配吸收动态后缀：L_insider_sell25 /
// N_no_retail_entry9.8 / A_strong:xxx；2026-11-07 用户要求拒因给具体原因）
const CHEAT_CODE_LABELS = [
  [/^A_strong:/, 'A 主判题 strong（九主判任一 strong 即 cheat）'],
  [/^A_downgrade_single_pump_burst/, 'A 降级豁免未达（唯一 pump strong 且 burst 波不弱）'],
  [/^D_famous_dominance/, 'D 跟单集中控盘（famous dom=high ∧ 跟单 top3/集团买过线）'],
  [/^D_famous_near_band/, 'D 邻界联立（跟单 top3≥35 ∧ 集团买≥70 双贴线）'],
  [/^E_low_activity_weak_burst/, 'E 活跃度低·弱 burst（三键全中不豁免）'],
  [/^E_low_activity/, 'E 活跃度低（act=low 且非强 burst）'],
  [/^J_holdings_strong/, 'J 持仓分布失衡 strong（拒买级非拉黑级）'],
  [/^L_insider_sell/, 'L 内部人卖出联立（insider≥moderate ∧ 零买纯卖≥25%）'],
  [/^R_abnormal_dominant/, 'R 异常行为占比 dominant（整体形状通道）'],
  [/^M_hyper_activity/, 'M 活跃度 ultra（机器盘级极端密集，拒买级）'],
  [/^N_no_retail_entry/, 'N 无散户入场（聚合路由入口占比 <10%，拒买级）'],
];
const BP_DIMENSION_LABELS = {
  market_heat: '市场热度',
  market_pattern: '盘面类型', entry_shape: '点位性质',
  holder_concentration: '持仓集中度',
  // entry_position/famous_domination 已随维度题退役（BP49）——仅历史 signal 行
  // （metadata.dimensions 带旧维度）展示用，新行无该两键
  entry_position: '入场位置', famous_domination: '跟单控盘',
};
// price_level（价格位置）/price_trend（价格趋势）已随 BP60/BP76 退役（纯参考零
// 消费维度题）——展示删除（历史行带答案不再渲染，2026-11-15 用户指令「几个
// 维度已经不用可以删除」）；维度过滤集：
const BP_DIMENSION_HIDDEN = new Set(['price_level', 'price_trend', 'activity_level']);
// 盘型门硬拒桶（与 mapper PATTERN_GATE_POOR_BUCKETS 同源；②retail_pvp 已迁代码
// 因子门不在 Jev 域）——market_pattern 落硬拒桶=「不符合通过要求的盘面类型」
// 标红展示（2026-11-15 用户指令）
const BP_MARKET_PATTERN_POOR_BUCKETS = new Set(['famous_monopoly', 'one_wave_dump']);
const BP_QUALITY_LABELS = { early_bird: '早鸟题', pullback_entry: '回调题' }; // BP48 两质量题退役——仅历史 signal 行（metadata 带 qualities）展示用，新行无该段
// T241 门链因子代（Jev 退役，2026-11-25 用户裁定）：AF2（活跃度，并入②因子检查层）/ CF1（③作弊）/ BPF3（④BP）
// 的结论由 factor-responders 产出、零 Jev；service 返回 model='factor@<版本>'（Jev 代
// metadata 无 model 键）——三代各自独立识别，历史 Jev 代行照旧按原文案渲染。
// T243b（2026-11-26 用户指令「就不必再展示 活跃度门/作弊门/BP 买点门 了吧。如果有必要
// 可以在因子门里头强调一下」）：恒放行的层不占流水线段与明细卡——因子代 AF2（不判档）/
// CF1（无拒臂）/ BPF（塞单门未命中）与类型 policy 直通（policy_pass）四类留痕只留数据
// 不渲染，活跃度看①因子门「活跃度流动性」分块（带强调行）；真拒买（含历史 BPF2 crash
// 形态拒）照常显示
const isFactorGen = (info) => typeof (info && info.model) === 'string' && info.model.startsWith('factor@');
const factorGenVersion = (info) => (isFactorGen(info) ? String(info.model).replace(/^factor@/, '') : '');
// BPF2 crash 形态复核（历史行专用：Jev 题 BP69「无回调 + 无换手」价格拱复核的因子
// 直译）：分支中文——判据源=metadata.buyPoint.factorTrace.crashForm（branch + trace 八键）。
// T243（2026-11-26 用户裁定「crash 形态复核……直接就是作为一个因子门」）起该判定迁
// 因子门 FP48 臂 crash_form（后端门行自带），新行无 factorTrace
const BP_CRASHFORM_BRANCH_LABELS = {
  crash_form: '🚫 命中：无回调 + 无换手的单边下跌（价格仍在线性下行、尾 10s 买方归零而卖单未停）',
  no_hint: '未进复核：数值提示臂（较窗高 ≤-25% / 30s 动量 ≤-25% / 近段 5s 跌 ≥15% / 贴窗低点 ≤2 点）全不中',
  rebounding: '有回调放行：5s 动量已走平/转正（>-1.5%，出现反弹）',
  turnover_present: '有换手放行：尾 10s 有买单（买方在场）',
  no_sell: '放行：尾 10s 买归零、卖也归零（量能枯竭的平静，不是单边下跌）',
  anchors_missing: '不判：关键锚缺席（窗极短 / 稀疏 tick——判缺不猜）',
  no_snapshot: '不判：无快照',
};
// [键, 中文名, 命中线]（命中线=提示臂线或形态条件线；null=只展示数值）
const BP_CRASHFORM_TRACE_LABELS = [
  ['chg5Pct', '5s 动量 %', '≤-1.5 未反弹'],
  ['currentVsAthPct', '较锚窗最高 %', '≤-25'],
  ['chg30Pct', '30s 动量 %', '≤-25'],
  ['nearMaxDn5Pct', '近段 5s 最大跌 %', '≤-15'],
  ['curVsMinGapPct', '距锚窗最低（点）', '≤2'],
  ['nearTail10BuyN', '尾 10s 买笔数', '=0 无换手'],
  ['nearTail10SellBnb', '尾 10s 卖 BNB', '>0 卖单未停'],
  ['recentDip5Pct', '末 30s 最深 5s 段 %', null],
];
// 因子门分类（T241b，2026-11-26 用户提案「因子门就很多了，建议进行一下因子分类。在信号
// 页面，也已分类为分块展示数据」）——镜像自 src/market-analysis/factor-pre-buy-check.js
// FACTOR_GATE_CATEGORIES / FACTOR_GATE_CATEGORY_BY_ID（单一真相源在后端，
// scripts/_test_factor_gate_categories.cjs 对锁两份，改分类两侧同步）。
// 历史信号行的门行无 category 字段 → 页面按门 id 归类；④BP 门的塞单门（stuffing_gate）
// 由页面按 metadata.buyPoint 合成门行并入同一分块视图（crash_form 自 FP48 起是后端因子
// 门门行；历史 BPF2 行仍按 buyPoint.factorTrace 合成）。
/* FACTOR_GATE_CATEGORIES:BEGIN */
const FACTOR_GATE_CATEGORIES = [
  { id: 'participation', label: '参与结构', question: '有没有像样的买家和主力' },
  { id: 'organized', label: '组织性协同', question: '是不是有组织的人在做事（捆绑 / 分仓 / 机器）' },
  { id: 'dumping', label: '砸盘出货', question: '是不是有人在砸盘出货、有没有人接' },
  { id: 'liquidity', label: '活跃度流动性', question: '盘面是死了还是过热' },
  { id: 'entry', label: '点位形态', question: '这个买点是不是在接刀' },
  { id: 'famous', label: 'famous / 聪明钱行为', question: '名单钱包在这个盘做了什么' },
  { id: 'pathway', label: '通路', question: '好票形状（命中 = 豁免放行，不拦截）' },
];
/* FACTOR_GATE_CATEGORIES:END */
/* FACTOR_GATE_CATEGORY_BY_ID:BEGIN */
const FACTOR_GATE_CATEGORY_BY_ID = {
  pvp: 'participation', big_buy_defer: 'participation', holder_scatter: 'participation',
  launch_squad: 'organized', even_split_crew: 'organized', oversell_residual: 'organized',
  arb_bot_holdings: 'organized', slow_pump: 'organized', cd405: 'organized', stuffing_gate: 'organized',
  cd400: 'dumping', cd403: 'dumping', dump_pair: 'dumping', cd412: 'dumping', cd414: 'dumping',
  cd401: 'dumping', holder_quiet_unload: 'dumping', tail_no_buyer: 'dumping', lifecycle_sell: 'dumping',
  act_idle: 'liquidity', act_sparse: 'liquidity', act_dust: 'liquidity', act_near_dead: 'liquidity',
  act_ultra_sell: 'liquidity', act_ultra_density: 'liquidity', tail_activity: 'liquidity',
  launch_fail_dead: 'liquidity', burst_weak: 'liquidity', lifecycle_burst: 'liquidity',
  tail_dip_knife: 'entry', malicious_dump: 'entry', crash_numeric: 'entry', crash_form: 'entry',
  fam_holding: 'famous', fam_harvest: 'famous', fam_harvest_final: 'famous', fam_burst_wave: 'famous',
  fam_low_exit: 'famous', fam_early_flip: 'famous', fam_dom_fall: 'famous',
  stall_restart: 'pathway',
};
/* FACTOR_GATE_CATEGORY_BY_ID:END */
// 门行归类（新行带 category 优先；历史行按门 id；未登记=null 不冒充归类）
const factorGateCategoryOf = (row) => (row && row.category) || FACTOR_GATE_CATEGORY_BY_ID[row && row.id] || null;
// 档位词 → 配色（none/mid 灰 · weak/noticeable/low 浅黄 · moderate/high amber · strong/dominant/ultra 红）
function gateBucketClass(bucket) {
  const b = String(bucket || '');
  if (['strong', 'dominant', 'ultra'].includes(b)) return 'bg-red-200 text-red-900 border-red-400';
  if (['moderate', 'high'].includes(b)) return 'bg-amber-200 text-amber-900 border-amber-400';
  if (['weak', 'noticeable', 'low'].includes(b)) return 'bg-yellow-200 text-yellow-900 border-yellow-400';
  return 'bg-gray-200 text-gray-800 border-gray-400';
}
function gateBucketSortKey(bucket) {
  const order = ['strong', 'dominant', 'ultra', 'moderate', 'high', 'weak', 'noticeable', 'low', ''];
  const i = order.indexOf(String(bucket || ''));
  return i === -1 ? order.length : i;
}

class ExperimentSignals {
  constructor() {
    this.experimentId = null;
    this.klineData = [];
    this.signals = [];  // 原始信号数据（所有代币）
    this.chart = null;
    this.volumeChart = null;
    this.autoRefresh = true;
    this.refreshInterval = null;
    this.currentFilters = {
      action: 'all',
      limit: 10000  // 增加限制以获取所有信号
    };

    // 🔥 多代币支持
    this.selectedToken = 'all';  // 当前选择的代币，'all'表示全部
    this._gmgnProfiles = new Map(); // GMGN 钱包画像缓存（图表气泡 hover tooltip，2026-11-26）
    this.availableTokens = [];   // 可用的代币列表

    // 🔥 Tick 图状态（散点图/区块K线共用一份数据与窗口口径）
    this.tickWindowSec = null;   // 用户指定的 tick 时间窗口（代币发出后 N 秒；null=不限）
    this._fullTickRange = false; // 全量模式（分页拉完全部 ticks，窗口=首末信号±5min）
    this._lastTickData = null;   // 缓存已拉取的 ticks（窗口切换不重新 fetch）
    this._lastToken = null;
    this.candleChart = null;
    this.candleVolumeChart = null;

    // 🔥 Holder 走势图（2026-10-15 ticks 化重建：/api/tokens/holder-series 全量重放，
    // 与引擎 holderCount 同口径；不再依赖已停写的 experiment_time_series_data 时序表）
    this.holderChart = null;
    this._lastHolderSeries = null; // 缓存 holder 序列（窗口切换不重新 fetch）

    // 🔥 观察信号（OBSERVE）图表标注数据：per-token 单独拉取——列表 fetch 在默认/
    // action 筛选视图会排除 OBSERVE 行（防挤占 limit），标注不能依赖 this.signals
    this._lastObserveSignals = [];

    // 🔥 famous 钱包名单（/api/rosters/famous-wallets，famous-copy-wallets.json 同源）：
    // 价格图 famous 操作标记的数据源；null=未加载/拉取失败（零标记 fail-open 不阻塞主图）
    this._famousWallets = null;
    this._famousProfiles = null; // addr → GMGN 身份档案（twitter_username 等，可缺席）
    this._famousRosterPromise = null;

    // 🧠 聪明钱钱包名单（/api/rosters/smart-money-wallets，smartmoney-accum.json 同源）：
    // 价格图聪明钱操作标记；null=未加载/失败（零标记 fail-open）。与 famous 分层：
    // famous 名单优先——交集钱包行归 famous 气泡，聪明钱标记跳过防双计
    this._smartWallets = null;
    this._smartProfiles = null; // addr → { twitterUsername, tags, hits, usd }（可缺席）
    this._smartRosterPromise = null;

    // ⚙️ 机器钱包名单（/api/rosters/arb-bot-wallets，gmgn_wallet_profiles 同源，
    // T198/FP30 arbBot 集同口径：arbitrager/sandwich_bot/wash_trader 并集）：
    // 价格图机器成交标记（橙=买/棕=卖）；null=未加载/失败（零标记 fail-open）。
    // 优先级链尾：famous > 聪明钱 > 机器——交集钱包行归上层标记防双计
    this._arbBotWallets = null;
    this._arbBotProfiles = null; // addr → { tags, buyCount, sellCount, tokenNum, winrate, realizedProfitUsd }
    this._arbBotRosterPromise = null;

    // 🔥 区块链信息（用于生成GMGN链接）
    this.blockchain = 'bsc';  // 默认BSC

    // 🔥 回测模式支持
    this._isBacktest = false;    // 是否是回测实验
    this._sourceExperimentId = null;  // 源实验ID

    // 🔥 拒绝信号统计
    this.rejectionStats = null;
    this.showRejected = true;  // 默认显示被拒绝的信号

    // 🎯 钱包聚焦（2026-11-22）：点击散点图气泡 → 同钱包交易保持原色、
    // 其它钱包气泡变灰淡（观察单一钱包建仓/出货节奏）；null=未聚焦。
    // _walletFocusToken 记聚焦时的 token——切票自动清除（跨票钱包行为无意义）
    this._walletFocus = null;
    this._walletFocusToken = null;

    // 🔥 实验配置（用于获取预检查条件）
    this.experimentConfig = null;
    // T202 策略库形状：包在启动后被改版时的版本漂移注记（空串=无漂移）
    this._packVersionNote = '';
    // ⓪类型通路卡判据表达式的数据源：点位类型注册表（_loadPointTypeRegistry 填充；
    // {version, byId:Map}）。null=未加载/加载失败——失败原因落 _pointTypeRegistryError，
    // 卡片显式提示「注册表未加载」，不静默缺表达式
    this._pointTypeRegistry = null;
    this._pointTypeRegistryError = '';

    this.init();
  }

  async init() {
    try {
      // 从URL获取实验ID
      const pathParts = window.location.pathname.split('/');
      this.experimentId = pathParts[pathParts.length - 2]; // 获取 /experiment/:id/signals 中的 :id

      if (!this.experimentId) {
        throw new Error('无法获取实验ID');
      }

      // 初始化事件监听器
      this.setupEventListeners();

      // 等待Chart.js加载完成
      await this.waitForChartJS();

      // 加载初始数据
      await this.loadData();

      // 隐藏加载指示器
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('signals-content').classList.remove('hidden');

    } catch (error) {
      console.error('页面初始化失败:', error);
      this.showError('页面初始化失败: ' + error.message);
    }
  }

  async waitForChartJS() {
    let attempts = 0;
    const maxAttempts = 20; // 最多等待10秒

    while (typeof Chart === 'undefined' && attempts < maxAttempts) {
      console.log(`⏳ 等待Chart.js加载... (${attempts + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (typeof Chart === 'undefined') {
      throw new Error('Chart.js加载超时，请检查网络连接');
    }

    // console.log('✅ Chart.js已加载完成');
  }

  setupEventListeners() {
    // 辅助函数：安全绑定事件
    const safeBind = (id, event, handler) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener(event, handler);
      } else {
        console.warn(`⚠️ 元素 #${id} 不存在`);
      }
    };

    // 刷新按钮
    safeBind('refresh-btn', 'click', () => {
      this.loadData();
    });

    // 自动刷新切换
    safeBind('auto-refresh-btn', 'click', () => {
      this.toggleAutoRefresh();
    });

    // 筛选控件
    safeBind('apply-filters', 'click', () => {
      this.applyFilters();
    });

    // 显示/隐藏拒绝信号复选框
    safeBind('include-rejected', 'change', (e) => {
      this.showRejected = e.target.checked;
      this.applyFilters();
    });

    // 导出按钮（可能不存在）
    safeBind('export-signals', 'click', () => {
      this.exportSignals();
    });

    // 🔥 Tick 时间窗口过滤（代币发出后 N 秒）
    safeBind('apply-tick-window', 'click', () => {
      this.applyTickWindow();
    });
    safeBind('reset-tick-window', 'click', () => {
      this.resetTickWindow();
    });
    // 输入框回车直接应用
    safeBind('tick-time-window', 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.applyTickWindow();
      }
    });

    // 🔥 分页拉取全量 ticks + 窗口覆盖所有买卖信号（单页上限可能截掉信号区间的 ticks）
    safeBind('load-full-ticks', 'click', () => {
      this.loadFullTickRange();
    });
  }

  /**
   * 应用 tick 时间窗口过滤：只展示代币发出后 N 秒内的 ticks
   * 基准 = 该 token 第一个 tick 的 block_time（最小值）
   */
  applyTickWindow() {
    const input = document.getElementById('tick-time-window');
    if (!input) return;
    const raw = input.value.trim();
    const val = Number(raw);
    // 空值或非正数 → 不限
    this.tickWindowSec = (raw !== '' && Number.isFinite(val) && val > 0) ? val : null;
    this._fullTickRange = false; // 显式窗口模式与全量模式互斥
    if (this._lastTickData && this._lastToken) {
      this.initBubbleChart(this._lastTickData, this._lastToken);
      this.initCandleChart(this._lastTickData, this._lastToken);
      this._renderHolderForWindow();
    }
  }

  /**
   * 重置 tick 时间窗口过滤（恢复默认：以首次信号为中心 ±5 分钟）
   */
  resetTickWindow() {
    const input = document.getElementById('tick-time-window');
    if (input) input.value = '';
    this.tickWindowSec = null;
    this._fullTickRange = false; // 重置回默认（首信号±5min）窗口
    if (this._lastTickData && this._lastToken) {
      this.initBubbleChart(this._lastTickData, this._lastToken);
      this.initCandleChart(this._lastTickData, this._lastToken);
      this._renderHolderForWindow();
    }
  }

  /**
   * 🔥 分页拉取该代币全量 ticks，展示窗口框住交易区间（首末信号 ±5 分钟）
   * 单页实际返回可能 < 请求 limit（Supabase 托管层行数限制），
   * block_time 升序 + offset 分页只拿到最早一页——信号区间的 ticks 可能在后面，
   * 必须分页拉完；默认窗口=首信号±5min 也会漏掉后续轮次信号 → 全量模式窗口=首末信号±5min
   */
  async loadFullTickRange() {
    const tokenAddress = this.selectedToken;
    if (!tokenAddress || tokenAddress === 'all') return;
    const token = this.availableTokens.find(t => t.address === tokenAddress)
      || (this._lastToken && this._lastToken.address === tokenAddress ? this._lastToken : null);
    if (!token) return;

    const btn = document.getElementById('load-full-ticks');
    if (btn && !btn.dataset.origText) btn.dataset.origText = btn.textContent; // 固定原始文案，重复点击不被「已加载全量…」覆盖
    if (btn) { btn.disabled = true; btn.textContent = '加载中...'; }

    try {
      const PAGE = 5000;
      const all = [];
      let offset = 0;
      // ⚠ offset 必须按实际返回条数推进：单页实际返回可能 < PAGE，
      // 若按 PAGE 推进且用 page.length < PAGE 终止会第一页就提前退出（信号位置 ticks 缺失的根因）
      while (true) {
        const params = new URLSearchParams({
          tokenAddress, limit: String(PAGE), offset: String(offset)
        });
        const response = await fetch(`/api/ticks?${params}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        const page = result?.data || [];
        all.push(...page);
        offset += page.length;
        const total = result?.pagination?.total;
        if (!page.length || (Number.isFinite(total) && all.length >= total)) break;
      }

      // 切换代币后过期响应直接丢弃（先恢复按钮状态，否则永久停留在「加载中...」）
      if (this.selectedToken !== tokenAddress) {
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText; }
        return;
      }

      console.log(`📥 全量 ticks 拉取完成: ${token.symbol || tokenAddress} 共 ${all.length} 条`);

      // famous/聪明钱标记依赖名单（正常流已在 loadKlineForToken 加载；此处兜底保证按钮直击路径也有）
      await this.ensureFamousRoster();
      await this.ensureSmartRoster();
      await this.ensureArbBotRoster();

      // 更新缓存 + 清掉窗口输入，进入全量模式后重渲染
      const input = document.getElementById('tick-time-window');
      if (input) input.value = '';
      this.tickWindowSec = null;
      this._fullTickRange = true;
      this._lastTickData = all;
      this._lastToken = token;

      this.initBubbleChart(all, token);
      this.initCandleChart(all, token);
      this._renderHolderForWindow();

      if (btn) btn.textContent = `已加载全量 ${all.length} 条`;
    } catch (error) {
      console.error('❌ 加载全量 ticks 失败:', error);
      if (btn) { btn.disabled = false; btn.textContent = '加载失败，点击重试'; }
      return;
    }
    if (btn) {
      btn.disabled = false;
      setTimeout(() => { if (btn.textContent.startsWith('已加载全量')) btn.textContent = btn.dataset.origText; }, 5000);
    }
  }

  async loadData() {
    try {
      // console.log('📊 loadData方法被调用 - 开始加载交易信号和K线数据...');

      // ⓪类型通路卡判据表达式数据源：点位类型注册表——与实验信息并行拉取，渲染信号前
      // await（_loadPointTypeRegistry 内部吞错落 _pointTypeRegistryError，不阻塞页面）
      const pointTypeRegistryLoaded = this._loadPointTypeRegistry();

      // 先加载实验信息
      const experimentResponse = await this.fetchExperiment();
      // console.log('📋 实验信息加载完成');

      // 更新实验信息
      if (experimentResponse.data) {
        this._experimentData = experimentResponse.data; // 叙事触发条件串等配置供详情面板消费
        this.updateExperimentHeader(experimentResponse.data);
        // T202 策略库形状：拉包物化腿供条件表达式/因子 chips 展示（旧内嵌腿形状零改动）
        await this._loadStrategyPackLegs();

        // 🔥 如果是回测实验，异步获取源实验的区块链信息（用于生成GMGN链接）
        if (this._isBacktest && this._sourceExperimentId) {
          await this.fetchSourceExperimentInfo();
        }
      }

      // 注册表到位（或已失败落原因）后才渲染信号卡片
      await pointTypeRegistryLoaded;

      // 🔥 先解析URL hash参数，自动选择代币（必须在fetchSignals之前）
      await this.parseHashToken();

      // 然后加载信号数据（fetchSignals 内部会自动使用源实验ID和tokenAddress过滤）
      const signalsResponse = await this.fetchSignals();
      console.log('📡 fetchSignals返回:', {
        success: signalsResponse.success,
        signalsCount: signalsResponse.signals?.length || 0,
        count: signalsResponse.count
      });

      // 更新信号数据（必须在 extractTokensFromExperiment 之前）
      this.signals = signalsResponse.signals || [];
      console.log('📊 已加载', this.signals.length, '条信号');
      console.log('📊 selectedToken:', this.selectedToken);

      // 🔥 从信号数据中提取代币列表并填充选择器
      this.extractTokensFromExperiment();

      // 🔥 如果URL中有token参数且找到了对应的代币，加载其时序图表
      if (this.selectedToken && this.selectedToken !== 'all') {
        const selectedToken = this.availableTokens.find(t =>
          this.blockchain === 'solana' ? t.address === this.selectedToken : t.address.toLowerCase() === this.selectedToken.toLowerCase()
        );
        if (selectedToken) {
          // 更新选择器的值
          const selector = document.getElementById('token-selector');
          if (selector) {
            selector.value = this.selectedToken;
            console.log('✅ 已自动选择代币:', this.selectedToken);
          }
          // 🔥 调用 filterAndRenderSignals 以显示代币地址信息
          this.filterAndRenderSignals();
          // 加载该代币的时序数据图表
          await this.loadKlineForToken(selectedToken);
        } else {
          console.warn('⚠️ URL中的代币不在信号列表中:', this.selectedToken);
          this.selectedToken = 'all'; // 重置为全部
        }
      }

      // 🔥 如果没有选择特定代币，也要调用 filterAndRenderSignals 来渲染所有信号
      if (this.selectedToken === 'all') {
        this.filterAndRenderSignals();
      }

      // 只有当没有选择特定代币时，才加载默认K线数据
      if (this.selectedToken === 'all') {
        // 尝试加载K线数据（不影响信号显示）
        try {
          console.log('📈 开始加载K线数据...');
          const klineResponse = await this.fetchKlineData();

          // 更新K线数据
          if (klineResponse.kline_data && klineResponse.kline_data.length > 0) {
            this.klineData = klineResponse.kline_data;
            console.log('🎯 准备初始化K线图，数据:', {
              kline_count: klineResponse.kline_data.length,
              signals_count: klineResponse.signals?.length || 0,
              interval: klineResponse.interval_minutes
            });

            // 初始化K线图
            this.initKlineChart(klineResponse);
          } else {
            console.warn('⚠️ 没有K线数据');
            this.showKlinePlaceholder('暂无K线数据');
          }
        } catch (klineError) {
          console.error('⚠️ K线数据加载失败（不影响信号显示）:', klineError);
          // 显示K线图占位符
          this.showKlinePlaceholder('暂无K线数据');
        }
      }

      // 根据 selectedToken 决定是否过滤数据
      const filteredSignals = this.selectedToken === 'all'
        ? this.signals
        : this.signals.filter(s => s.token_address === this.selectedToken);

      console.log('🔍 filteredSignals:', filteredSignals.length, 'selectedToken:', this.selectedToken);
      console.log('🔍 Sample signals:', filteredSignals.slice(0, 3).map(s => ({ action: s.action, symbol: s.symbol, token_address: s.token_address })));

      // 更新信号统计
      this.updateSignalsStats(filteredSignals);

      // 渲染信号列表
      this.renderSignals(filteredSignals);

      // 加载拒绝信号统计（不阻塞其他操作）
      this.loadRejectionStats();

      // console.log('✅ 数据加载完成');

    } catch (error) {
      console.error('❌ 数据加载失败:', error);
      this.showError('数据加载失败: ' + error.message);
    }
  }

  /**
   * 显示K线图占位符
   */
  showKlinePlaceholder(message) {
    const canvas = document.getElementById('kline-chart');
    if (!canvas) return;

    // 隐藏 canvas，显示占位符
    canvas.style.display = 'none';

    // 检查是否已有占位符元素
    let placeholder = document.getElementById('kline-chart-placeholder');
    if (!placeholder) {
      const container = canvas.parentElement;
      placeholder = document.createElement('div');
      placeholder.id = 'kline-chart-placeholder';
      placeholder.className = 'flex items-center justify-center h-full bg-gray-800 rounded-lg border border-gray-700';
      placeholder.style.minHeight = '450px';
      placeholder.innerHTML = `
        <div class="text-center">
          <div class="text-yellow-600 text-lg mb-2">📊</div>
          <div class="text-gray-400 text-sm">${message}</div>
        </div>
      `;
      container.appendChild(placeholder);
    } else {
      // 更新占位符消息
      placeholder.querySelector('.text-gray-400, .text-gray-600').textContent = message;
      placeholder.style.display = 'flex';
    }
  }

  async fetchExperiment() {
    const response = await fetch(`/api/experiment/${this.experimentId}`);
    if (!response.ok) {
      throw new Error('获取实验信息失败');
    }
    return await response.json();
  }

  async fetchSignals(experimentId = null) {
    // 🔥 始终使用当前实验的ID获取信号（回测实验显示自己的信号）
    const targetId = experimentId || this.experimentId;

    const params = new URLSearchParams({
      limit: this.currentFilters.limit
    });

    if (this.currentFilters.action !== 'all') {
      // 观察信号走 signal_type eq（signal_type 存大写）；其余 action 列值小写——
      // toLowerCase 修复既有 bug（此前发 'BUY' 对小写列值 eq 恒空，过滤失效）
      if (this.currentFilters.action === 'OBSERVE') {
        params.append('signalType', 'OBSERVE');
      } else {
        params.append('action', this.currentFilters.action.toLowerCase());
      }
    } else if (this.selectedToken && this.selectedToken !== 'all') {
      // 单票视图（#token= 直达/代币下拉选中）不排除观察行：单票行数少无挤占问题，
      // 纯观察票（灰灰案：仅 OBSERVE 行无 BUY/SELL）否则整页空白
    } else {
      // 默认视图排除观察行：全量排序 order(action,desc) 字母序 sell>hold>buy，
      // action='hold' 的观察行会把 BUY 挤出首页 limit（观察行单独经上方筛选项看）
      params.append('excludeSignalType', 'OBSERVE');
    }

    // 🔥 如果选择了特定代币，传递tokenAddress参数进行服务端过滤
    if (this.selectedToken && this.selectedToken !== 'all') {
      params.append('tokenAddress', this.selectedToken);
    }

    console.log('🔍 fetchSignals params:', Object.fromEntries(params));
    console.log('🔍 fetchSignals URL:', `/api/experiment/${targetId}/signals?${params}`);

    const response = await fetch(`/api/experiment/${targetId}/signals?${params}`);
    if (!response.ok) {
      throw new Error('获取交易信号失败');
    }
    const result = await response.json();

    // 标准化信号字段名以匹配前端期望格式
    if (result.signals && Array.isArray(result.signals)) {
      result.signals = result.signals.map(signal => ({
        ...signal,
        symbol: signal.token_symbol || signal.symbol || 'Unknown',
        signal_timestamp: signal.timestamp || signal.created_at || new Date().toISOString(),
        price: signal.price || null,
        executed: signal.executed || false,
        action: signal.action || signal.signal_type || 'HOLD'  // 映射 signal_type 到 action
      }));
    }

    // console.log('🔍 fetchSignals原始返回数据:', result);
    // console.log('🔍 信号数据长度:', result.signals?.length || 0);
    // console.log('🔍 信号数据示例:', result.signals?.[0]);
    return result;
  }

  async fetchKlineData(tokenId = null, startTimeMs = null, endTimeMs = null) {
    const params = new URLSearchParams();
    if (tokenId) params.append('tokenId', tokenId);
    if (startTimeMs !== null) params.append('startTime', String(startTimeMs));
    if (endTimeMs !== null) params.append('endTime', String(endTimeMs));
    const qs = params.toString();
    const url = `/api/experiment/${this.experimentId}/kline${qs ? `?${qs}` : ''}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('获取K线数据失败');
    }
    return await response.json();
  }

  /**
   * 🔥 解析URL参数，自动选择代币
   * 支持 #token=0x... 和 ?token=0x... 两种格式
   * ?token= 用于从统计页面跳转，#token= 用于直接分享链接
   */
  async parseHashToken() {
    try {
      let tokenAddress = null;

      // 优先检查 query 参数 ?token=xxx（从统计页面跳转）
      const urlParams = new URLSearchParams(window.location.search);
      tokenAddress = urlParams.get('token');

      if (tokenAddress) {
        console.log('🔍 检测 URL query参数 token:', tokenAddress);
      } else {
        // 其次检查 hash 参数 #token=xxx（直接分享链接）
        const hash = window.location.hash;
        if (hash) {
          console.log('🔍 检测 URL hash参数:', hash);
          const tokenMatch = hash.match(/#token=([^&]+)/);
          if (tokenMatch) {
            tokenAddress = tokenMatch[1];
            console.log('🔍 发现hash token参数:', tokenAddress);
          }
        }
      }

      if (tokenAddress) {
        console.log('🔍 设置selectedToken:', tokenAddress);

        // 直接设置 selectedToken（用于API过滤）
        // 此时 availableTokens 还未填充，所以先不检查
        this.selectedToken = tokenAddress;

        // 隐藏代币选择下拉框（因为已经通过 URL 指定了代币）
        this.hideTokenSelector();

        // 注意：时序图表加载和选择器更新会在 extractTokensFromExperiment 之后进行
      }
    } catch (error) {
      console.error('❌ 解析URL参数失败:', error);
    }
  }

  /**
   * 隐藏代币选择下拉框（详情页模式）
   */
  hideTokenSelector() {
    const tokenSelectorDropdown = document.getElementById('token-selector-dropdown');
    if (tokenSelectorDropdown) {
      tokenSelectorDropdown.style.display = 'none';
      console.log('✅ 已隐藏代币选择下拉框（详情页模式）');
    }
  }

  /**
   * 🔥 加载特定代币的图表（tick 散点图 + 区块K线图）
   * 数据源 wss_price_ticks（链上逐笔成交，与引擎决策同粒度——30s 时序快照会
   * 漏采秒级脉冲，卖点前"看不到下跌"的显示问题由此修复）
   * @param {Object} token - 代币对象 { address, symbol, priority }
   */
  async loadKlineForToken(token) {
    try {
      console.log('🔄 loadKlineForToken 开始:', token.symbol, token.address);

      // 切换代币：常规加载仍是单页上限，退出全量模式
      this._fullTickRange = false;

      // Ticks 浏览页外链跟随当前代币
      const ticksLink = document.getElementById('token-ticks-link');
      if (ticksLink) ticksLink.href = `/token-ticks?token=${encodeURIComponent(token.address)}`;

      const chartWrapper = document.getElementById('kline-chart-wrapper');
      if (chartWrapper) chartWrapper.style.display = 'block';

      // tick 散点/K线 与 Holder 走势序列并行拉取（Holder=ticks 全量重放重建，
      // 与引擎 holderCount 同口径；不依赖已停写的 experiment_time_series_data）；
      // trades=成交记录（2026-10-15 双口径：图上标成交时刻/成交价，与信号时刻/信号价并陈）；
      // rounds=叙事分析轮次（C84：新模型腿后台分析留痕，图表标注+轮次面板共用）；
      // observe=观察信号（OBSERVE 行时刻，图上标青虚线）；
      // cheats=反作弊判定行（G12：图上标判定时刻虚线+详情）、
      // narrative=叙事分析结论（token_narrative 最新行：分类/评级/理由/超级IP）
      const [tickResponse, holderResponse, tradesData, roundsData, observeData, cheatData, narrativeDetail] = await Promise.all([
        this.fetchTickData(token.address),
        this.fetchHolderSeries(token.address),
        this.fetchTokenTrades(token.address),
        this.fetchNarrativeRounds(token.address),
        this.fetchObserveSignals(token.address),
        this.fetchCheatDetections(token.address),
        this.fetchNarrativeDetail(token.address),
        this.ensureFamousRoster(), // famous 操作标记（memoized，切换代币零成本）
        this.ensureSmartRoster(), // 🧠 聪明钱操作标记（memoized，同上）
        this.ensureArbBotRoster(), // ⚙️ 机器钱包操作标记（memoized，同上）
      ]);
      // 切换代币后过期响应直接丢弃
      if (this.selectedToken !== token.address) return;

      this._lastHolderSeries = (holderResponse?.success && Array.isArray(holderResponse.data))
        ? holderResponse.data
        : [];
      this._lastTokenTrades = tradesData;
      this._lastNarrativeRounds = roundsData;
      this._lastObserveSignals = observeData;
      this._lastCheatDetections = cheatData;
      this._lastNarrativeDetail = narrativeDetail;

      if (!tickResponse?.success || !tickResponse?.data?.length) {
        console.warn('⚠️ 没有 tick 数据，隐藏图表');
        if (chartWrapper) chartWrapper.style.display = 'none';
        const candleWrapper = document.getElementById('candle-chart-wrapper');
        if (candleWrapper) candleWrapper.classList.add('hidden');
        this._renderHolderForWindow(); // 价格图缺数据不影响 Holder 图独立展示
        this._renderNarrativeRoundsPanel(token); // 轮次面板独立于价格图展示
        return;
      }

      this.initBubbleChart(tickResponse.data, token);
      this.initCandleChart(tickResponse.data, token);
      this._renderHolderForWindow();
      this._renderNarrativeRoundsPanel(token);

      console.log(`✅ Tick charts loaded for ${token.symbol}, ${tickResponse.data.length} ticks`);
    } catch (error) {
      console.error(`❌ 加载 tick 数据失败:`, error);

      // 隐藏图表区域
      const chartWrapper = document.getElementById('kline-chart-wrapper');
      if (chartWrapper) {
        chartWrapper.style.display = 'none';
      }
      const candleWrapper = document.getElementById('candle-chart-wrapper');
      if (candleWrapper) candleWrapper.classList.add('hidden');
      const holderChartWrapper = document.getElementById('holder-chart-wrapper');
      if (holderChartWrapper) holderChartWrapper.style.display = 'none';
    }
  }

  /**
   * 拉取代币的原始 ticks（单页上限内；需要完整数据点「加载全量」分页拉取）
   * @param {string} tokenAddress
   */
  async fetchTickData(tokenAddress) {
    try {
      const params = new URLSearchParams({ tokenAddress, limit: '5000' });
      const response = await fetch(`/api/ticks?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('获取tick数据失败:', error);
      return { success: false, data: [] };
    }
  }

  /**
   * 拉取 famous 钱包名单（memoized：页面生命周期内拉一次；失败也 memoize 成空 Set，
   * 与其它图表标注数据源同策略——缺席不阻塞主图，仅零标记）
   * @returns {Promise<Set<string>>} 小写地址集合
   */
  ensureFamousRoster() {
    if (this._famousWallets) return Promise.resolve(this._famousWallets);
    if (!this._famousRosterPromise) {
      this._famousRosterPromise = fetch('/api/rosters/famous-wallets')
        .then(r => (r.ok ? r.json() : null))
        .then(json => {
          const wallets = (json?.success && Array.isArray(json.data?.wallets)) ? json.data.wallets : [];
          this._famousWallets = new Set(wallets.map(w => String(w).toLowerCase()));
          this._famousProfiles = json?.data?.profiles || null;
          const named = this._famousProfiles
            ? Object.values(this._famousProfiles).filter(p => p && (p.twitterUsername || p.name || p.twitterName)).length : 0;
          console.log(`⭐ famous 名单加载: ${this._famousWallets.size} 址 (v${json?.data?.version ?? '?'}, GMGN 身份 ${named})`);
          return this._famousWallets;
        })
        .catch(err => {
          console.warn('⚠️ famous 名单加载失败，价格图将无 famous 标记:', err);
          this._famousWallets = new Set();
          return this._famousWallets;
        });
    }
    return this._famousRosterPromise;
  }

  /**
   * 🧠 拉取聪明钱钱包名单（memoized：页面生命周期内拉一次；失败也 memoize 成空 Set，
   * 与 famous 同策略——缺席不阻塞主图，仅零标记）
   * @returns {Promise<Set<string>>} 小写地址集合
   */
  ensureSmartRoster() {
    if (this._smartWallets) return Promise.resolve(this._smartWallets);
    if (!this._smartRosterPromise) {
      this._smartRosterPromise = fetch('/api/rosters/smart-money-wallets')
        .then(r => (r.ok ? r.json() : null))
        .then(json => {
          const wallets = (json?.success && Array.isArray(json.data?.wallets)) ? json.data.wallets : [];
          this._smartWallets = new Set(wallets.map(w => String(w).toLowerCase()));
          this._smartProfiles = json?.data?.profiles || null;
          const named = this._smartProfiles
            ? Object.values(this._smartProfiles).filter(p => p && (p.twitterUsername || p.name)).length : 0;
          console.log(`🧠 聪明钱名单加载: ${this._smartWallets.size} 址 (快照 ${json?.data?.meta?.snapshots ?? '?'}, 身份 ${named})`);
          return this._smartWallets;
        })
        .catch(err => {
          console.warn('⚠️ 聪明钱名单加载失败，价格图将无聪明钱标记:', err);
          this._smartWallets = new Set();
          return this._smartWallets;
        });
    }
    return this._smartRosterPromise;
  }

  /**
   * ⚙️ 拉取机器钱包名单（memoized：页面生命周期内拉一次；失败也 memoize 成空 Set，
   * 与 famous/聪明钱同策略——缺席不阻塞主图，仅零标记）。T198/FP30 arbBot 集同源
   * （gmgn_wallet_profiles tags：arbitrager/sandwich_bot/wash_trader 并集）。
   * @returns {Promise<Set<string>>} 小写地址集合
   */
  ensureArbBotRoster() {
    if (this._arbBotWallets) return Promise.resolve(this._arbBotWallets);
    if (!this._arbBotRosterPromise) {
      this._arbBotRosterPromise = fetch('/api/rosters/arb-bot-wallets')
        .then(r => (r.ok ? r.json() : null))
        .then(json => {
          const wallets = (json?.success && Array.isArray(json.data?.wallets)) ? json.data.wallets : [];
          this._arbBotWallets = new Set(wallets.map(w => String(w).toLowerCase()));
          this._arbBotProfiles = json?.data?.profiles || null;
          console.log(`⚙️ 机器钱包名单加载: ${this._arbBotWallets.size} 址 (GMGN 画像 arbBot 集)`);
          return this._arbBotWallets;
        })
        .catch(err => {
          console.warn('⚠️ 机器钱包名单加载失败，价格图将无机器标记:', err);
          this._arbBotWallets = new Set();
          return this._arbBotWallets;
        });
    }
    return this._arbBotRosterPromise;
  }

  /**
   * famous 钱包显示名：twitter_name（推特显示名）优先 → @twitter_username 回落 →
   * GMGN name → null（null=tooltip 回落地址缩写）；档案缺席不冒充
   * @param {string} wallet 小写地址
   * @returns {string|null}
   */
  _famousLabel(wallet) {
    const p = this._famousProfiles && this._famousProfiles[wallet];
    if (!p) return null;
    if (p.twitterName) return p.twitterName;
    if (p.twitterUsername) return `@${p.twitterUsername}`;
    if (p.name) return p.name;
    return null;
  }

  /**
   * 🧠 聪明钱钱包显示名：@twitter 优先 → name → null（null=tooltip 回落地址缩写）
   * @param {string} wallet 小写地址
   * @returns {string|null}
   */
  _smartLabel(wallet) {
    const p = this._smartProfiles && this._smartProfiles[wallet];
    if (!p) return null;
    if (p.twitterUsername) return `@${p.twitterUsername}`;
    if (p.name) return p.name;
    return null;
  }

  /**
   * 🔥 名单钱包操作点位通用构建器（famous/聪明钱共用；散点图气泡/K线图 scatter 双图表）：
   * wallet 口径 = sender_address || trader_address（与 FA/引擎一致）；名单缺席=空数组。
   * 价格/金额门槛与散点图主气泡同口径（MIN_BNB=0.005、price_usd 有效）。
   * exclude=更高优先级名单地址集合（famous）——交集钱包行归高优先级标记防双计。
   * @param {Array} trimmedTickData - 已过窗口裁剪的 ticks（含 sender_address）
   * @param {Set<string>} wallets - 名单（小写地址）
   * @param {string} kind - 点位挂载键（'_famous'|'_smart'，tooltip/主气泡剔重消费）
   * @param {Function} metaFn - (wallet) => 附加展示字段 {label, tags?}
   * @param {Set<string>} [exclude] - 跳过的高优先级名单
   * @returns {{buyPoints:Array, sellPoints:Array}} 点位 {x,y,r,[kind]:{wallet,bnb,tradeType,...meta}}
   */
  _buildRosterMarkPoints(trimmedTickData, wallets, kind, metaFn, exclude) {
    const buyPoints = [], sellPoints = [];
    if (!wallets || wallets.size === 0) return { buyPoints, sellPoints };
    const MIN_BNB = 0.005; // 与主气泡同口径（小额 tick 价格精度不足）
    for (const tick of trimmedTickData) {
      const wallet = (tick.sender_address || tick.trader_address || '').toLowerCase();
      if (!wallet || !wallets.has(wallet)) continue;
      if (exclude && exclude.size > 0 && exclude.has(wallet)) continue;
      const bnbAmount = parseFloat(tick.bnb_amount) || 0;
      if (bnbAmount < MIN_BNB) continue;
      const priceUsd = parseFloat(tick.price_usd);
      if (!priceUsd || priceUsd <= 0) continue;
      const tradeType = tick.trade_type === 'buy' ? '买' : '卖';
      (tick.trade_type === 'buy' ? buyPoints : sellPoints).push({
        x: new Date(tick.block_time).getTime(),
        y: priceUsd,
        r: this._mapTickRadius(bnbAmount),
        [kind]: { wallet, bnb: bnbAmount, tradeType, ...metaFn(wallet) },
      });
    }
    return { buyPoints, sellPoints };
  }

  /**
   * 🔥 famous 钱包操作点位（通用构建器 famous 臂）：
   * @param {Array} trimmedTickData - 已过窗口裁剪的 ticks（含 sender_address）
   * @returns {{buyPoints:Array, sellPoints:Array}} 点位 {x,y,r,_famous:{wallet,bnb,tradeType,label}}
   */
  _buildFamousPoints(trimmedTickData) {
    return this._buildRosterMarkPoints(
      trimmedTickData, this._famousWallets, '_famous', (w) => ({ label: this._famousLabel(w) }));
  }

  /**
   * 🧠 聪明钱操作点位（通用构建器聪明钱臂）：famous 名单优先——交集钱包行归
   * famous 金/紫气泡（用户裁定名单 > 平台流名单），聪明钱标记只覆盖增量钱包。
   * @param {Array} trimmedTickData - 已过窗口裁剪的 ticks（含 sender_address）
   * @returns {{buyPoints:Array, sellPoints:Array}} 点位 {x,y,r,_smart:{wallet,bnb,tradeType,label,tags}}
   */
  _buildSmartPoints(trimmedTickData) {
    return this._buildRosterMarkPoints(
      trimmedTickData, this._smartWallets, '_smart',
      (w) => {
        const p = this._smartProfiles && this._smartProfiles[w];
        return {
          label: this._smartLabel(w),
          tags: (p && Array.isArray(p.tags)) ? p.tags : [],
          hits: (p && Number(p.hits)) || 0,
          usd: (p && Number(p.usd)) || 0, // GMGN smartmoney 流出现次数/累计成交 USD（研究档案）
        };
      },
      this._famousWallets);
  }

  /**
   * ⚙️ 机器钱包操作点位（通用构建器机器臂）：T198/FP30 arbBot 集（GMGN 画像
   * arbitrager/sandwich_bot/wash_trader）。优先级链尾——exclude = famous ∪ 聪明钱
   * （交集钱包行归上层人肉标记，机器标记只覆盖增量钱包）。
   * @param {Array} trimmedTickData - 已过窗口裁剪的 ticks（含 sender_address）
   * @returns {{buyPoints:Array, sellPoints:Array}} 点位 {x,y,r,_arbbot:{wallet,bnb,tradeType,tags,stats}}
   */
  _buildArbBotPoints(trimmedTickData) {
    const exclude = new Set([
      ...(this._famousWallets || []),
      ...(this._smartWallets || []),
    ]);
    return this._buildRosterMarkPoints(
      trimmedTickData, this._arbBotWallets, '_arbbot',
      (w) => {
        const p = this._arbBotProfiles && this._arbBotProfiles[w];
        return {
          tags: (p && Array.isArray(p.tags)) ? p.tags : [],
          stats: p || null, // 30d 画像：buyCount/sellCount/tokenNum/winrate/realizedProfitUsd
        };
      },
      exclude);
  }

  /**
   * 拉取 Holder 走势序列（后端 wss_price_ticks 全量重放，与引擎 holderCount 同口径）
   * @param {string} tokenAddress
   * @returns {Promise<{success: boolean, data: Array<{t:number, holders:number}>}>}
   */
  async fetchHolderSeries(tokenAddress) {
    try {
      const params = new URLSearchParams({ tokenAddress });
      const response = await fetch(`/api/tokens/holder-series?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('获取 Holder 序列失败:', error);
      return { success: false, data: [] };
    }
  }

  /**
   * 拉取该 token 的成功成交记录（双口径图表原料：成交时刻细线 + 成交价点位）
   * @param {string} tokenAddress
   * @returns {Promise<Array>} trades（toJSON 形状：trade_direction/unit_price/
   *   executed_at/created_at/signal_id/metadata）
   */
  async fetchTokenTrades(tokenAddress) {
    try {
      const params = new URLSearchParams({ tokenAddress, success: 'true', limit: '1000' });
      const response = await fetch(`/api/experiment/${this.experimentId}/trades?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      return Array.isArray(json.data) ? json.data : [];
    } catch (error) {
      console.error('获取 token 成交记录失败:', error);
      return []; // 成交标注缺席不阻塞主图
    }
  }

  /**
   * 拉取该 token 的叙事分析轮次（C84 新模型腿留痕：被拒 token 的轨迹也可查）
   * @param {string} tokenAddress
   * @returns {Promise<Array>} rounds（narrative_analysis_rounds 行）
   */
  async fetchNarrativeRounds(tokenAddress) {
    try {
      const params = new URLSearchParams({ tokenAddress });
      const response = await fetch(`/api/experiment/${this.experimentId}/narrative-rounds?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      return Array.isArray(json.rounds) ? json.rounds : [];
    } catch (error) {
      console.error('获取叙事分析轮次失败:', error);
      return []; // 轮次缺席不阻塞图表
    }
  }

  /**
   * 拉取该 token 的观察信号行（OBSERVE：叙事评级 2/3 或市值过阈的留痕，
   * action='hold' 恒不触发交易）——图表观察时刻标注数据源。单独拉取而非
   * 复用 this.signals：默认/action 筛选视图 fetch 时排除 OBSERVE 行
   * （防观察行挤占 limit），依赖它会随筛选器忽隐忽现。
   * @param {string} tokenAddress
   * @returns {Promise<Array>} OBSERVE 信号行（maxPerToken 上限 3/票）
   */
  async fetchObserveSignals(tokenAddress) {
    try {
      const params = new URLSearchParams({
        tokenAddress, signalType: 'OBSERVE', limit: '200',
      });
      const response = await fetch(`/api/experiment/${this.experimentId}/signals?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      return Array.isArray(json.signals) ? json.signals : [];
    } catch (error) {
      console.error('获取观察信号失败:', error);
      return []; // 观察行缺席不阻塞图表
    }
  }

  /**
   * 拉取该 token 的反作弊判定行（cheat_detection：G12 分级门轨迹，
   * 帽 4/token）——图表判定时刻标注 + 详情展示数据源。
   * @param {string} tokenAddress
   * @returns {Promise<Array>} 判定行（analyzed_at/grade/grade_reasons/verdict）
   */
  async fetchCheatDetections(tokenAddress) {
    try {
      const params = new URLSearchParams({ tokenAddress });
      const response = await fetch(`/api/experiment/${this.experimentId}/cheat-detections?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      return Array.isArray(json.data) ? json.data : [];
    } catch (error) {
      console.error('获取反作弊判定失败:', error);
      return []; // 判定缺席不阻塞图表
    }
  }

  /**
   * 拉取该 token 的叙事分析结论（token_narrative 最新行经 POST /narrative
   * 子集路径：rating/token_category/reason/superip 标签）——详情面板数据源。
   * @param {string} tokenAddress
   * @returns {Promise<Object|null>} {rating, token_category, reason, superIp...} | null
   */
  async fetchNarrativeDetail(tokenAddress) {
    try {
      const response = await fetch(`/api/experiment/${this.experimentId}/narrative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: [tokenAddress] }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      const row = Array.isArray(json.data) && json.data.length ? json.data[0] : null;
      return row?.narrative || null;
    } catch (error) {
      console.error('获取叙事分析结论失败:', error);
      return null; // 结论缺席不阻塞图表
    }
  }

  /**
   * 生成叙事分析轮次标注（C84）：析起=紫虚线[6,4]、析毕=琥珀虚线[2,3]。
   * 与信号/成交标注同窗过滤（防撑开 X 轴）；标签放顶部（position 'end'）与
   * 底部信号标签错位。轮次时间轴与 ticks 同墙钟（引擎发起/完成时刻）。
   */
  _buildNarrativeRoundAnnotations(rounds, trimStart, trimEnd) {
    const annotations = [];
    if (!Array.isArray(rounds)) return annotations;
    const stack = new Map(); // 同刻多轮错位
    rounds.forEach(r => {
      const marks = [
        { t: r.started_at, color: '#a855f7', dash: [6, 4], text: `析起R${r.round_no}` },
        r.completed_at && { t: r.completed_at, color: '#f59e0b', dash: [2, 3], text: `析毕R${r.round_no}=${r.rating == null ? '?' : r.rating}` },
      ].filter(Boolean);
      for (const m of marks) {
        const ms = new Date(m.t).getTime();
        if (!Number.isFinite(ms)) continue;
        if (trimStart != null && ms < trimStart) continue;
        if (trimEnd != null && ms > trimEnd) continue;
        const idx = stack.get(ms) || 0;
        stack.set(ms, idx + 1);
        annotations.push({
          type: 'line',
          xMin: ms,
          xMax: ms,
          borderColor: m.color,
          borderWidth: 1.5,
          borderDash: m.dash,
          label: {
            display: true,
            content: m.text,
            position: 'end',
            yAdjust: idx * 15, // 同刻多标注逐条下移
            backgroundColor: m.color,
            color: '#fff',
            font: { size: 10 },
          },
        });
      }
    });
    return annotations;
  }

  /**
   * 生成观察信号时刻标注（OBSERVE 行）：青虚线[4,4]，标签放顶部（与叙事轮次
   * 标注同位、与底部买卖信号标签错位；固定 14px 下移基座防与同刻析起/析毕
   * 标签叠死）。trigger 域=narrative|marketcap|both（ObservationSignalService），
   * 未知 trigger 裸「观察」不冒充。观察行恒终态（无 executed 推进），一律
   * 同款轻量虚线。
   */
  _buildObserveAnnotations(observeSignals, trimStart, trimEnd) {
    const annotations = [];
    if (!Array.isArray(observeSignals)) return annotations;
    const TRIGGER_LABEL = { narrative: '叙事', marketcap: '市值', both: '叙事+市值' };
    const stack = new Map(); // 同刻多行错位
    observeSignals.forEach(signal => {
      const ms = new Date(signal.timestamp || signal.created_at).getTime();
      if (!Number.isFinite(ms)) return;
      if (trimStart != null && ms < trimStart) return;
      if (trimEnd != null && ms > trimEnd) return;
      const trigger = signal.metadata?.observation?.trigger;
      const t = TRIGGER_LABEL[trigger];
      const idx = stack.get(ms) || 0;
      stack.set(ms, idx + 1);
      annotations.push({
        type: 'line',
        xMin: ms,
        xMax: ms,
        borderColor: '#22d3ee',
        borderWidth: 1.5,
        borderDash: [4, 4],
        label: {
          display: true,
          content: t ? `观察·${t}` : '观察',
          position: 'end',
          yAdjust: 14 + idx * 15,
          backgroundColor: '#0891b2',
          color: '#fff',
          font: { size: 10 },
        },
      });
    });
    return annotations;
  }

  /**
   * 生成反作弊判定时刻标注（cheat_detection 行）：点虚线[1,3]，色随 grade
   * （unhealthy=玫红 / cheat=深红 / healthy=青绿 / 失败行=灰）。标签放顶部，
   * 固定 28px 下移基座（叠在析起/析毕/观察标注之上，四层错位）。
   * 只画 grade 行（timeout/error 失败行也画，灰标签留痕配额消耗点）。
   */
  _buildCheatAnnotations(cheatRows, trimStart, trimEnd) {
    const annotations = [];
    if (!Array.isArray(cheatRows)) return annotations;
    const GRADE_STYLE = {
      cheat: { color: '#b91c1c', label: '拉黑' },
      unhealthy: { color: '#ec4899', label: '不健康' },
      healthy: { color: '#14b8a6', label: '健康' },
    };
    const stack = new Map(); // 同刻多行错位
    cheatRows.forEach(row => {
      const ms = new Date(row.analyzed_at).getTime();
      if (!Number.isFinite(ms)) return;
      if (trimStart != null && ms < trimStart) return;
      if (trimEnd != null && ms > trimEnd) return;
      const grade = row.grade;
      const style = grade ? GRADE_STYLE[grade] : null;
      // 未分级行（观察层/旧版/失败行）：灰虚线标 verdict，只对非 observed 的
      // 失败行画（observed 未分级=判定层停产期形状，画了只有噪声）
      if (!style && row.verdict !== 'timeout' && row.verdict !== 'error') return;
      const text = style ? `反作弊·${style.label}` : `反作弊·${row.verdict}`;
      const color = style ? style.color : '#6b7280';
      const idx = stack.get(ms) || 0;
      stack.set(ms, idx + 1);
      annotations.push({
        type: 'line',
        xMin: ms,
        xMax: ms,
        borderColor: color,
        borderWidth: 1.5,
        borderDash: [1, 3],
        label: {
          display: true,
          content: text,
          position: 'end',
          yAdjust: 28 + idx * 15,
          backgroundColor: color,
          color: '#fff',
          font: { size: 10 },
        },
      });
    });
    return annotations;
  }

  /**
   * 叙事分析轮次面板（C84）：分析结论块（token_narrative 最新行：分类/评级/
   * 理由/超级IP + 触发条件串）+ 轮次表 + 终评 + fire 提前量。
   * leadMs 取自该 token 买信号 metadata.narrativeRoundsSummary（fire−末轮完成）；
   * 轮次与结论任一在场即展示（legacy 腿无轮次但有直调结论；反向=未触发无结论）。
   */
  _renderNarrativeRoundsPanel(token) {
    const wrapper = document.getElementById('narrative-rounds-wrapper');
    const body = document.getElementById('narrative-rounds-body');
    if (!wrapper || !body) return;
    const rounds = Array.isArray(this._lastNarrativeRounds) ? this._lastNarrativeRounds : [];
    const detail = this._lastNarrativeDetail || null;
    if (!rounds.length && !detail) { wrapper.classList.add('hidden'); body.innerHTML = ''; return; }
    wrapper.classList.remove('hidden');

    const RATING_LABEL = { 1: '1·low', 2: '2·mid', 3: '3·high', 9: '9·未知/失败' };
    const fmtTs = (v) => v ? new Date(v).toLocaleTimeString('zh-CN') : '—';
    const fmtDur = (r) => (r.started_at && r.completed_at)
      ? ((new Date(r.completed_at) - new Date(r.started_at)) / 1000).toFixed(1) + 's' : '—';

    // ── 分析结论块（token_narrative 最新行） ──
    const detailBits = [];
    if (detail) {
      const cat = detail.token_category ? NARRATIVE_CATEGORY_MAP[detail.token_category] : null;
      if (cat) {
        detailBits.push(`<span class="mr-3" title="${this._escapeHtml(cat.title)}">分类: <span class="font-semibold text-purple-300">${this._escapeHtml(cat.label)}</span> <code class="text-gray-500">${this._escapeHtml(detail.token_category)}</code></span>`);
      } else if (detail.token_category) {
        detailBits.push(`<span class="mr-3">分类: <code>${this._escapeHtml(detail.token_category)}</code></span>`);
      } else {
        detailBits.push(`<span class="mr-3 text-gray-500" title="precheck fail/no_data 无分类（C146 终态清空）">分类: —</span>`);
      }
      const rating = detail.llmAnalysis?.summary?.numericRating ?? detail.rating;
      if (rating != null) {
        const pass = rating === 2 || rating === 3;
        detailBits.push(`<span class="mr-3">叙事评级: <span class="${pass ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}">${RATING_LABEL[rating] || rating}</span></span>`);
      }
      // C88 超级IP 两标签（1/0/null 三态，null=题集前旧行）
      if (detail.narrativeSuperIp === 1) detailBits.push(`<span class="mr-3 text-pink-300">★ 超级IP</span>`);
      if (detail.narrativeSuperIpSlogan === 1) detailBits.push(`<span class="mr-3 text-pink-200">★ 超级IP·口号币</span>`);
      if (detail.analyzed_at) {
        detailBits.push(`<span class="mr-3 text-gray-400">分析时刻: ${new Date(detail.analyzed_at).toLocaleString('zh-CN', { hour12: false })}</span>`);
      }
      const reason = detail.llmAnalysis?.summary?.reason;
      if (reason) {
        detailBits.push(`<div class="mt-1 text-xs text-gray-400 leading-relaxed" style="max-width:72rem"><span class="text-gray-500">理由：</span>${this._escapeHtml(String(reason))}</div>`);
      }
    }

    // 触发条件串（实验配置中引用该 token 的叙事触发条件，去重展示）
    const triggerConds = [...new Set(
      ((this._experimentData?.config?.strategiesConfig?.buyStrategies) || [])
        .map(s => s?.narrativeTriggerCondition)
        .filter(Boolean)
    )];
    const triggerHtml = triggerConds.length
      ? `<div class="mt-1 text-xs"><span class="text-gray-500">叙事触发条件：</span>${triggerConds.map(c => `<code class="px-1.5 py-0.5 bg-gray-900 rounded break-all text-cyan-300">${this._escapeHtml(c)}</code>`).join(' ')}</div>`
      : '';

    const lastDone = [...rounds].reverse().find(r => r.completed_at && r.rating != null);
    const finalBits = [];
    if (lastDone) {
      const pass = lastDone.rating === 2 || lastDone.rating === 3;
      finalBits.push(`<span class="mr-3">终评: <span class="${pass ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}">${RATING_LABEL[lastDone.rating] || lastDone.rating}</span>${pass ? '（可进买门）' : '（拦截）'}</span>`);
    }
    // fire 提前量：该 token 已执行买信号的 narrativeRoundsSummary.leadMs
    const buySig = (this.signals || []).find(s =>
      (s.action || '').toUpperCase() === 'BUY'
      && (s.token_address || s.tokenAddress) === token.address
      && s.metadata?.narrativeRoundsSummary);
    if (buySig) {
      const nr = buySig.metadata.narrativeRoundsSummary;
      const lead = Number(nr.leadMs);
      finalBits.push(`<span class="mr-3">fire→买信号用轮数: ${nr.rounds}${Number.isFinite(lead) ? ` · 分析提前量 ${(lead / 1000).toFixed(1)}s` : ''}</span>`);
    }

    const rows = rounds.length ? `
      <table class="w-full text-xs text-gray-300 mt-3">
        <thead><tr class="text-gray-400 border-b border-gray-600">
          <th class="py-1 pr-3 text-left">轮次</th><th class="py-1 pr-3 text-left">发起</th>
          <th class="py-1 pr-3 text-left">开始</th><th class="py-1 pr-3 text-left">完成</th>
          <th class="py-1 pr-3 text-left">评级</th><th class="py-1 pr-3 text-left">来源</th>
          <th class="py-1 text-left">错误</th>
        </tr></thead>
        <tbody>${rounds.map(r => `
          <tr class="border-t border-gray-700">
            <td class="py-1.5 pr-3">R${r.round_no}</td>
            <td class="py-1.5 pr-3">${r.trigger_reason === 'retry' ? '🔁 retry（账号型到期）' : '⚡ condition（量门首发）'}</td>
            <td class="py-1.5 pr-3">${fmtTs(r.started_at)}</td>
            <td class="py-1.5 pr-3">${fmtTs(r.completed_at)}${r.completed_at ? `（${fmtDur(r)}）` : '<span class="text-gray-500">（进行中/未回填）</span>'}</td>
            <td class="py-1.5 pr-3">${r.rating == null ? '—' : `<span class="${r.rating === 2 || r.rating === 3 ? 'text-green-400' : 'text-red-400'}">${RATING_LABEL[r.rating] || r.rating}</span>`}</td>
            <td class="py-1.5 pr-3">${r.from_cache == null ? '—' : (r.from_cache ? '缓存命中' : '真跑')}</td>
            <td class="py-1.5 text-red-400">${this._escapeHtml(r.error || '')}</td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="mt-3 text-xs text-gray-500">无轮次留痕（legacy 直调腿 / 未触发新模型分析）</div>';

    body.innerHTML = `
      <div class="text-sm text-gray-300 mb-2">
        <div class="flex flex-wrap items-baseline">${detailBits.join('')}</div>
        ${triggerHtml}
        <div class="flex flex-wrap items-baseline mt-2">${finalBits.join('')}</div>
      </div>
      ${rows}`;
  }

  /**
   * 用最近一次窗口（散点图/K线图同口径）渲染 Holder 走势图
   * 窗口外数据剔除，保持三图 X 轴显示范围一致；窗口内无点时回退全量
   */
  _renderHolderForWindow() {
    if (!this._lastToken) return;
    const all = this._lastHolderSeries;
    if (!Array.isArray(all) || !all.length) {
      this.showHolderPlaceholder('暂无 Holder 数据');
      return;
    }
    const win = this._lastWindow;
    const windowed = win
      ? all.filter(p => Number.isFinite(p.t) && p.t >= win.trimStart && p.t <= win.trimEnd)
      : all;
    this.initHolderChart(windowed.length > 0 ? windowed : all, this._lastToken, win || undefined);
  }

  /**
   * Holder 走势图（ticks 重放重建版）
   * @param {Array<{t:number, holders:number}>} series 后端重放的 holder 时序（时间单调升）
   * @param {Object} token
   * @param {{trimStart:number, trimEnd:number}} [win] 当前展示窗口（信号标注只画窗口内）
   */
  initHolderChart(series, token, win) {
    try {
      const chartWrapper = document.getElementById('holder-chart-wrapper');
      if (chartWrapper) {
        chartWrapper.classList.remove('hidden');
        chartWrapper.style.display = 'block';
      }

      let canvas = document.getElementById('holder-chart');
      if (!canvas) {
        const chartContainer = chartWrapper ? chartWrapper.querySelector('.chart-container') : null;
        if (!chartContainer) {
          console.error('❌ 找不到 holder chart container');
          return;
        }
        canvas = document.createElement('canvas');
        canvas.id = 'holder-chart';
        chartContainer.innerHTML = '';
        chartContainer.appendChild(canvas);
      }
      canvas.style.display = 'block';

      if (this.holderChart) {
        this.holderChart.destroy();
        this.holderChart = null;
      }

      const points = series
        .filter(p => Number.isFinite(p.t) && Number.isFinite(p.holders))
        .map(p => ({ x: p.t, y: p.holders }));
      if (!points.length) {
        this.showHolderPlaceholder('暂无 Holder 数据');
        return;
      }

      // 信号标注：买卖垂直线直接画在信号时刻——不绑数据点宿主（降采样后点距
      // 可能远大于信号间隔，原时序版 30s 宿主匹配的形状在 ticks 重建版会丢标注）
      const annotations = [];
      const tokenSignals = this.signals.filter(s =>
        (s.token_address || s.tokenAddress) === token.address
      );
      tokenSignals.forEach(signal => {
        const signalTime = new Date(signal.timestamp || signal.created_at).getTime();
        if (!Number.isFinite(signalTime)) return;
        // 观察行不画买卖线（此前落 isBuy=false 被误标「卖出 ✗」）——
        // 由下方 _buildObserveAnnotations 专门画青虚线
        if (signal.signal_type === 'OBSERVE') return;
        if (win && (signalTime < win.trimStart || signalTime > win.trimEnd)) return;

        const signalType = signal.signal_type || signal.action?.toUpperCase();
        const isBuy = signalType === 'BUY';
        const isExecuted = signal.executed === true || signal.executed === 'true';

        let borderColor, borderWidth, borderDash, labelText;
        if (isExecuted) {
          borderColor = isBuy ? '#22c55e' : '#dc2626'; // 深绿/深红
          borderWidth = 3;
          borderDash = [];
          labelText = (isBuy ? '买入' : '卖出') + ' ✓';
        } else {
          borderColor = isBuy ? '#86efac' : '#fca5a5'; // 浅绿/浅红
          borderWidth = 2;
          borderDash = [5, 5];
          labelText = (isBuy ? '买入' : '卖出') + ' ✗';
        }

        annotations.push({
          type: 'line',
          xMin: signalTime,
          xMax: signalTime,
          yMin: 0,
          yMax: 'max',
          borderColor: borderColor,
          borderWidth: borderWidth,
          borderDash: borderDash,
          label: {
            display: true,
            content: labelText,
            position: 'start',
            backgroundColor: borderColor,
            color: '#fff',
            font: {
              size: isExecuted ? 12 : 11,
              weight: isExecuted ? 'bold' : 'normal'
            }
          }
        });
      });

      // 成交时刻细点线（双口径标注；Y 轴是 holders 数，只画线不放价格点位）
      const tradeMarks = this._buildTradeAnnotations(
        this._lastTokenTrades, tokenSignals,
        win ? win.trimStart : null, win ? win.trimEnd : null
      );
      tradeMarks.annotations.forEach(a => { a.yMin = 0; a.yMax = 'max'; });
      annotations.push(...tradeMarks.annotations);

      // 叙事分析轮次标注（C84）：析起/析毕虚线（Y 轴同款全幅）
      const narrativeMarks = this._buildNarrativeRoundAnnotations(
        this._lastNarrativeRounds, win ? win.trimStart : null, win ? win.trimEnd : null
      );
      narrativeMarks.forEach(a => { a.yMin = 0; a.yMax = 'max'; });
      annotations.push(...narrativeMarks);

      // 观察信号时刻标注（OBSERVE）：青虚线（Y 轴同款全幅）
      const observeMarks = this._buildObserveAnnotations(
        this._lastObserveSignals, win ? win.trimStart : null, win ? win.trimEnd : null
      );
      observeMarks.forEach(a => { a.yMin = 0; a.yMax = 'max'; });
      annotations.push(...observeMarks);

      // 反作弊判定时刻标注（G12）：点虚线按 grade 着色（Y 轴同款全幅）
      const cheatMarks = this._buildCheatAnnotations(
        this._lastCheatDetections, win ? win.trimStart : null, win ? win.trimEnd : null
      );
      cheatMarks.forEach(a => { a.yMin = 0; a.yMax = 'max'; });
      annotations.push(...cheatMarks);

      const ctx = canvas.getContext('2d');
      this.holderChart = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: [{
            label: `${token.symbol || ''} Holders`,
            data: points,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: {
            annotation: {
              annotations: annotations
            },
            legend: {
              display: true,
              position: 'top'
            },
            tooltip: {
              callbacks: {
                title(items) {
                  if (!items.length) return '';
                  return new Date(items[0].parsed.x).toLocaleString('zh-CN');
                },
                label: (context) => {
                  const value = context.parsed.y;
                  return (value !== null && value !== undefined) ? `Holders: ${value}` : 'Holders: N/A';
                }
              }
            }
          },
          scales: {
            x: {
              type: 'time',
              time: {
                displayFormats: {
                  minute: 'HH:mm',
                  hour: 'MM-dd HH:mm'
                }
              },
              title: {
                display: true,
                text: '时间'
              }
            },
            y: {
              type: 'linear',
              display: true,
              beginAtZero: true,
              title: {
                display: true,
                text: 'Holders 数量'
              }
            }
          }
        }
      });

      console.log(`✅ Holder 走势图已初始化（ticks 重建），${points.length} 个数据点 / ${annotations.length} 个信号标记`);
    } catch (error) {
      console.error('❌ initHolderChart 失败:', error);
      this.showHolderPlaceholder('图表初始化失败: ' + error.message);
    }
  }

  /**
   * 显示 Holder 图表占位符
   * @param {string} message - 提示消息
   */
  showHolderPlaceholder(message) {
    const chartWrapper = document.getElementById('holder-chart-wrapper');
    if (!chartWrapper) return;
    // 有占位仍展示卡片区域（用户已知该 token 无 Holder 数据，而非图被删了）
    chartWrapper.classList.remove('hidden');
    chartWrapper.style.display = 'block';
    const chartContainer = chartWrapper.querySelector('.chart-container');
    if (chartContainer) {
      chartContainer.innerHTML = `
        <div id="holder-chart-placeholder" class="flex items-center justify-center h-full text-gray-400">${message}</div>
      `;
    }
    if (this.holderChart) {
      this.holderChart.destroy();
      this.holderChart = null;
    }
  }

  /**
   * Tick 交易散点图 — 每个 tick 一个气泡（半径=BNB 交易额），买卖信号垂直线标注
   * 画法移植自 pumpfun-wss-trader（BNB 计价适配）
   */
  initBubbleChart(tickData, token) {
    try {
      const chartWrapper = document.getElementById('kline-chart-wrapper');
      if (chartWrapper) chartWrapper.style.display = 'block';

      const placeholder = document.getElementById('kline-chart-placeholder');
      if (placeholder) placeholder.style.display = 'none';

      let canvas = document.getElementById('kline-chart');
      if (!canvas) {
        const chartContainer = document.querySelector('.chart-container');
        if (!chartContainer) return;
        canvas = document.createElement('canvas');
        canvas.id = 'kline-chart';
        chartContainer.innerHTML = '';
        chartContainer.appendChild(canvas);
      }
      canvas.style.display = 'block';

      if (this.chart) { this.chart.destroy(); this.chart = null; }

      const ctx = canvas.getContext('2d');

      // 缓存原始数据，供 tick 时间窗口切换时重渲染（不重新 fetch）
      this._lastTickData = tickData;
      this._lastToken = token;

      // 窗口裁剪 + 信号时间范围由共享 helper 计算（K线图与散点图同口径）
      const { trimmed: trimmedTickData, trimStart, trimEnd, tokenSignals } =
        this._trimTicksByWindow(tickData, token);

      // 分离买卖 tick（过滤极小交易，价格精度不足）
      const buys = [], sells = [];
      const MIN_BNB = 0.005; // 小额 tick 价格精度不足
      // 🔥 famous/🧠聪明钱/⚙️机器 操作点位（与主气泡同口径独立构建；主 buys/sells 剔除已标记行防
      // 双计（图例计数/悬停双气泡），famous 金/紫独立气泡叠最顶层、聪明钱青/粉次层、机器橙/棕第三层）
      const famousMarks = this._buildFamousPoints(trimmedTickData);
      const smartMarks = this._buildSmartPoints(trimmedTickData);
      const arbbotMarks = this._buildArbBotPoints(trimmedTickData);
      const markedKeys = new Set([
        ...famousMarks.buyPoints, ...famousMarks.sellPoints,
        ...smartMarks.buyPoints, ...smartMarks.sellPoints,
        ...arbbotMarks.buyPoints, ...arbbotMarks.sellPoints,
      ].map(p => `${p.x}|${(p._famous || p._smart || p._arbbot).wallet}`));
      for (const tick of trimmedTickData) {
        const bnbAmount = parseFloat(tick.bnb_amount) || 0;
        if (bnbAmount < MIN_BNB) continue;

        const priceUsd = parseFloat(tick.price_usd);
        if (!priceUsd || priceUsd <= 0) continue;

        const timestamp = new Date(tick.block_time).getTime();

        // famous/聪明钱行已进独立数据集，主数据集跳过
        const wallet = (tick.sender_address || tick.trader_address || '').toLowerCase();
        if (markedKeys.has(`${timestamp}|${wallet}`)) continue;

        const point = {
          x: timestamp,
          y: priceUsd,
          r: this._mapTickRadius(bnbAmount),
          _raw: tick,
        };

        if (tick.trade_type === 'buy') buys.push(point);
        else sells.push(point);
      }

      // GMGN 画像预取（图表气泡 hover tooltip 展示——tooltip 回调同步读缓存，
      // 2026-11-26 用户需求「鼠标放到图表交易圆圈上展示 GMGN 画像」）
      this._prefetchGmgnProfiles([
        ...buys, ...sells,
        ...famousMarks.buyPoints, ...famousMarks.sellPoints,
        ...smartMarks.buyPoints, ...smartMarks.sellPoints,
        ...arbbotMarks.buyPoints, ...arbbotMarks.sellPoints,
      ]);

      // 信号标注（仅展示当前裁剪窗口内的信号，避免窗口外的信号垂直线撑开 X 轴）
      // + 成交标注（双口径）：细点线并入；成交价点位（▲买/▼卖）以 scatter 叠加
      // + 叙事轮次标注（C84）：析起/析毕虚线
      // + 观察信号时刻标注（OBSERVE）：青虚线
      const annotations = this._buildSignalAnnotations(tokenSignals, trimStart, trimEnd);
      const tradeMarks = this._buildTradeAnnotations(this._lastTokenTrades, tokenSignals, trimStart, trimEnd);
      annotations.push(...tradeMarks.annotations);
      annotations.push(...this._buildNarrativeRoundAnnotations(this._lastNarrativeRounds, trimStart, trimEnd));
      annotations.push(...this._buildObserveAnnotations(this._lastObserveSignals, trimStart, trimEnd));
      annotations.push(...this._buildCheatAnnotations(this._lastCheatDetections, trimStart, trimEnd));

      // 🎯 钱包聚焦（2026-11-22）：气泡颜色走 scriptable——聚焦激活时非该钱包
      // 气泡统一灰淡、命中气泡原色加浓（alpha→1），图例（dataset 级 context 无 raw）
      // 与成交▲▼点（无钱包语义）保持原色不受影响。窗口切换重渲染后 scriptable
      // 读的是 this._walletFocus 实时值，颜色自动跟随无需重建。
      const FOCUS_DIM_BG = 'rgba(148,163,184,0.10)';
      const FOCUS_DIM_BORDER = 'rgba(148,163,184,0.22)';
      const focusBg = (base, hi) => ctx => {
        if (!this._walletFocus) return base;
        const w = this._pointWallet(ctx.raw);
        return w == null ? base : (w === this._walletFocus ? hi : FOCUS_DIM_BG);
      };
      const focusBd = (base, hi) => ctx => {
        if (!this._walletFocus) return base;
        const w = this._pointWallet(ctx.raw);
        return w == null ? base : (w === this._walletFocus ? hi : FOCUS_DIM_BORDER);
      };

      this.chart = new Chart(ctx, {
        type: 'bubble',
        data: {
          datasets: [
            // 🔥 famous 独立气泡（金=买/紫=卖）：Chart.js 倒序绘制——排最前=叠在普通气泡顶层
            {
              label: `⭐Famous买 (${famousMarks.buyPoints.length})`,
              data: famousMarks.buyPoints,
              backgroundColor: focusBg('rgba(250,204,21,0.9)', 'rgba(250,204,21,1)'),
              borderColor: focusBd('#b45309', '#fbbf24'),
              borderWidth: 1.5,
            },
            {
              label: `⭐Famous卖 (${famousMarks.sellPoints.length})`,
              data: famousMarks.sellPoints,
              backgroundColor: focusBg('rgba(192,132,252,0.9)', 'rgba(192,132,252,1)'),
              borderColor: focusBd('#6b21a8', '#c084fc'),
              borderWidth: 1.5,
            },
            // 🧠 聪明钱独立气泡（青=买/粉=卖）：famous 之下次层（交集钱包已归 famous）
            {
              label: `🧠聪明钱买 (${smartMarks.buyPoints.length})`,
              data: smartMarks.buyPoints,
              backgroundColor: focusBg('rgba(14,165,233,0.9)', 'rgba(14,165,233,1)'),
              borderColor: focusBd('#0c4a6e', '#38bdf8'),
              borderWidth: 1.5,
            },
            {
              label: `🧠聪明钱卖 (${smartMarks.sellPoints.length})`,
              data: smartMarks.sellPoints,
              backgroundColor: focusBg('rgba(244,114,182,0.9)', 'rgba(244,114,182,1)'),
              borderColor: focusBd('#831843', '#f472b6'),
              borderWidth: 1.5,
            },
            // ⚙️ 机器钱包独立气泡（橙=买/棕=卖）：第三层（交集钱包已归 famous/聪明钱上层）
            {
              label: `⚙️机器买 (${arbbotMarks.buyPoints.length})`,
              data: arbbotMarks.buyPoints,
              backgroundColor: focusBg('rgba(249,115,22,0.9)', 'rgba(249,115,22,1)'),
              borderColor: focusBd('#7c2d12', '#fb923c'),
              borderWidth: 1.5,
            },
            {
              label: `⚙️机器卖 (${arbbotMarks.sellPoints.length})`,
              data: arbbotMarks.sellPoints,
              backgroundColor: focusBg('rgba(180,83,9,0.9)', 'rgba(180,83,9,1)'),
              borderColor: focusBd('#fdba74', '#fdba74'),
              borderWidth: 1.5,
            },
            {
              label: `Buy (${buys.length})`,
              data: buys,
              backgroundColor: focusBg('rgba(34,197,94,0.65)', 'rgba(34,197,94,0.95)'),
              borderColor: focusBd('rgba(22,163,74,0.9)', 'rgba(34,197,94,1)'),
              borderWidth: 1,
            },
            {
              label: `Sell (${sells.length})`,
              data: sells,
              backgroundColor: focusBg('rgba(239,68,68,0.65)', 'rgba(239,68,68,0.95)'),
              borderColor: focusBd('rgba(220,38,38,0.9)', 'rgba(248,113,113,1)'),
              borderWidth: 1,
            },
            {
              label: `成交▲ (${tradeMarks.buyPoints.length})`,
              data: tradeMarks.buyPoints,
              type: 'scatter',
              pointStyle: 'triangle',
              radius: 8,
              hoverRadius: 10,
              backgroundColor: 'rgba(21,128,61,0.95)',
              borderColor: '#bbf7d0',
              borderWidth: 1.5,
            },
            {
              label: `成交▼ (${tradeMarks.sellPoints.length})`,
              data: tradeMarks.sellPoints,
              type: 'scatter',
              pointStyle: 'triangle',
              rotation: 180,
              radius: 8,
              hoverRadius: 10,
              backgroundColor: 'rgba(185,28,28,0.95)',
              borderColor: '#fecaca',
              borderWidth: 1.5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 400 },
          // 🎯 钱包聚焦：点击气泡=聚焦/取消该钱包（其它气泡灰淡）；点空白=取消；
          // 悬停气泡 cursor=pointer 提示可点。图例区点击走图例自身显隐逻辑，不触发。
          onClick: (evt, elements, chart) => this._handleBubbleClick(evt, elements, chart),
          onHover: (evt, elements) => {
            const target = evt.native && evt.native.target;
            if (target) target.style.cursor = (elements && elements.length) ? 'pointer' : 'default';
          },
          plugins: {
            annotation: { annotations },
            legend: { display: true, position: 'top', labels: { boxWidth: 12, padding: 12 } },
            tooltip: {
              callbacks: {
                title(items) {
                  if (!items.length) return '';
                  return new Date(items[0].raw.x).toLocaleString('zh-CN');
                },
                label: (item) => {
                  // 成交点（双口径标注）：展示成交价/信号价/延迟/滑移，与 tick 气泡（_raw）区分
                  if (item.raw._trade) {
                    const t = item.raw;
                    const price = t.y;
                    const lines = [
                      `${t._trade.trade_direction === 'buy' ? '成交▲ BUY' : '成交▼ SELL'} | $${price.toExponential(3)}`,
                    ];
                    if (t._signalPrice != null) lines.push(`信号价: $${t._signalPrice.toExponential(3)}`);
                    if (t._delaySec != null) lines.push(`信号→成交延迟: ${t._delaySec.toFixed(1)}s`);
                    if (t._slipPct != null) lines.push(`价差: ${t._slipPct >= 0 ? '+' : ''}${t._slipPct.toFixed(2)}%`);
                    return lines;
                  }
                  // ⭐ famous 气泡：GMGN 用户名+钱包地址+金额（镜像分化复盘=看谁在买卖）
                  if (item.raw._famous) {
                    const f = item.raw._famous;
                    const w = f.wallet;
                    const lines = [
                      `⭐Famous ${f.tradeType || ''} | ${f.bnb.toFixed(4)} BNB`,
                      `Price: $${item.raw.y.toExponential(3)}`,
                    ];
                    if (f.label) lines.push(f.label);
                    lines.push(`钱包: ${w.slice(0, 8)}…${w.slice(-6)}`);
                    return lines;
                  }
                  // 🧠 聪明钱气泡：twitter/标签+钱包地址+金额（GMGN smartmoney 流名单）
                  if (item.raw._smart) {
                    const f = item.raw._smart;
                    const w = f.wallet;
                    const lines = [
                      `🧠聪明钱 ${f.tradeType || ''} | ${f.bnb.toFixed(4)} BNB`,
                      `Price: $${item.raw.y.toExponential(3)}`,
                    ];
                    if (f.label) lines.push(f.label);
                    if (f.tags && f.tags.length) lines.push(`标签: ${f.tags.join(',')}`);
                    if (f.hits) lines.push(`GMGN流: ${f.hits} 次 / $${f.usd >= 1000 ? (f.usd / 1000).toFixed(1) + 'k' : f.usd.toFixed(0)}`);
                    lines.push(`钱包: ${w.slice(0, 8)}…${w.slice(-6)}`);
                    return lines;
                  }
                  // ⚙️ 机器钱包气泡：画像标签+30d 统计+钱包地址+金额（T198 arbBot 集）
                  if (item.raw._arbbot) {
                    const f = item.raw._arbbot;
                    const w = f.wallet;
                    const lines = [
                      `⚙️机器钱包 ${f.tradeType || ''} | ${f.bnb.toFixed(4)} BNB`,
                      `Price: $${item.raw.y.toExponential(3)}`,
                    ];
                    if (f.tags && f.tags.length) lines.push(`标签: ${f.tags.join(',')}`);
                    const s = f.stats;
                    if (s && (s.buyCount || s.sellCount)) {
                      const win = s.winrate != null ? `胜率${Math.round(s.winrate * 100)}%` : '';
                      const pnl = s.realizedProfitUsd != null
                        ? `已实现${s.realizedProfitUsd >= 0 ? '+' : '−'}$${Math.abs(s.realizedProfitUsd) >= 1000 ? (Math.abs(s.realizedProfitUsd) / 1000).toFixed(1) + 'k' : Math.abs(s.realizedProfitUsd).toFixed(0)}` : '';
                      lines.push(`30d: 买${s.buyCount}/卖${s.sellCount} · ${s.tokenNum}票 ${win ? '· ' + win : ''} ${pnl}`.trimEnd());
                    }
                    lines.push(`钱包: ${w.slice(0, 8)}…${w.slice(-6)}`);
                    return lines;
                  }
                  const raw = item.raw._raw;
                  const bnb = (parseFloat(raw.bnb_amount) || 0).toFixed(4);
                  const price = parseFloat(raw.price_usd || 0);
                  // 钱包显示=发送者优先：sender_address（tx.from 真实 EOA）→ trader_address 回落
                  const walletFull = (raw.sender_address || raw.trader_address || '').toLowerCase();
                  const wallet = walletFull ? walletFull.slice(0, 8) + '...' : '';
                  const lines = [
                    `${raw.trade_type === 'buy' ? 'BUY' : 'SELL'} | ${bnb} BNB`,
                    `Price: $${price.toExponential(3)}`,
                    `钱包: ${wallet}`,
                  ];
                  // GMGN 画像（2026-11-26 作弊盘 review：hover 交易圆圈即看买家画像）
                  if (walletFull) {
                    const prof = this._gmgnProfiles.get(walletFull);
                    if (prof) {
                      const wr = prof.winrate != null ? (100 * Number(prof.winrate)).toFixed(0) + '%' : '—';
                      const profit = prof.realized_profit != null ? Number(prof.realized_profit).toFixed(1) + 'B' : '—';
                      const tags = Array.isArray(prof.tags) ? prof.tags.join(', ') : (prof.tags ? String(prof.tags) : '');
                      const created = prof.created_at_sec ? new Date(Number(prof.created_at_sec) * 1000).toISOString().slice(0, 10) : '—';
                      lines.push(`GMGN: 胜率${wr} · 利润${profit} · ${prof.token_num ?? '—'}票 · 建册${created}`);
                      if (tags) lines.push(`标签: ${tags}`);
                    } else {
                      lines.push('GMGN: 无画像');
                    }
                  }
                  return lines;
                },
              },
            },
          },
          scales: {
            x: {
              type: 'time',
              time: {
                tooltipFormat: 'HH:mm:ss',
                displayFormats: { second: 'HH:mm:ss', minute: 'HH:mm' },
              },
              ticks: { font: { size: 10 }, maxTicksLimit: 12 },
              title: { display: true, text: '时间' },
            },
            y: {
              type: 'logarithmic',
              title: { display: true, text: 'Price (USD)' },
              ticks: {
                font: { size: 10 },
                callback(v) {
                  if (v >= 1) return '$' + v.toFixed(2);
                  if (v >= 0.001) return '$' + v.toPrecision(2);
                  return '$' + v.toExponential(1);
                },
              },
            },
          },
        },
      });

      console.log(`✅ Bubble chart initialized: ${buys.length} buys, ${sells.length} sells, ${annotations.length} annotations`);

      // 🎯 钱包聚焦：切票自动清除旧聚焦（跨票聚焦无意义）；重渲染（窗口切换/全量
      // 加载）后数据集是新建对象——气泡缩放需重放，聚焦条统计也按新窗口重算
      if (this._walletFocus && this._walletFocusToken !== token.address) this._clearWalletFocus();
      this._applyWalletFocusScale(this.chart);
      this._refreshWalletFocusChip();

    } catch (error) {
      console.error('❌ initBubbleChart 失败:', error);
      this.showKlinePlaceholder('图表初始化失败: ' + error.message);
    }
  }

  /**
   * 🎯 钱包聚焦（2026-11-22）：图表点位 → 钱包地址（小写；无钱包语义返回 null）。
   * 口径 = sender_address || trader_address（与 FA/名单标记构建器一致——解析失败
   * 回退 trader=聚合路由，点它=聚焦全部路由行，与绘制口径诚实一致）。
   * 成交▲▼点（本实验自身成交）无钱包语义返回 null——点击不聚焦、聚焦不变灰。
   */
  _pointWallet(pt) {
    if (!pt || typeof pt !== 'object') return null;
    if (pt._famous) return pt._famous.wallet || null;
    if (pt._smart) return pt._smart.wallet || null;
    if (pt._arbbot) return pt._arbbot.wallet || null;
    if (pt._raw) return (pt._raw.sender_address || pt._raw.trader_address || '').toLowerCase() || null;
    return null;
  }

  /**
   * GMGN 画像预取（2026-11-26）：图表气泡钱包批量查画像进 this._gmgnProfiles 缓存，
   * tooltip label 回调同步读（fetch 异步——tooltip 每次 hover 重新回调，画像到达
   * 后自动出现在下一次 hover）。失败静默（tooltip 显示无画像，不炸图）。
   */
  async _prefetchGmgnProfiles(points) {
    const wallets = [...new Set(points.map((p) => this._pointWallet(p)).filter(Boolean))];
    if (!wallets.length) return;
    try {
      const missing = wallets.filter((w) => !this._gmgnProfiles.has(w));
      if (!missing.length) return;
      const r = await fetch(`/api/gmgn-wallet-profiles?wallets=${encodeURIComponent(missing.slice(0, 100).join(','))}`);
      const d = await r.json();
      if (!d.success) return;
      for (const [w, prof] of Object.entries(d.data || {})) this._gmgnProfiles.set(w.toLowerCase(), prof);
      // 有值时 chart.update() 刷新（hover 中 tooltip 立即补显）
      if (this.chart) this.chart.update('none');
    } catch (e) { /* 静默：画像查询失败不影响图表 */ }
  }

  /** 🎯 图表点位 → {side:'buy'|'sell', bnb:number}（聚焦条统计用；非 tick 点返回 null） */
  _pointSideBnb(pt) {
    if (pt._famous || pt._smart || pt._arbbot) {
      const m = pt._famous || pt._smart || pt._arbbot;
      return { side: m.tradeType === '买' ? 'buy' : 'sell', bnb: Number(m.bnb) || 0 };
    }
    if (pt._raw) {
      return { side: pt._raw.trade_type === 'buy' ? 'buy' : 'sell', bnb: parseFloat(pt._raw.bnb_amount) || 0 };
    }
    return null;
  }

  /** 🎯 散点图点击：气泡 → 聚焦/切换取消该钱包；空白 → 取消聚焦 */
  _handleBubbleClick(evt, elements, chart) {
    // 图例区点击走图例自身显隐逻辑，不当空白处理（防点击图例误清聚焦）
    const lg = chart.legend;
    if (lg && evt.x >= lg.left && evt.x <= lg.right && evt.y >= lg.top && evt.y <= lg.bottom) return;
    const el = elements && elements[0];
    if (!el) {
      if (this._walletFocus) this._clearWalletFocus();
      return;
    }
    const ds = chart.data.datasets[el.datasetIndex];
    const pt = ds && Array.isArray(ds.data) ? ds.data[el.index] : null;
    const w = this._pointWallet(pt);
    if (!w) return; // 成交▲▼等无钱包点位：不聚焦也不打断现有聚焦
    if (this._walletFocus === w) { this._clearWalletFocus(); return; }
    this._setWalletFocus(w);
  }

  _setWalletFocus(wallet) {
    this._walletFocus = wallet;
    this._walletFocusToken = this._lastToken ? this._lastToken.address : null;
    this._applyWalletFocusScale(this.chart);
    if (this.chart) this.chart.update();
    this._refreshWalletFocusChip();
  }

  _clearWalletFocus() {
    if (!this._walletFocus) { this._refreshWalletFocusChip(); return; }
    this._walletFocus = null;
    this._walletFocusToken = null;
    this._applyWalletFocusScale(this.chart);
    if (this.chart) this.chart.update();
    this._refreshWalletFocusChip();
  }

  /**
   * 🎯 聚焦气泡放大 1.4x（在灰淡背景上视觉跳出）；取消时还原。bubble 的 r 在点
   * 数据上（非 option），首次缩放前把原值记到 _rBase——窗口切换重建数据集后新点
   * 无 _rBase 自动补记，取消时精确还原。scatter 型成交▲▼点 typeof r !== 'number'
   * 天然跳过。
   */
  _applyWalletFocusScale(chart) {
    if (!chart) return;
    const on = !!this._walletFocus;
    for (const ds of (chart.data.datasets || [])) {
      if (!Array.isArray(ds.data)) continue;
      for (const pt of ds.data) {
        if (!pt || typeof pt !== 'object' || typeof pt.r !== 'number') continue;
        const w = this._pointWallet(pt);
        if (w == null) continue;
        if (pt._rBase == null) pt._rBase = pt.r;
        pt.r = (on && w === this._walletFocus)
          ? Math.max(pt._rBase * 1.4, pt._rBase + 2)
          : pt._rBase;
      }
    }
  }

  /**
   * 🎯 聚焦信息条：钱包地址 + GMGN 跳转 + 买/卖笔数与 BNB + 净买 + 首末笔时刻——
   * 直接回答「这个钱包啥时候建仓、啥时候卖」。统计基于当前画出的点位（与用户
   * 所见同口径：famous/聪明钱/机器标记点已从主数据集剔重，不会双计）。
   */
  _refreshWalletFocusChip() {
    const chip = document.getElementById('wallet-focus-chip');
    if (!chip) return;
    if (!this._walletFocus || !this.chart) {
      chip.classList.add('hidden');
      chip.innerHTML = '';
      return;
    }
    const stats = { buyN: 0, sellN: 0, buyBnb: 0, sellBnb: 0, firstMs: null, lastMs: null };
    for (const ds of (this.chart.data.datasets || [])) {
      if (!Array.isArray(ds.data)) continue;
      for (const pt of ds.data) {
        if (!pt || typeof pt !== 'object') continue;
        if (this._pointWallet(pt) !== this._walletFocus) continue;
        const sb = this._pointSideBnb(pt);
        if (!sb) continue;
        if (sb.side === 'buy') { stats.buyN++; stats.buyBnb += sb.bnb; }
        else { stats.sellN++; stats.sellBnb += sb.bnb; }
        if (stats.firstMs == null || pt.x < stats.firstMs) stats.firstMs = pt.x;
        if (stats.lastMs == null || pt.x > stats.lastMs) stats.lastMs = pt.x;
      }
    }
    const w = this._walletFocus;
    const net = stats.buyBnb - stats.sellBnb;
    const fmtT = ms => ms == null ? '-' : new Date(ms).toLocaleString('zh-CN', { hour12: false });
    const chain = (typeof this.getGMGNBlockchain === 'function' && this.blockchain)
      ? this.getGMGNBlockchain(this.blockchain) : 'bsc';
    chip.innerHTML = `
      <span>🎯</span>
      <span class="font-mono text-gray-100" title="${w}">${w.slice(0, 10)}…${w.slice(-8)}</span>
      <a href="https://gmgn.ai/${chain}/address/${w}" target="_blank"
         class="text-blue-400 hover:text-blue-300 underline" title="GMGN 查看该钱包">GMGN ↗</a>
      <span class="text-green-400">买 ${stats.buyN} 笔 / ${stats.buyBnb.toFixed(3)} BNB</span>
      <span class="text-red-400">卖 ${stats.sellN} 笔 / ${stats.sellBnb.toFixed(3)} BNB</span>
      <span class="${net >= 0 ? 'text-green-400' : 'text-red-400'}">净买 ${net >= 0 ? '+' : '−'}${Math.abs(net).toFixed(3)} BNB</span>
      <span class="text-gray-400">首笔 ${fmtT(stats.firstMs)} · 末笔 ${fmtT(stats.lastMs)}</span>
      <button id="wallet-focus-clear" class="px-2 py-0.5 bg-gray-600 hover:bg-gray-500 rounded text-xs text-white">✕ 取消</button>
      <span class="text-xs text-gray-500">再点该钱包气泡或点空白处也可取消</span>`;
    chip.classList.remove('hidden');
    const clearBtn = document.getElementById('wallet-focus-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => this._clearWalletFocus());
  }

  /**
   * 窗口裁剪：决定散点图/K线图实际展示的 tick 子集与时间范围（两者同口径）
   *   0) 全量模式（_fullTickRange，点「加载全量」）→ 窗口 = ticks ∪ 全部信号时间范围（首末信号±5分钟）
   *   1) 用户设了 tickWindowSec → 只保留代币发出后 [0, N秒] 内的 ticks
   *   2) 否则有信号 → 以首次信号为中心 ±5 分钟（不足 10 条放宽到 ±10 分钟）
   *   3) 都没有 → 全量
   * @returns {{trimmed:Array, trimStart:number|null, trimEnd:number|null, tokenSignals:Array}}
   */
  _trimTicksByWindow(tickData, token) {
    const tokenSignals = (this.signals || []).filter(s =>
      (s.token_address || s.tokenAddress) === token.address
    );
    // 观察信号时刻也是本 token 的信号时刻：并入窗口框架（首末信号±5min）——
    // action 筛选视图 this.signals 无 OBSERVE 行，不并入则观察标注会被窗口过滤剔掉
    const observeTimes = (this._lastObserveSignals || [])
      .map(s => new Date(s.timestamp || s.created_at).getTime())
      .filter(Number.isFinite);
    const firstTickTime = tickData.length > 0
      ? Math.min(...tickData.map(t => new Date(t.block_time).getTime()))
      : null;

    if (this._fullTickRange) {
      // 全量模式：数据已分页拉全（信号区间的 ticks 可能在单页之后），
      // 但展示窗口只框住交易区间 = [首信号, 末信号] ± 5 分钟——窗口外的 ticks 裁掉不画，
      // 避免 token 生命周期后段的长尾交易把 X 轴拉得过长、交易区被压窄看不见
      const signalTimes = tokenSignals
        .map(s => new Date(s.timestamp || s.created_at).getTime())
        .filter(Number.isFinite)
        .concat(observeTimes);
      if (signalTimes.length) {
        const PAD = 5 * 60 * 1000; // 前后各延长 5 分钟（与默认窗口 ±5min 同量级）
        const trimStart = Math.min(...signalTimes) - PAD;
        const trimEnd = Math.max(...signalTimes) + PAD;
        const trimmed = tickData.filter(t => {
          const ms = new Date(t.block_time).getTime();
          return Number.isFinite(ms) && ms >= trimStart && ms <= trimEnd;
        });
        this._lastWindow = { trimStart, trimEnd };
        return { trimmed, trimStart, trimEnd, tokenSignals };
      }
      // 无信号：退化为全量展示（几万条 ticks 用循环求 min/max——Math.min(...arr) spread 会栈溢出）
      let trimStart = firstTickTime;
      let trimEnd = firstTickTime;
      for (const t of tickData) {
        const ms = new Date(t.block_time).getTime();
        if (!Number.isFinite(ms)) continue;
        if (trimStart == null || ms < trimStart) trimStart = ms;
        if (trimEnd == null || ms > trimEnd) trimEnd = ms;
      }
      this._lastWindow = { trimStart, trimEnd };
      return { trimmed: tickData, trimStart, trimEnd, tokenSignals };
    }

    let trimmed = tickData;
    if (this.tickWindowSec != null && this.tickWindowSec > 0 && firstTickTime != null) {
      // 用户指定时间窗口：只展示代币发出后 [0, N秒] 内的 ticks
      const windowEnd = firstTickTime + this.tickWindowSec * 1000;
      trimmed = tickData.filter(t => new Date(t.block_time).getTime() <= windowEnd);
    } else if ((tokenSignals.length > 0 || observeTimes.length > 0) && tickData.length > 0) {
      // 默认：首末信号区间 ±5 分钟（覆盖全部轮次信号；只取首信号±5min 会漏掉
      // 稍晚于首信号+5min 的卖出信号——4PAY 场景末信号恰在首信号+5min 之外；
      // 纯观察票无买卖信号时以观察时刻定窗）
      const signalTimes = tokenSignals
        .map(s => new Date(s.timestamp || s.created_at).getTime())
        .filter(Number.isFinite)
        .concat(observeTimes);
      const firstSignalTime = signalTimes.length ? Math.min(...signalTimes) : null;
      const lastSignalTime = signalTimes.length ? Math.max(...signalTimes) : null;
      if (firstSignalTime != null && lastSignalTime != null) {
        const WINDOW_MS = 5 * 60 * 1000;
        trimmed = tickData.filter(t => {
          const tTime = new Date(t.block_time).getTime();
          return tTime >= firstSignalTime - WINDOW_MS && tTime <= lastSignalTime + WINDOW_MS;
        });
        // 窗口内数据太少（<10 条），放宽到 ±10 分钟
        if (trimmed.length < 10) {
          const wideWindow = 10 * 60 * 1000;
          trimmed = tickData.filter(t => {
            const tTime = new Date(t.block_time).getTime();
            return tTime >= firstSignalTime - wideWindow && tTime <= lastSignalTime + wideWindow;
          });
        }
      }
    }

    const trimTimes = trimmed.map(t => new Date(t.block_time).getTime());
    const trimStart = trimTimes.length > 0 ? Math.min(...trimTimes) : null;
    const trimEnd = trimTimes.length > 0 ? Math.max(...trimTimes) : null;
    this._lastWindow = { trimStart, trimEnd };
    return { trimmed, trimStart, trimEnd, tokenSignals };
  }

  /**
   * 生成买卖信号垂直线标注（仅保留落在 [trimStart, trimEnd] 窗口内的信号，
   * 避免窗口外信号锚定 X 轴导致轴范围不随过滤收缩）。
   * 无文字标签（2026-11-21 用户裁定撤除：顶部 BUY/SELL 文字挡成交信息）——
   * 语义全由线体编码：绿/红=买/卖，实线 3px=已成交，虚线=未成交，靛蓝虚线=SELL 拦截。
   */
  _buildSignalAnnotations(tokenSignals, trimStart, trimEnd) {
    // 同刻信号（回测 created_at=block_time 秒精度，BSC 0.75s 出块同秒先买后卖常见）
    // 垂直线完全重叠只见后画的。排序保持「同刻 buy 在前 sell 后画」（与信号列表
    // tie-break 同口径）=重叠时红盖绿，与撤标签前的可见行为一致。
    const inWindow = [];
    tokenSignals.forEach(signal => {
      const signalTime = new Date(signal.timestamp || signal.created_at).getTime();
      if (Number.isNaN(signalTime)) return;
      // 观察行不画买卖线（单票视图 this.signals 含 OBSERVE 行，此前落
      // isBuy=false 被误标「SELL ✗」）——由 _buildObserveAnnotations 专门画
      if (signal.signal_type === 'OBSERVE') return;
      if (trimStart != null && trimEnd != null && (signalTime < trimStart || signalTime > trimEnd)) return;
      inWindow.push({ signal, signalTime });
    });
    inWindow.sort((a, b) =>
      (a.signalTime - b.signalTime)
      || ((a.signal.action === 'buy' ? 0 : 1) - (b.signal.action === 'buy' ? 0 : 1))
    );

    const annotations = [];
    for (const { signal, signalTime } of inWindow) {
      const signalType = signal.signal_type || signal.action?.toUpperCase();
      const isBuy = signalType === 'BUY';
      const isExecuted = signal.executed === true || signal.executed === 'true';
      // T157 因子卖出过滤拦截（famous HOLD）：靛蓝虚线——区别「SELL ✗ 失败」
      // （拦截=延缓卖出，后续放行会再卖，非执行失败）
      const isBlocked = signal.execution_status === 'blocked';
      const borderColor = isBlocked ? '#6366f1'
        : isExecuted
          ? (isBuy ? '#22c55e' : '#dc2626')
          : (isBuy ? '#86efac' : '#fca5a5');
      annotations.push({
        type: 'line',
        xMin: signalTime,
        xMax: signalTime,
        borderColor,
        borderWidth: isExecuted ? 3 : 2,
        borderDash: isExecuted ? [] : [5, 5],
      });
    }
    return annotations;
  }

  /**
   * 生成成交标注（2026-10-15 双口径裁定）：成交时刻细点线 + 成交价点位（▲买/▼卖）。
   * 时刻 = executed_at || created_at（回测/虚拟 executed_at=NULL → created_at=回放
   * 历史时间；不可用 metadata.executed_at=回测墙钟）。窗口外剔除（防撑开 X 轴，
   * 与信号标注同门）。返回 {annotations, buyPoints, sellPoints}——点位 y=unit_price
   * （USD，与散点图气泡/K线价格轴同刻度）；Holder 图 Y 轴是 holders 数，只取
   * annotations（细线）不放点位。
   */
  _buildTradeAnnotations(trades, tokenSignals, trimStart, trimEnd) {
    const annotations = [];
    const buyPoints = [], sellPoints = [];
    if (!Array.isArray(trades)) return { annotations, buyPoints, sellPoints };

    // signal_id 精确配对（延迟/滑移=成交 vs 信号两套口径的分叉可见化；配不上不显示）
    const signalById = new Map();
    for (const s of (tokenSignals || [])) {
      if (s && s.id) signalById.set(s.id, s);
    }

    // 窗口校验带 ±5min 缓冲：窗口边界=窗内 ticks 边界，而断流票的止损卖出可能发生在
    // 最后一个 tick 之后（0xc7fe 案实测晚 8.2s）——成交紧随信号且条数极少（≤几条），
    // 轻微扩轴可接受；缓冲外仍剔除（防异常长尾记录撑开 X 轴）
    const PAD = 5 * 60 * 1000;

    trades.forEach(trade => {
      const execMs = new Date(trade.executed_at || trade.created_at).getTime();
      if (!Number.isFinite(execMs)) return;
      if (trimStart != null && execMs < trimStart - PAD) return;
      if (trimEnd != null && execMs > trimEnd + PAD) return;

      const isBuy = (trade.trade_direction || trade.direction) === 'buy';
      const color = isBuy ? '#16a34a' : '#b91c1c';

      // 成交时刻细点线（与信号粗实线视觉区分：宽 1 + 点状 dash + 无标签）
      annotations.push({
        type: 'line',
        xMin: execMs,
        xMax: execMs,
        borderColor: color,
        borderWidth: 1,
        borderDash: [2, 3],
      });

      // 成交价点位（tooltip 展示两套时间/价格分叉）
      const price = parseFloat(trade.unit_price);
      if (!Number.isFinite(price) || price <= 0) return;
      const signal = trade.signal_id ? signalById.get(trade.signal_id) : null;
      const signalMs = signal
        ? new Date(signal.timestamp || signal.created_at).getTime() : null;
      const signalPrice = signal ? parseFloat(signal.metadata?.price) : NaN;
      const delaySec = Number.isFinite(signalMs) ? (execMs - signalMs) / 1000 : null;
      const slipPct = (Number.isFinite(signalPrice) && signalPrice > 0)
        ? ((price - signalPrice) / signalPrice) * 100 : null;
      (isBuy ? buyPoints : sellPoints).push({
        x: execMs, y: price, _trade: trade,
        _signalPrice: Number.isFinite(signalPrice) ? signalPrice : null,
        _delaySec: delaySec, _slipPct: slipPct,
      });
    });
    return { annotations, buyPoints, sellPoints };
  }

  /**
   * 按区块(block_number)聚合 OHLC + 成交量，供 candlestick K 线图使用
   * （BSC 无 slot 概念，每根蜡烛=一个区块，与 pumpfun 按 block_slot 聚合同口径）
   * @returns {{ohlc:Array, buyVol:Array, sellVol:Array}|null}
   */
  _buildBlockCandles(tickData) {
    const ticksWithBlock = tickData.filter(t => t.block_number != null);
    if (!ticksWithBlock.length) return null;
    // reduce 而非 Math.min(...arr)：全量模式下几万条 ticks 的 spread 会栈溢出
    const firstBlock = ticksWithBlock.reduce((min, t) => Math.min(min, t.block_number), Infinity);
    // 按 block_time 升序聚合：每区块首笔=open，末笔持续覆盖即 close
    const sorted = [...tickData].sort((a, b) => new Date(a.block_time) - new Date(b.block_time));
    const map = new Map(); // blockNumber -> {t, open, high, low, close, buyVol, sellVol}
    for (const t of sorted) {
      if (t.block_number == null) continue;
      const price = parseFloat(t.price_usd);
      if (!price || price <= 0) continue;
      const bnb = parseFloat(t.bnb_amount) || 0;
      const block = t.block_number;
      let g = map.get(block);
      if (!g) { g = { t: new Date(t.block_time).getTime(), open: price, high: price, low: price, close: price, buyVol: 0, sellVol: 0 }; map.set(block, g); }
      g.high = Math.max(g.high, price);
      g.low = Math.min(g.low, price);
      g.close = price;
      if (t.trade_type === 'buy') g.buyVol += bnb; else g.sellVol += bnb;
    }
    if (!map.size) return null;
    const blocks = [...map.keys()].sort((a, b) => a - b);
    const ohlc = [], buyVol = [], sellVol = [];
    for (const block of blocks) {
      const g = map.get(block);
      const x = g.t;                                 // 区块首笔时间戳
      const blockSeq = block - firstBlock + 1;       // 区块序号（tooltip 展示）
      ohlc.push({ x, o: g.open, h: g.high, l: g.low, c: g.close, blockSeq });
      buyVol.push({ x, y: g.buyVol, blockSeq });
      sellVol.push({ x, y: g.sellVol, blockSeq });
    }
    return { ohlc, buyVol, sellVol };
  }

  /**
   * 区块 K 线图（candlestick 主图 + 成交量副图 + 买卖信号垂直线标注）
   * 画法移植自 pumpfun-wss-trader（BNB 计价适配）；数据/标注口径与散点图一致（同一窗口、同一信号源）
   */
  initCandleChart(tickData, token) {
    const wrapper = document.getElementById('candle-chart-wrapper');
    if (!tickData || !tickData.length) { if (wrapper) wrapper.classList.add('hidden'); return; }

    const { trimmed, trimStart, trimEnd, tokenSignals } = this._trimTicksByWindow(tickData, token);
    const data = this._buildBlockCandles(trimmed);
    if (!data) { if (wrapper) wrapper.classList.add('hidden'); return; }
    if (wrapper) wrapper.classList.remove('hidden');

    if (this.candleChart) { this.candleChart.destroy(); this.candleChart = null; }
    if (this.candleVolumeChart) { this.candleVolumeChart.destroy(); this.candleVolumeChart = null; }

    const signalAnnotations = this._buildSignalAnnotations(tokenSignals, trimStart, trimEnd);
    // 成交标注（双口径）：细点线 + 成交价点位（与散点图同款）
    const tradeMarks = this._buildTradeAnnotations(this._lastTokenTrades, tokenSignals, trimStart, trimEnd);
    signalAnnotations.push(...tradeMarks.annotations);
    // 叙事轮次标注（C84）：析起/析毕虚线（与散点图同款）
    signalAnnotations.push(...this._buildNarrativeRoundAnnotations(this._lastNarrativeRounds, trimStart, trimEnd));
    // 观察信号时刻标注（OBSERVE）：青虚线（与散点图同款）
    signalAnnotations.push(...this._buildObserveAnnotations(this._lastObserveSignals, trimStart, trimEnd));
    // 反作弊判定时刻标注（G12）：点虚线按 grade 着色（与散点图同款）
    signalAnnotations.push(...this._buildCheatAnnotations(this._lastCheatDetections, trimStart, trimEnd));
    // ⭐ famous 操作点位（金▲买/紫▼卖，与散点图同款口径与配色）
    const famousMarks = this._buildFamousPoints(trimmed);
    // 🧠 聪明钱操作点位（青▲买/粉▼卖，与散点图同款口径与配色；famous 优先防双计）
    const smartMarks = this._buildSmartPoints(trimmed);
    // ⚙️ 机器钱包操作点位（橙▲买/棕▼卖，与散点图同款口径与配色；famous/聪明钱优先防双计）
    const arbbotMarks = this._buildArbBotPoints(trimmed);
    // 涨跌配色：close>=open 绿，否则红（与散点图 buy绿/sell红 一致）
    const up = 'rgba(34,197,94,0.85)', down = 'rgba(239,68,68,0.85)';

    const canvas = document.getElementById('candle-chart');
    if (!canvas) return;
    this.candleChart = new Chart(canvas, {
      type: 'candlestick',
      data: { datasets: [
        { label: 'OHLC(USD)', data: data.ohlc,
          backgroundColors: { up, down, unchanged: up }, borderColors: { up, down, unchanged: up } },
        { label: `⭐Famous买 (${famousMarks.buyPoints.length})`, data: famousMarks.buyPoints, type: 'scatter',
          pointStyle: 'triangle', radius: 8, hoverRadius: 10,
          backgroundColor: 'rgba(250,204,21,0.95)', borderColor: '#b45309', borderWidth: 1.5 },
        { label: `⭐Famous卖 (${famousMarks.sellPoints.length})`, data: famousMarks.sellPoints, type: 'scatter',
          pointStyle: 'triangle', rotation: 180, radius: 8, hoverRadius: 10,
          backgroundColor: 'rgba(192,132,252,0.95)', borderColor: '#6b21a8', borderWidth: 1.5 },
        { label: `🧠聪明钱买 (${smartMarks.buyPoints.length})`, data: smartMarks.buyPoints, type: 'scatter',
          pointStyle: 'triangle', radius: 8, hoverRadius: 10,
          backgroundColor: 'rgba(14,165,233,0.95)', borderColor: '#0c4a6e', borderWidth: 1.5 },
        { label: `🧠聪明钱卖 (${smartMarks.sellPoints.length})`, data: smartMarks.sellPoints, type: 'scatter',
          pointStyle: 'triangle', rotation: 180, radius: 8, hoverRadius: 10,
          backgroundColor: 'rgba(244,114,182,0.95)', borderColor: '#831843', borderWidth: 1.5 },
        { label: `⚙️机器买 (${arbbotMarks.buyPoints.length})`, data: arbbotMarks.buyPoints, type: 'scatter',
          pointStyle: 'triangle', radius: 8, hoverRadius: 10,
          backgroundColor: 'rgba(249,115,22,0.95)', borderColor: '#7c2d12', borderWidth: 1.5 },
        { label: `⚙️机器卖 (${arbbotMarks.sellPoints.length})`, data: arbbotMarks.sellPoints, type: 'scatter',
          pointStyle: 'triangle', rotation: 180, radius: 8, hoverRadius: 10,
          backgroundColor: 'rgba(180,83,9,0.95)', borderColor: '#fdba74', borderWidth: 1.5 },
        { label: `成交▲ (${tradeMarks.buyPoints.length})`, data: tradeMarks.buyPoints, type: 'scatter',
          pointStyle: 'triangle', radius: 8, hoverRadius: 10,
          backgroundColor: 'rgba(21,128,61,0.95)', borderColor: '#bbf7d0', borderWidth: 1.5 },
        { label: `成交▼ (${tradeMarks.sellPoints.length})`, data: tradeMarks.sellPoints, type: 'scatter',
          pointStyle: 'triangle', rotation: 180, radius: 8, hoverRadius: 10,
          backgroundColor: 'rgba(185,28,28,0.95)', borderColor: '#fecaca', borderWidth: 1.5 },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
        plugins: {
          annotation: { annotations: signalAnnotations },
          legend: { labels: { boxWidth: 12, padding: 12 } },
          tooltip: { callbacks: {
            title: items => items.length ? `区块序号 ${items[0].raw.blockSeq} · ${new Date(items[0].raw.x).toLocaleTimeString('zh-CN')}` : '',
            label: it => {
              // 成交点（双口径标注）：成交价/信号价/延迟/滑移
              if (it.raw._trade) {
                const t = it.raw;
                const lines = [`${t._trade.trade_direction === 'buy' ? '成交▲ BUY' : '成交▼ SELL'} | $${t.y.toExponential(3)}`];
                if (t._signalPrice != null) lines.push(`信号价: $${t._signalPrice.toExponential(3)}`);
                if (t._delaySec != null) lines.push(`信号→成交延迟: ${t._delaySec.toFixed(1)}s`);
                if (t._slipPct != null) lines.push(`价差: ${t._slipPct >= 0 ? '+' : ''}${t._slipPct.toFixed(2)}%`);
                return lines;
              }
              // ⭐ famous 点位：GMGN 用户名+钱包地址+金额（与散点图同款）
              if (it.raw._famous) {
                const f = it.raw._famous;
                const w = f.wallet;
                const lines = [
                  `⭐Famous ${f.tradeType || ''} | ${f.bnb.toFixed(4)} BNB`,
                  `Price: $${it.raw.y.toExponential(3)}`,
                ];
                if (f.label) lines.push(f.label);
                lines.push(`钱包: ${w.slice(0, 8)}…${w.slice(-6)}`);
                return lines;
              }
              // 🧠 聪明钱点位：twitter/标签+钱包地址+金额（与散点图同款）
              if (it.raw._smart) {
                const f = it.raw._smart;
                const w = f.wallet;
                const lines = [
                  `🧠聪明钱 ${f.tradeType || ''} | ${f.bnb.toFixed(4)} BNB`,
                  `Price: $${it.raw.y.toExponential(3)}`,
                ];
                if (f.label) lines.push(f.label);
                if (f.tags && f.tags.length) lines.push(`标签: ${f.tags.join(',')}`);
                if (f.hits) lines.push(`GMGN流: ${f.hits} 次 / $${f.usd >= 1000 ? (f.usd / 1000).toFixed(1) + 'k' : f.usd.toFixed(0)}`);
                lines.push(`钱包: ${w.slice(0, 8)}…${w.slice(-6)}`);
                return lines;
              }
              // ⚙️ 机器钱包点位：画像标签+30d 统计+钱包地址+金额（与散点图同款）
              if (it.raw._arbbot) {
                const f = it.raw._arbbot;
                const w = f.wallet;
                const lines = [
                  `⚙️机器钱包 ${f.tradeType || ''} | ${f.bnb.toFixed(4)} BNB`,
                  `Price: $${it.raw.y.toExponential(3)}`,
                ];
                if (f.tags && f.tags.length) lines.push(`标签: ${f.tags.join(',')}`);
                const s = f.stats;
                if (s && (s.buyCount || s.sellCount)) {
                  const win = s.winrate != null ? `胜率${Math.round(s.winrate * 100)}%` : '';
                  const pnl = s.realizedProfitUsd != null
                    ? `已实现${s.realizedProfitUsd >= 0 ? '+' : '−'}$${Math.abs(s.realizedProfitUsd) >= 1000 ? (Math.abs(s.realizedProfitUsd) / 1000).toFixed(1) + 'k' : Math.abs(s.realizedProfitUsd).toFixed(0)}` : '';
                  lines.push(`30d: 买${s.buyCount}/卖${s.sellCount} · ${s.tokenNum}票 ${win ? '· ' + win : ''} ${pnl}`.trimEnd());
                }
                lines.push(`钱包: ${w.slice(0, 8)}…${w.slice(-6)}`);
                return lines;
              }
              const p = it.raw, dir = p.c >= p.o ? '▲' : '▼';
              return [`${dir} O $${p.o.toExponential(2)}  H $${p.h.toExponential(2)}`, `   L $${p.l.toExponential(2)}  C $${p.c.toExponential(2)}`];
            },
          } },
        },
        scales: {
          x: { type: 'time', time: { tooltipFormat: 'HH:mm:ss', displayFormats: { second: 'HH:mm:ss', minute: 'HH:mm' } },
               // candlestick 控制器给 x 轴泄漏 ticks.source:'data'/major/autoSkipPadding:75（刻度=数据点时间戳，跳选后轴末端整段无刻度），
               // 显式恢复 time 轴默认整刻度，保证铺满全轴（与散点图同口径）
               ticks: { font: { size: 10 }, maxTicksLimit: 12, source: 'auto', major: { enabled: false }, autoSkipPadding: 3 },
               title: { display: true, text: '时间' } },
          y: { type: 'logarithmic', title: { display: true, text: 'Price (USD)' },
               ticks: { font: { size: 10 }, callback(v) { if (v >= 1) return '$' + v.toFixed(2); if (v >= 0.001) return '$' + v.toPrecision(2); return '$' + v.toExponential(1); } } },
        },
      },
    });

    const volCanvas = document.getElementById('candle-volume-chart');
    if (!volCanvas) return;
    this.candleVolumeChart = new Chart(volCanvas, {
      type: 'bar',
      data: { datasets: [
        { label: `Buy (${data.buyVol.reduce((s, p) => s + p.y, 0).toFixed(2)} BNB)`, data: data.buyVol, backgroundColor: 'rgba(34,197,94,0.6)', stack: 'vol' },
        { label: `Sell (${data.sellVol.reduce((s, p) => s + p.y, 0).toFixed(2)} BNB)`, data: data.sellVol, backgroundColor: 'rgba(239,68,68,0.6)', stack: 'vol' },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
        plugins: {
          legend: { labels: { boxWidth: 12, padding: 12 } },
          tooltip: { callbacks: {
            title: items => items.length ? `区块序号 ${items[0].raw.blockSeq} · ${new Date(items[0].raw.x).toLocaleTimeString('zh-CN')}` : '',
            label: it => `${it.dataset.label.split(' ')[0]} ${(it.raw.y).toFixed(4)} BNB`,
          } },
        },
        scales: {
          x: { type: 'time', stacked: true, time: { displayFormats: { second: 'HH:mm:ss', minute: 'HH:mm' } },
               ticks: { font: { size: 10 }, maxTicksLimit: 12 }, grid: { display: false } },
          y: { stacked: true, title: { display: true, text: 'Vol (BNB)' }, ticks: { font: { size: 10 } } },
        },
      },
    });

    console.log(`✅ Candle chart initialized: ${data.ohlc.length} blocks, ${signalAnnotations.length} signals`);
  }

  /**
   * tick 气泡半径映射（BNB 交易额 → 3~15px，对数刻度）
   */
  _mapTickRadius(bnbAmount) {
    const minR = 3, maxR = 15;
    const logVal = Math.log10(Math.max(bnbAmount, 0.01));
    const normalized = Math.min(Math.max((logVal + 2) / 4, 0), 1); // 0.01 BNB ~ 100 BNB
    return minR + normalized * (maxR - minR);
  }


  updateExperimentHeader(experiment) {
    // 显示实验头部区域（移除hidden类）
    const header = document.getElementById('experiment-header');
    if (header) {
      header.classList.remove('hidden');
    }

    // API返回的是驼峰命名: experimentName, blockchain
    const name = experiment.experimentName || experiment.experiment_name || '未知实验';
    document.getElementById('experiment-name').textContent = name;
    document.getElementById('experiment-id').textContent = `ID: ${this.experimentId}`;

    // 🔥 解析实验配置（可能是 JSON 字符串或对象）
    const config = typeof experiment.config === 'string'
      ? JSON.parse(experiment.config)
      : (experiment.config || {});
    this.experimentConfig = config;

    // 🔥 设置回测状态
    this._isBacktest = experiment.tradingMode === 'backtest';
    if (this._isBacktest) {
      this._sourceExperimentId = config.backtest?.sourceExperimentId || null;
      // 🔥 对于回测实验，先使用回测实验的区块链配置，后面会异步获取源实验的配置
      this.blockchain = experiment.blockchain || 'bsc';
    } else {
      this._sourceExperimentId = null;
      this.blockchain = experiment.blockchain || 'bsc';
    }

    // 🔥 使用 BlockchainConfig 获取区块链显示名称和 logo
    const blockchain = this.blockchain || 'unknown';
    const blockchainDisplay = this.getBlockchainDisplay(blockchain);
    const blockchainElement = document.getElementById('experiment-blockchain');
    if (blockchainElement) {
      blockchainElement.innerHTML = `
        <img src="/static/${blockchain.toLowerCase()}-logo.png" alt="${blockchainDisplay}" class="w-4 h-4 inline-block rounded-full" onerror="this.style.display='none'">
        ${blockchainDisplay}
      `;
    }

    // 更新页面标题
    document.title = `交易信号 - ${name} - 2025-2026 Become Rich Baby!`;

    // 反作弊分析页导航（实验级 cheat_detection 判定全景）
    const cheatLink = document.getElementById('link-cheat-analysis');
    if (cheatLink) cheatLink.href = `/experiment/${this.experimentId}/cheat-analysis`;
  }

  /**
   * 🔥 更新回测模式的头部信息，显示源实验提示
   * @param {string} sourceExperimentId - 源实验ID
   */
  updateBacktestHeader(sourceExperimentId) {
    const header = document.getElementById('experiment-header');
    if (!header) return;

    // 创建回测提示元素
    const backtestNotice = document.createElement('div');
    backtestNotice.className = 'mt-4 p-3 bg-blue-900 border border-blue-700 rounded-lg';
    backtestNotice.innerHTML = `
      <div class="flex items-center space-x-2">
        <span class="text-blue-300 text-lg">📊</span>
        <div class="flex-1">
          <div class="text-blue-200 font-medium">回测模式 - 显示源实验数据</div>
          <div class="text-blue-400 text-sm mt-1">
            当前为回测实验，以下显示的是源实验 <code class="bg-blue-800 px-1 rounded text-blue-300">${sourceExperimentId.substring(0, 8)}...</code> 的原始信号数据
          </div>
        </div>
      </div>
    `;

    // 插入到头部内容的最后
    header.appendChild(backtestNotice);

    console.log('📊 [回测模式] 已添加源实验提示');
  }

  /**
   * 🔥 获取源实验的信息（区块链配置）
   */
  async fetchSourceExperimentInfo() {
    if (!this._sourceExperimentId) return;

    try {
      const response = await fetch(`/api/experiment/${this._sourceExperimentId}`);
      if (response.ok) {
        const result = await response.json();
        if (result.data) {
          // 更新区块链配置
          this.blockchain = result.data.blockchain || 'bsc';
          console.log('📊 [回测模式] 使用源实验的区块链配置:', this.blockchain);

          // 更新区块链显示
          const blockchainDisplay = this.getBlockchainDisplay(this.blockchain);
          const blockchainElement = document.getElementById('experiment-blockchain');
          if (blockchainElement) {
            blockchainElement.innerHTML = `
              <img src="/static/${this.blockchain.toLowerCase()}-logo.png" alt="${blockchainDisplay}" class="w-4 h-4 inline-block rounded-full" onerror="this.style.display='none'">
              ${blockchainDisplay}
            `;
          }
        }
      }
    } catch (error) {
      console.warn('⚠️ 获取源实验区块链信息失败，使用默认值:', error);
      this.blockchain = this.blockchain || 'bsc';
    }
  }

  /**
   * 🔥 从实验代币表获取代币列表
   */
  async extractTokensFromExperiment() {
    try {
      // 从已加载的信号数据中提取有信号的代币列表
      // 统计每个代币的信号数量和被拒绝信号数量
      const tokenSignalCounts = new Map();

      if (this.signals && this.signals.length > 0) {
        this.signals.forEach(signal => {
          const address = signal.token_address || signal.tokenAddress;
          const symbol = signal.token_symbol || signal.symbol || 'Unknown';

          if (!tokenSignalCounts.has(address)) {
            tokenSignalCounts.set(address, {
              address: address,
              symbol: symbol,
              signalCount: 0,
              rejectedCount: 0
            });
          }

          tokenSignalCounts.get(address).signalCount++;

          // 统计被拒绝的信号
          if (this.isSignalRejected(signal)) {
            tokenSignalCounts.get(address).rejectedCount++;
          }
        });
      }

      this.availableTokens = Array.from(tokenSignalCounts.values());
      console.log(`📊 从 ${this.signals.length} 条信号中提取到 ${this.availableTokens.length} 个有信号的代币`);

      // 填充代币选择器
      this.populateTokenSelector();

    } catch (error) {
      console.error('❌ 获取代币列表失败:', error);
      this.availableTokens = [];
      // 即使失败也要尝试填充选择器
      this.populateTokenSelector();
    }
  }

  /**
   * 🔥 填充代币选择器
   */
  populateTokenSelector() {
    console.log('🎨 populateTokenSelector 被调用，availableTokens:', this.availableTokens.length);
    const selector = document.getElementById('token-selector');
    if (!selector) {
      console.warn('⚠️ 找不到代币选择器元素');
      return;
    }
    // console.log('✅ 找到 #token-selector 元素');

    // 清空现有选项和事件监听器（克隆节点以移除监听器）
    const newSelector = selector.cloneNode(false);
    selector.parentNode.replaceChild(newSelector, selector);

    // 重新获取引用
    const freshSelector = document.getElementById('token-selector');

    // 清空现有选项
    freshSelector.innerHTML = '<option value="all">全部代币</option>';
    console.log('📝 已设置默认选项');

    // 按信号数量降序排序（信号多的在前）
    const sortedTokens = [...this.availableTokens].sort((a, b) => {
      return (b.signalCount || 0) - (a.signalCount || 0);
    });

    // console.log('🔄 准备添加', sortedTokens.length, '个代币选项');

    // 添加代币选项，显示信号数量、被拒绝数量和地址
    sortedTokens.forEach((token, index) => {
      const option = document.createElement('option');
      option.value = token.address;
      const signalCount = token.signalCount || 0;
      const rejectedCount = token.rejectedCount || 0;

      // 显示：代币符号 (信号数) 🚫(被拒绝数) - 地址前8位
      const shortAddress = token.address.length > 12
        ? `${token.address.substring(0, 8)}...`
        : token.address;

      let textContent = `${token.symbol} (${signalCount} 条)`;
      if (rejectedCount > 0) {
        textContent += ` 🚫(${rejectedCount})`;
      }
      textContent += ` - ${shortAddress}`;

      option.textContent = textContent;
      freshSelector.appendChild(option);
      if (index < 3) {
        console.log(`  [${index}] ${option.textContent}`);
      }
    });

    // 验证添加结果
    const finalOptions = freshSelector.querySelectorAll('option');
    // console.log('📊 最终选择器中的选项数量:', finalOptions.length);

    // 如果没有代币，禁用选择器
    if (this.availableTokens.length === 0) {
      freshSelector.disabled = true;
      console.log('⚠️ 没有可用代币，禁用代币选择器');
    }

    // 绑定事件
    freshSelector.addEventListener('change', async (e) => {
      const selectedTokenAddress = e.target.value;
      this.selectedToken = selectedTokenAddress;
      // console.log('🔄 选择代币:', this.selectedToken);

      // 如果选择了具体代币（不是'all'），重新加载对应的K线图
      if (selectedTokenAddress !== 'all') {
        const selectedToken = this.availableTokens.find(t => t.address === selectedTokenAddress);
        if (selectedToken) {
          await this.loadKlineForToken(selectedToken);
        }
      } else {
        // 选择"全部代币"时，隐藏整个图表区域与轮次面板（token 级面板无全量视图）
        const chartWrapper = document.getElementById('kline-chart-wrapper');
        if (chartWrapper) {
          chartWrapper.style.display = 'none';
        }
        const roundsWrapper = document.getElementById('narrative-rounds-wrapper');
        if (roundsWrapper) roundsWrapper.classList.add('hidden');
        this._lastNarrativeRounds = [];
      }

      // 过滤并渲染信号列表
      this.filterAndRenderSignals();
    });

    // console.log('✅ 代币选择器已填充，代币数量:', this.availableTokens.length);

    // 调试：检查选择器状态
    setTimeout(() => {
      const checkSelector = document.getElementById('token-selector');
      if (checkSelector) {
        // console.log('🔍 选择器状态检查:');
        console.log('  - disabled:', checkSelector.disabled);
        console.log('  - options.length:', checkSelector.options.length);
        console.log('  - options[0]:', checkSelector.options[0]?.text);
        console.log('  - options[1]:', checkSelector.options[1]?.text);
        console.log('  - computedStyle display:', getComputedStyle(checkSelector).display);
        console.log('  - computedStyle pointerEvents:', getComputedStyle(checkSelector).pointerEvents);
      }
    }, 100);
  }

  /**
   * 获取状态显示文本
   */
  getStatusText(status) {
    const statusMap = {
      'monitoring': '监控中',
      'bought': '已买入',
      'exited': '已退出'
    };
    return statusMap[status] || status;
  }

  /**
   * 🔥 根据选择的代币过滤并重新渲染信号
   */
  filterAndRenderSignals() {
    const filteredSignals = this.selectedToken === 'all'
      ? this.signals
      : this.signals.filter(s => s.token_address === this.selectedToken);

    console.log(`🔍 过滤后的信号数量: ${filteredSignals.length} (全部: ${this.signals.length})`);

    // 更新代币信息显示
    const tokenInfoContainer = document.getElementById('token-info-container');
    const tokenAddressEl = document.getElementById('token-address');
    const copyAddressBtn = document.getElementById('copy-address-btn');
    const gmgnLinkBtn = document.getElementById('gmgn-link-btn');

    if (tokenInfoContainer) {
      if (this.selectedToken === 'all') {
        tokenInfoContainer.classList.add('hidden');
      } else {
        const token = this.availableTokens.find(t => t.address === this.selectedToken);
        if (token) {
          tokenInfoContainer.classList.remove('hidden');
          tokenAddressEl.textContent = token.address;

          // 显示代币 Symbol
          const tokenSymbolEl = document.getElementById('token-symbol');
          if (tokenSymbolEl && token.symbol) {
            tokenSymbolEl.textContent = token.symbol;
          }

          // 🔥 生成GMGN链接
          // GMGN URL格式: https://gmgn.ai/{blockchain}/token/{address}
          const gmgnBlockchain = this.getGMGNBlockchain(this.blockchain);
          const gmgnUrl = `https://gmgn.ai/${gmgnBlockchain}/token/${token.address}`;
          if (gmgnLinkBtn) {
            gmgnLinkBtn.href = gmgnUrl;
            console.log('🔗 GMGN链接已设置:', gmgnUrl);
          } else {
            console.warn('⚠️ gmgnLinkBtn 元素未找到');
          }

          // Ticks 浏览页外链（地址区常驻：不依赖下方 Tick 图表区可见性——
          // 无 tick 数据时图表区整体隐藏，工具栏里的链接会一起不可见）
          const ticksInfoLink = document.getElementById('token-ticks-info-link');
          if (ticksInfoLink) {
            ticksInfoLink.href = `/token-ticks?token=${encodeURIComponent(token.address)}`;
          }

          // 绑定复制按钮事件
          copyAddressBtn.onclick = async () => {
            try {
              await navigator.clipboard.writeText(token.address);
              // 显示复制成功提示
              copyAddressBtn.innerHTML = '<span>✅</span><span>已复制</span>';
              setTimeout(() => {
                copyAddressBtn.innerHTML = '<span>📋</span><span>复制</span>';
              }, 2000);
            } catch (error) {
              console.error('复制地址失败:', error);
              // 降级方案
              try {
                const textArea = document.createElement('textarea');
                textArea.value = token.address;
                textArea.style.position = 'fixed';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                copyAddressBtn.innerHTML = '<span>✅</span><span>已复制</span>';
              } catch (fallbackError) {
                console.error('降级复制也失败:', fallbackError);
                copyAddressBtn.innerHTML = '<span>❌</span><span>复制失败</span>';
              }
            }
          };
        }
      }
    }

    // 更新信号列表
    this.renderSignals(filteredSignals);

    // 更新统计信息
    this.updateSignalsStats(filteredSignals);
  }

  /**
   * 更新信号统计信息
   * @param {Array} signals - 要统计的信号数组（可选，默认使用所有信号）
   */
  updateSignalsStats(signals = null) {
    // 如果没有传入参数，使用所有信号
    const signalsToCount = signals !== null ? signals : this.signals;

    const buySignals = signalsToCount.filter(s => s.action.toUpperCase() === 'BUY').length;
    const sellSignals = signalsToCount.filter(s => s.action.toUpperCase() === 'SELL').length;
    const holdSignals = signalsToCount.filter(s => s.action.toUpperCase() === 'HOLD').length;

    document.getElementById('signal-count').textContent = `信号数量: ${signalsToCount.length}`;
    document.getElementById('buy-signals').textContent = buySignals;
    document.getElementById('sell-signals').textContent = sellSignals;
    document.getElementById('hold-signals').textContent = holdSignals;

    // 计算平均置信度
    if (signalsToCount.length > 0) {
      const avgConfidence = signalsToCount.reduce((sum, s) => sum + (s.confidence || 0), 0) / signalsToCount.length;
      document.getElementById('avg-confidence').textContent = `${(avgConfidence * 100).toFixed(1)}%`;
    } else {
      document.getElementById('avg-confidence').textContent = '0%';
    }

    // 显示/隐藏空状态
    const emptyState = document.getElementById('empty-state');
    const signalsContainer = document.getElementById('signals-container');

    if (signalsToCount.length === 0) {
      emptyState.classList.remove('hidden');
      signalsContainer.parentElement.classList.add('hidden');
    } else {
      emptyState.classList.add('hidden');
      signalsContainer.parentElement.classList.remove('hidden');
    }
  }

  initKlineChart(klineResponse) {
    console.log('🚀 开始初始化K线图...', klineResponse);

    // 检查Chart.js是否已加载
    if (typeof Chart === 'undefined') {
      console.error('❌ Chart.js 未加载，无法创建图表');
      this.showError('图表库加载失败，请刷新页面重试');
      return;
    }

    const canvas = document.getElementById('kline-chart');
    if (!canvas) {
      console.error('❌ 找不到K线图画布元素');
      return;
    }

    const ctx = canvas.getContext('2d');

    // 如果图表已存在，先销毁
    if (this.chart) {
      try {
        this.chart.destroy();
        this.chart = null;
        console.log('🗑️ 已销毁现有图表');
      } catch (error) {
        console.warn('销毁图表实例时出错:', error);
      }
    }

    // 如果交易量图已存在，也销毁
    if (this.volumeChart) {
      try {
        this.volumeChart.destroy();
        this.volumeChart = null;
        console.log('🗑️ 已销毁现有交易量图');
      } catch (error) {
        console.warn('销毁交易量图实例时出错:', error);
      }
    }

    // 确保canvas完全清空
    canvas.width = canvas.width;
    canvas.height = canvas.height;

    // 🔥 价格乘以10亿得到市值
    const MARKET_CAP_MULTIPLIER = 1e9; // 10亿

    // 准备K线数据 - 使用成功项目的格式
    const candlestickData = klineResponse.kline_data.map(kline => {
      const timestamp = parseInt(kline.timestamp) * 1000; // 转换为毫秒
      return [
        timestamp,
        parseFloat(kline.open_price) * MARKET_CAP_MULTIPLIER,
        parseFloat(kline.high_price) * MARKET_CAP_MULTIPLIER,
        parseFloat(kline.low_price) * MARKET_CAP_MULTIPLIER,
        parseFloat(kline.close_price) * MARKET_CAP_MULTIPLIER
      ];
    });

    // 将数据转换为Chart.js需要的格式
    const chartData = candlestickData.map(item => ({
      x: item[0],
      o: item[1],
      h: item[2],
      l: item[3],
      c: item[4]
    }));

    // 准备交易量数据和颜色 - 颜色直接嵌入到数据点对象中（参考Python项目的实现）
    const volumeDataPoints = klineResponse.kline_data.map(kline => {
      const isUp = parseFloat(kline.close_price) >= parseFloat(kline.open_price);
      return {
        x: parseInt(kline.timestamp) * 1000,
        y: parseFloat(kline.volume || 0),
        // 将颜色直接嵌入到数据点对象中
        backgroundColor: isUp ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)',
        borderColor: isUp ? 'rgba(16, 185, 129, 0.8)' : 'rgba(239, 68, 68, 0.8)'
      };
    });

    // console.log('📊 交易量数据点数:', volumeDataPoints.length);
    if (volumeDataPoints.length > 0) {
      const totalVolume = volumeDataPoints.reduce((sum, item) => sum + item.y, 0);
      const avgVolume = totalVolume / volumeDataPoints.length;
      const maxVolume = Math.max(...volumeDataPoints.map(item => item.y));
      console.log(`📊 交易量统计: 总量=${totalVolume.toFixed(0)}, 平均=${avgVolume.toFixed(0)}, 最大=${maxVolume.toFixed(0)}`);
      // 显示前3个数据点的颜色，便于调试
      console.log('🎨 前3个交易量柱的颜色:', volumeDataPoints.slice(0, 3).map((v, i) => `Bar[${i}]: ${v.backgroundColor}`));
    }


    // 准备信号标记 - 使用成功项目的方法
    const signalAnnotations = {};
    const signalData = klineResponse.trades_on_chart || klineResponse.signals; // 兼容两种字段名

    console.log('🎯 检查信号数据:', {
      'trades_on_chart': klineResponse.trades_on_chart?.length || 0,
      'signals': klineResponse.signals?.length || 0,
      'signalData': signalData?.length || 0
    });

    if (signalData && Array.isArray(signalData)) {
      console.log('📍 开始处理', signalData.length, '个信号标记');
      signalData.forEach((signal, index) => {
        // 找到最接近的K线时间点
        const signalTime = new Date(signal.signal_timestamp).getTime();
        const closestKline = candlestickData.find(kline =>
          Math.abs(kline[0] - signalTime) < (klineResponse.interval_minutes * 60 * 1000) // 一个K线间隔内
        );

        if (closestKline) {
          const isBuy = signal.action === 'buy';
          signalAnnotations[`signal_${index}`] = {
            type: 'point',
            xValue: closestKline[0],
            yValue: isBuy ? closestKline[4] : closestKline[4], // 收盘价
            backgroundColor: isBuy ? '#10b981' : '#ef4444',
            borderColor: '#ffffff',
            borderWidth: 2,
            radius: 6,
            label: {
              display: true,
              content: isBuy ? '买' : '卖',
              position: isBuy ? 'bottom' : 'top',
              backgroundColor: isBuy ? '#10b981' : '#ef4444',
              color: '#ffffff',
              font: {
                size: 10,
                weight: 'bold'
              },
              padding: 2
            }
          };
        }
      });
    }

    try {
      // console.log('📊 创建K线图表...');
      console.log('📈 K线数据点数:', chartData.length);
      console.log('🎯 信号标记数:', Object.keys(signalAnnotations).length);

      // K线图配置（仅包含蜡烛图）
      const config = {
        type: 'candlestick',
        data: {
          datasets: [
            // 蜡烛图数据集
            {
              type: 'candlestick',
              label: `${klineResponse.token?.symbol || '代币'} 市值`,
              data: chartData,
              yAxisID: 'y',
              borderColor: {
                up: '#10b981',
                down: '#ef4444',
                unchanged: '#6b7280'
              },
              backgroundColor: {
                up: 'rgba(16, 185, 129, 0.1)',
                down: 'rgba(239, 68, 68, 0.1)',
                unchanged: 'rgba(107, 114, 128, 0.1)'
              }
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              bottom: 5
            }
          },
          scales: {
            x: {
              type: 'time',
              time: {
                unit: this.getTimeUnit(klineResponse.interval_minutes),
                displayFormats: {
                  minute: 'MM-dd HH:mm',
                  hour: 'MM-dd HH:mm',
                  day: 'MM-dd'
                }
              },
              grid: {
                color: 'rgba(156, 163, 175, 0.2)'
              },
              ticks: {
                color: '#9ca3af'
              }
            },
            y: {
              type: 'linear',
              position: 'right',
              display: true,
              title: {
                display: true,
                text: '市值 (K)',
                color: '#9ca3af'
              },
              grid: {
                color: 'rgba(156, 163, 175, 0.2)'
              },
              ticks: {
                color: '#9ca3af',
                callback: function(value) {
                  // Y轴刻度显示为K（千）
                  return (value / 1e3).toFixed(1) + 'K';
                }
              }
            }
          },
          plugins: {
            legend: {
              display: true,
              labels: {
                color: '#f3f4f6',
                font: {
                  size: 12
                }
              }
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                title: function(context) {
                  const date = new Date(context[0].parsed.x);
                  return date.toLocaleString('zh-CN');
                },
                label: function(context) {
                  const data = context.raw;
                  // 蜡烛图数据：显示OHLC（转换为K）
                  const toK = (val) => (val / 1e3).toFixed(1) + 'K';
                  return [
                    `开盘: ${toK(data.o)}`,
                    `最高: ${toK(data.h)}`,
                    `最低: ${toK(data.l)}`,
                    `收盘: ${toK(data.c)}`
                  ];
                }
              }
            },
            annotation: {
              annotations: signalAnnotations
            }
          }
        }
      };

      this.chart = new Chart(ctx, config);
      console.log(`✅ K线图初始化完成，${chartData.length}个数据点，${Object.keys(signalAnnotations).length}个信号标记`);

      // 创建独立的交易量图
      this.createVolumeChart(volumeDataPoints, klineResponse);

    } catch (error) {
      console.error('❌ 创建K线图失败:', error);
      console.error('错误详情:', error.message);

      // 显示错误信息
      const chartContainer = canvas.parentElement;
      chartContainer.innerHTML = `
        <div class="flex items-center justify-center h-96 bg-gray-100 rounded-lg border border-gray-300">
          <div class="text-center">
            <div class="text-red-500 text-lg mb-2">⚠️ 图表加载失败</div>
            <div class="text-gray-600 text-sm">错误: ${error.message}</div>
            <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              刷新页面
            </button>
          </div>
        </div>
      `;

      return;
    }
  }

  createVolumeChart(volumeDataPoints, klineResponse) {
    // console.log('📊 开始创建独立的交易量图...');

    const volumeCanvas = document.getElementById('volume-chart');
    if (!volumeCanvas) {
      console.error('❌ 找不到交易量图画布元素');
      return;
    }

    const volumeCtx = volumeCanvas.getContext('2d');

    // 如果交易量图已存在，先销毁
    if (this.volumeChart) {
      try {
        this.volumeChart.destroy();
        this.volumeChart = null;
        console.log('🗑️ 已销毁现有交易量图');
      } catch (error) {
        console.warn('销毁交易量图实例时出错:', error);
      }
    }

    try {
      // 准备交易量数据 - 颜色直接嵌入到数据点对象中
      const volumeChartData = volumeDataPoints.map(item => ({
        x: item.x,
        y: item.y,
        backgroundColor: item.backgroundColor
      }));

      console.log(`📊 交易量数据准备完成: ${volumeChartData.length} 个数据点`);
      console.log('🎨 前3个交易量柱的颜色:', volumeChartData.slice(0, 3).map((v, i) => `Bar[${i}]: ${v.backgroundColor}`));

      // 创建交易量图（参考Python项目的实现）
      this.volumeChart = new Chart(volumeCtx, {
        type: 'bar',
        data: {
          datasets: [{
            label: '交易量',
            data: volumeChartData,
            backgroundColor: volumeChartData.map(v => v.backgroundColor)
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              top: 5,
              bottom: 5
            }
          },
          scales: {
            x: {
              type: 'time',
              time: {
                unit: this.getTimeUnit(klineResponse.interval_minutes),
                displayFormats: {
                  minute: 'MM-dd HH:mm',
                  hour: 'MM-dd HH:mm',
                  day: 'MM-dd'
                }
              },
              grid: {
                color: 'rgba(156, 163, 175, 0.2)'
              },
              ticks: {
                color: '#9ca3af',
                maxTicksLimit: 8
              }
            },
            y: {
              position: 'right',
              grid: {
                color: 'rgba(156, 163, 175, 0.2)'
              },
              ticks: {
                color: '#9ca3af',
                callback: function(value) {
                  if (value >= 1000000) {
                    return (value / 1000000).toFixed(1) + 'M';
                  } else if (value >= 1000) {
                    return (value / 1000).toFixed(1) + 'K';
                  }
                  return value.toFixed(0);
                }
              }
            }
          },
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                title: function(context) {
                  const date = new Date(context[0].parsed.x);
                  return date.toLocaleString('zh-CN');
                },
                label: function(context) {
                  const volume = context.parsed.y;
                  if (volume >= 1000000) {
                    return `交易量: ${(volume / 1000000).toFixed(2)}M`;
                  } else if (volume >= 1000) {
                    return `交易量: ${(volume / 1000).toFixed(2)}K`;
                  }
                  return `交易量: ${volume.toFixed(0)}`;
                }
              }
            }
          }
        }
      });

      // console.log('✅ 交易量图初始化完成');

    } catch (error) {
      console.error('❌ 创建交易量图失败:', error);
      console.error('错误详情:', error.message);

      // 显示错误信息
      const volumeContainer = volumeCanvas.parentElement;
      volumeContainer.innerHTML = `
        <div class="flex items-center justify-center h-32 bg-gray-100 rounded-lg border border-gray-300">
          <div class="text-center">
            <div class="text-red-500 text-sm mb-1">⚠️ 交易量图加载失败</div>
            <div class="text-gray-600 text-xs">错误: ${error.message}</div>
          </div>
        </div>
      `;
    }
  }

  getTimeUnit(intervalMinutes) {
    if (intervalMinutes < 60) {
      return 'minute';
    } else if (intervalMinutes < 1440) {
      return 'hour';
    } else {
      return 'day';
    }
  }

  /**
   * 渲染信号列表
   * @param {Array} signals - 要渲染的信号数组（可选，默认使用所有信号）
   */
  renderSignals(signals = null) {
    const container = document.getElementById('signals-container');
    container.innerHTML = '';


    // 如果没有传入参数，使用所有信号
    let signalsToRender = signals !== null ? signals : this.signals;

    // 根据 showRejected 过滤信号
    if (!this.showRejected) {
      signalsToRender = signalsToRender.filter(s => !this.isSignalRejected(s));
    }

    // 按时间倒序排列；同秒时间戳（回测 created_at=block_time 秒精度，BSC 0.75s 出块
    // 同秒先买后卖常见）tie 时买在前，防止对倒显示成「卖在买入前」（case 0xcc4d7275…7777）
    const sortedSignals = [...signalsToRender].sort((a, b) => {
      const timeDiff = new Date(b.signal_timestamp) - new Date(a.signal_timestamp);
      if (timeDiff !== 0) return timeDiff;
      return (a.action === 'buy' ? 0 : 1) - (b.action === 'buy' ? 0 : 1);
    });

    sortedSignals.forEach(signal => {
      const signalCard = this.createSignalCard(signal);
      container.appendChild(signalCard);
    });
  }

  createSignalCard(signal) {
    const card = document.createElement('div');
    const signalClass = this.getSignalClass(signal.action, signal);
    const badgeClass = this.getBadgeClass(signal.action, signal);

    card.className = `signal-card ${signalClass} p-4`;

    const signalTime = new Date(signal.signal_timestamp).toLocaleString('zh-CN');

    // 检查是否是被拒绝的信号
    const isRejected = this.isSignalRejected(signal);
    // T157 因子卖出过滤门拦截（famous HOLD 延缓卖出，非拒绝/失败）
    const isBlocked = this.isSignalBlocked(signal);
    // 观察信号（2026-10-23 ₿DOG 案）：OBSERVE 行恒终态（executed=false 无后续推进），
    // 独立灰底徽章，不走三态
    const isObserve = signal.signal_type === 'OBSERVE';
    const executedStatus = isObserve ?
      '<span class="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded-full">👁 观察</span>' :
      (isBlocked ?
        '<span class="text-xs px-2 py-1 bg-indigo-100 text-indigo-800 rounded-full">🛡 已拦截</span>' :
        (signal.executed ?
          '<span class="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">✅ 已执行</span>' :
          (isRejected ?
            '<span class="text-xs px-2 py-1 bg-red-100 text-red-800 rounded-full">🚫 被拒绝</span>' :
            '<span class="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full">⏳ 未执行</span>')));

    // 从 metadata 中获取策略信息
    const metadata = signal.metadata || {};
    const strategyName = metadata.strategyName || signal.strategyName || signal.reason || '策略信号';
    const strategyId = metadata.strategyId || signal.strategyId || null;
    const executionReason = signal.execution_reason || metadata.execution_reason || metadata.tradeResult?.reason || '';

    // 构建拒绝原因HTML（门链域 execution_reason 带人类可读映射——T117 明细展示；
    // cheat 域拒因附带具体触发通道+高档题简报——2026-11-07 用户要求，明细源
    // =metadata.cheatCheck 段（拒前落段同批启用；历史拒行无段只显通用映射））
    let rejectionInfoHtml = '';
    if (isRejected && executionReason) {
      let gateLabel = GATE_REASON_LABELS[executionReason];
      if (!gateLabel && executionReason.startsWith('factor_gate_')) {
        const hit = FACTOR_GATE_REASON_LABELS.find(([re]) => re.test(executionReason));
        if (hit) gateLabel = hit[1];
        // T144 act 域（factor_gate_act_low_<branch>/factor_gate_act_ultra_<branch>——branch 后缀查 ACT 表）
        const am = executionReason.match(/^factor_gate_(act_(?:low|ultra))_([a-z_]+)$/);
        if (!gateLabel && am && FACTOR_GATE_ACT_LABELS[am[0].replace('factor_gate_', '')]) {
          gateLabel = '活跃度 ' + (am[1] === 'act_low' ? '低' : '超高') + '：' + FACTOR_GATE_ACT_LABELS[am[0].replace('factor_gate_', '')];
        }
      }
      let cheatDetailHtml = '';
      const cc = (metadata || {}).cheatCheck;
      // T241 BP 门 crash 形态复核拒因明细（bp_gate_assessment ∧ buyPoint.factorTrace.crashForm）：
      // 分支中文 + 判据八键数值——因子代唯一会拒买的 BP 判定，拒行须可归因
      let bpRejectDetailHtml = '';
      const bpi = (metadata || {}).buyPoint;
      if (executionReason === 'bp_gate_assessment' && bpi && bpi.factorTrace && bpi.factorTrace.crashForm) {
        const cf = bpi.factorTrace.crashForm;
        gateLabel = cf.hit
          ? 'BP 门拒（crash 形态复核命中：无回调 + 无换手的单边下跌）'
          : (gateLabel || GATE_REASON_LABELS.bp_gate_assessment);
        bpRejectDetailHtml = `
          <div class="text-xs text-red-900 mt-1 space-y-0.5">
            <div>crash 形态复核（BPF${this._escapeHtml(factorGenVersion(bpi).replace(/^BPF/, ''))}，纯代码）：${this._escapeHtml(BP_CRASHFORM_BRANCH_LABELS[cf.branch] || cf.branch || '—')}</div>
            ${cf.trace ? `<div>${BP_CRASHFORM_TRACE_LABELS.map(([k, label]) => `${label}=${cf.trace[k] == null ? '—' : cf.trace[k]}`).map((s) => this._escapeHtml(s)).join(' · ')}</div>` : ''}
          </div>`;
      }
      // T143 因子门拒因明细（factor_gate_* 域）：PVP 判定分支+关键计数+CD 臂码
      let factorRejectDetailHtml = '';
      const fc = (metadata || {}).factorCheck;
      if (executionReason.startsWith('factor_gate_') && fc && fc.status === 'assessed') {
        const t = fc.trace || {};
        const keyNums = [
          t.volSingle != null ? `量在场单笔=${t.volSingle}` : '',
          t.act20 != null ? `0.2 级买入过=${t.act20}` : '',
          t.act30 != null ? `0.29+ 买入过=${t.act30}` : '',
          t.sell60 != null ? `近60s大户卖=${t.sell60}` : '',
          t.absorbAlive != null ? `承接在场=${t.absorbAlive}` : '',
          t.absorbZero != null ? `承接归零=${t.absorbZero}` : '',
        ].filter(Boolean).join(' · ');
        factorRejectDetailHtml = `
          <div class="text-xs text-red-900 mt-1 space-y-0.5">
            ${fc.pvp && fc.pvp.branch ? `<div>PVP 判定分支: ${this._escapeHtml(fc.pvp.branch)}</div>` : ''}
            ${keyNums ? `<div>${this._escapeHtml(keyNums)}</div>` : ''}
            ${Array.isArray(fc.arms) && fc.arms.length ? `<div>CD 升格臂: ${fc.arms.map((a) => this._escapeHtml(a)).join(' · ')}</div>` : ''}
            <div class="text-gray-600">纯代码判定（FP${this._escapeHtml(String(fc.version || '1'))}，零 Jev）</div>
            ${(() => {
              // T241b 命中门所属类别（新行带 category / 历史行按门 id 归类）
              const hitCats = [...new Set((Array.isArray(fc.gates) ? fc.gates : []).filter((ge) => ge.hit)
                .map((ge) => factorGateCategoryOf(ge)).filter(Boolean))]
                .map((cid) => (FACTOR_GATE_CATEGORIES.find((c) => c.id === cid) || {}).label || cid);
              return hitCats.length ? `<div>因子门分类: ${this._escapeHtml(hitCats.join(' · '))}</div>` : '';
            })()}
          </div>`;
      }
      if (executionReason.startsWith('cheat_gate_') && cc && cc.grade) {
        const codeDesc = (cc.reasons || []).map((r) => {
          const hit = CHEAT_CODE_LABELS.find(([re]) => re.test(r.code || ''));
          return hit ? `${r.code}（${hit[1]}）` : (r.code || '—');
        }).filter(Boolean);
        // levels 高档题简报（strong/moderate 按严重度降序，中文名标签）
        const hiLevels = Object.entries(cc.levels || {})
          .filter(([, lv]) => lv === 'strong' || lv === 'moderate')
          .sort((a, b) => (a[1] === b[1] ? 0 : (a[1] === 'strong' ? -1 : 1)))
          .map(([k, lv]) => `${CHEAT_QUESTION_LABELS[k] || k} ${lv}`);
        if (codeDesc.length || hiLevels.length) {
          cheatDetailHtml = `
          <div class="text-xs text-red-900 mt-1 space-y-0.5">
            ${codeDesc.length ? `<div>触发通道: ${codeDesc.map((d) => this._escapeHtml(d)).join(' · ')}</div>` : ''}
            ${hiLevels.length ? `<div>高档题: ${this._escapeHtml(hiLevels.join(' · '))}</div>` : ''}
            ${cc.cached === true ? '<div>（粘滞秒回判定，非本信号真析）</div>' : ''}
          </div>`;
        }
      }
      rejectionInfoHtml = `
        <div class="mt-2 p-2 bg-red-50 rounded border border-red-200">
          <div class="flex items-center space-x-2">
            <span class="text-red-700 font-medium text-sm">🚫 拒绝原因:</span>
            <span class="text-red-900 text-sm">${this._escapeHtml(executionReason)}</span>
          </div>
          ${gateLabel ? `<div class="text-xs text-red-700 mt-1">${this._escapeHtml(gateLabel)}</div>` : ''}
          ${cheatDetailHtml}
          ${factorRejectDetailHtml}
          ${bpRejectDetailHtml}
        </div>
      `;
    }

    // T157 因子卖出过滤门拦截明细（famous/smart HOLD 判据展示——蓝紫系区别红色
    // 拒绝；判据源=metadata.factorSellFilter 段：管辖臂+因子值+阈值+放行条件；
    // T183 起双臂——smart_hold 聪明钱臂+ pump 臂管辖标记）
    let blockedInfoHtml = '';
    if (isBlocked) {
      const fsf = metadata.factorSellFilter || {};
      const isSmart = fsf.rule === 'smart_hold'
        || (fsf.rule !== 'famous_hold' && fsf.sinceLastFamousBigBuySec == null && fsf.sinceLastSmartBigBuySec != null);
      if (fsf.rule === 'machine_hold') {
        // T228k 机器钱包 HOLD 拦截（机器回调吸筹）：180s 机器净买 ≥0.2 ∧ chg30≤0——
        // 断流票上 stall 卖腿被拦的最常见形状（机器吸筹后静默，时间键自然衰减放行）。
        // ★rule 优先于 famous/smart 分支：machine 判据行同时携带 famous/smart 证据键
        // （未命中的观察值），按证据键分支会冒充 famous/smart 拦截
        const fmtM = (v) => (v == null ? '—' : v);
        blockedInfoHtml = `
        <div class="mt-2 p-2 bg-indigo-50 rounded border border-indigo-200">
          <div class="flex items-center space-x-2">
            <span class="text-indigo-700 font-medium text-sm">🤖 机器钱包 HOLD 拦截:</span>
            <span class="text-indigo-900 text-sm">机器钱包回调吸筹中，延缓卖出</span>
          </div>
          <div class="text-xs text-indigo-900 mt-1 space-y-0.5">
            <div>180s 机器净买=${fmtM(fsf.machineNetBuy180)} BNB（线 ≥${fmtM(fsf.machineMinNetBuyBnb)}）· chg30=${fmtM(fsf.chg30Pct)}%（线 ≤${fmtM(fsf.machineMaxChg30Pct)}）</div>
            <div class="text-indigo-600">放行条件：机器净买归零（断流 180s 流环空）/ 30s 动量转正（chg30>0）/ 浮盈跌破保护域</div>
          </div>
        </div>`;
      } else if (fsf.rule === 'famous_hold' || fsf.rule === 'smart_hold'
        || fsf.sinceLastFamousBigBuySec != null || fsf.sinceLastSmartBigBuySec != null) {
        const fmt = (v) => (v == null ? '—' : v);
        const armLabel = isSmart ? '🧠 聪明钱 HOLD 拦截' : '🛡 famous HOLD 拦截';
        const armDesc = isSmart ? '聪明钱仍在入场，延缓卖出' : 'famous 仍在入场，延缓卖出';
        const smartLine = fsf.smartHoldEnabled != null
          ? `<div>距聪明钱大买=${fmt(fsf.sinceLastSmartBigBuySec)}s（窗 ≤${fmt(fsf.smartMaxSinceBuySec)}s）· 60s 内聪明钱卖出=${fmt(fsf.recentSmartSellBnb)} BNB（释放线 ≥${fmt(fsf.smartSellReleaseBnb)}）</div>` : '';
        blockedInfoHtml = `
        <div class="mt-2 p-2 bg-indigo-50 rounded border border-indigo-200">
          <div class="flex items-center space-x-2">
            <span class="text-indigo-700 font-medium text-sm">${armLabel}:</span>
            <span class="text-indigo-900 text-sm">${armDesc}</span>
            ${fsf.pumpArmJurisdiction ? '<span class="text-indigo-500 text-xs">〔pump 失衡臂管辖·不论浮盈〕</span>' : ''}
          </div>
          <div class="text-xs text-indigo-900 mt-1 space-y-0.5">
            <div>浮盈=${fmt(fsf.profitPercent)}%（保护域 ≥${fmt(fsf.minProfitPct)}%）· 距 famous 大买=${fmt(fsf.sinceLastFamousBigBuySec)}s（窗 ≤${fmt(fsf.maxSinceBuySec)}s）· 60s 内 famous 卖出=${fmt(fsf.recentFamousSellBnb)} BNB（释放线 ≥${fmt(fsf.sellReleaseBnb)}）</div>
            ${smartLine}
            ${fsf.arm ? `<div class="text-indigo-700">管辖臂: ${this._escapeHtml(fsf.arm)}</div>` : ''}
            <div class="text-indigo-600">放行条件：famous/聪明钱超窗未入场 / 60s 卖出达释放线 / 浮盈跌破保护域（pump 臂不论浮盈）</div>
          </div>
        </div>`;
      } else {
        blockedInfoHtml = `
        <div class="mt-2 p-2 bg-indigo-50 rounded border border-indigo-200">
          <div class="flex items-center space-x-2">
            <span class="text-indigo-700 font-medium text-sm">🛡 因子卖出过滤拦截:</span>
            <span class="text-indigo-900 text-sm">${this._escapeHtml(executionReason || '触发条件落在管辖臂内')}</span>
          </div>
        </div>`;
      }
    }

    // 构建策略信息HTML
    let strategyInfoHtml = '';
    if (strategyName || strategyId) {
      strategyInfoHtml = `
        <div class="mt-2 p-2 bg-purple-50 rounded border border-purple-200">
          <div class="flex items-center space-x-2">
            <span class="text-purple-700 font-medium text-sm">📌 策略:</span>
            <span class="text-purple-900 font-semibold text-sm">${strategyName}</span>
            ${strategyId ? `<span class="text-purple-800 text-xs">(${strategyId})</span>` : ''}
          </div>
        </div>
      `;
    }

    // 观察信号信息块（2026-10-23 ₿DOG 案）：触发原因/市值/序号 + 手工买入入口
    //（观察票 status='monitoring' 天然在实验代币池内，manual-trade 归属校验通过；
    // 金额逻辑镜像 token-returns 页：perCardBNB>0 按卡，否则 tradeAmount）
    let observationInfoHtml = '';
    if (isObserve) {
      const obs = metadata.observation || {};
      const triggerText = obs.trigger === 'both' ? '叙事评级 + 市值双臂'
        : obs.trigger === 'narrative' ? `叙事评级 ${obs.rating}`
        : `市值 > $${Number(obs.marketCapThreshold).toLocaleString()}`;
      const mcap = Number.isFinite(obs.marketCap) ? `$${Math.round(obs.marketCap).toLocaleString()}` : '-';
      const idx = obs.index || '?';
      const max = obs.maxPerToken || 3;
      const showBuyBtn = !this._isBacktest;
      // 跟普通买信号同款因子值 chips（2026-10-25 用户要求）：观察票无策略归属，
      // 用实验首个买腿条件驱动展示；值=观察时刻 metadata.trendFactors 快照
      // （绿=过买腿门/红=未过——「为何只观察没买」的对拍信息；回测无观察行天然不触发）
      const obsBuyCondition = this._getBuyCondition('buy');
      const obsFactorChipsHtml = obsBuyCondition ? `
        <div class="text-xs mt-2">
          <span class="font-semibold text-gray-700">📋 买入条件（对拍）:</span>
          <code class="ml-2 px-2 py-0.5 bg-gray-900 rounded text-xs text-gray-100 break-all">${this._escapeHtml(obsBuyCondition)}</code>
          ${this._renderConditionFactorChips(obsBuyCondition, metadata)}
        </div>
      ` : '';
      observationInfoHtml = `
        <div class="mt-2 p-2 bg-gray-100 rounded border border-gray-300">
          <div class="flex items-center justify-between">
            <div class="flex items-center flex-wrap gap-x-4 gap-y-1">
              <span class="text-gray-700 font-medium text-sm">👁 观察</span>
              <span class="text-xs text-gray-600">触发: <span class="font-medium">${this._escapeHtml(String(triggerText))}</span></span>
              <span class="text-xs text-gray-600">市值: <span class="font-medium">${mcap}</span></span>
              <span class="text-xs text-gray-500">第 ${idx}/${max} 行</span>
            </div>
            ${showBuyBtn ? `
            <button class="obs-manual-buy px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-medium transition-colors">
              手工买入
            </button>` : ''}
          </div>
          ${obsFactorChipsHtml}
        </div>
      `;
    }

    // 构建价格和原因信息
    const priceValue = signal.price || metadata.price;
    const priceInfo = (priceValue !== undefined && priceValue !== null && !isNaN(priceValue)) ?
      `<span class="text-gray-600">价格: <span class="font-medium text-gray-100">${parseFloat(priceValue).toFixed(8)}</span></span>` : '';

    // 构建额外信息（如果有）
    let extraInfoHtml = '';
    const extraInfo = [];
    if (metadata.profitPercent !== undefined && metadata.profitPercent !== null && !isNaN(metadata.profitPercent)) {
      extraInfo.push(`收益率: ${parseFloat(metadata.profitPercent).toFixed(2)}%`);
    }
    if (metadata.holdDuration !== undefined && metadata.holdDuration !== null && !isNaN(metadata.holdDuration)) {
      const holdSeconds = metadata.holdDuration;
      const holdMinutes = (holdSeconds / 60).toFixed(1);
      extraInfo.push(`持仓: ${holdMinutes}分钟`);
    }
    // stallClose 断流上下文（T233 2026-11-24 腿化起由 stall 卖腿触发/被拦行统一携带）：
    // 距末足额成交秒数 + 生效档（tier='almost'=almost_launch域 90s 延长；
    // tier=null=基础 55s 照卖）。'breakdown' 档只存在于 T170b 时代历史行（档已退役不回迁）
    const scInfo = metadata.stallClose;
    if (scInfo && Number.isFinite(scInfo.stalledSec)) {
      const tierTxt = scInfo.tier === 'breakdown' ? `·破发域延长(${scInfo.effectiveSec}s)`
        : (scInfo.tier === 'almost' ? `·almost_launch域延长(${scInfo.effectiveSec}s)` : '');
      extraInfo.push(`断流: ${scInfo.stalledSec}s${tierTxt}`);
    }
    if (metadata.sellCalculatedRatio !== undefined && metadata.sellCalculatedRatio !== null && !isNaN(metadata.sellCalculatedRatio)) {
      const ratioPercent = (metadata.sellCalculatedRatio * 100).toFixed(0);
      extraInfo.push(`卖出比例: ${ratioPercent}%`);
    }
    // 执行口径（2026-10-15 双口径裁定）：成交价 vs 信号价、信号→成交延迟。
    // 延迟合理性门 [0,600s]：回测 metadata.executed_at 是回测墙钟、signal_timestamp
    // 是回放虚拟时间，差值荒谬——不合理不显示，避免误导
    const execPrice = parseFloat(metadata.tradeResult?.trade?.unitPrice);
    if (Number.isFinite(execPrice) && execPrice > 0) {
      const sigPrice = parseFloat(priceValue);
      let priceDiff = null;
      if (Number.isFinite(sigPrice) && sigPrice > 0) {
        priceDiff = ((execPrice - sigPrice) / sigPrice) * 100;
      }
      extraInfo.push(`成交价: ${execPrice.toExponential(3)}${priceDiff !== null ? ` (${priceDiff >= 0 ? '+' : ''}${priceDiff.toFixed(2)}%)` : ''}`);
    }
    if (metadata.executed_at && signal.signal_timestamp) {
      const delaySec = (new Date(metadata.executed_at).getTime() - new Date(signal.signal_timestamp).getTime()) / 1000;
      if (Number.isFinite(delaySec) && delaySec >= 0 && delaySec <= 600) {
        extraInfo.push(`延迟: ${delaySec.toFixed(1)}s`);
      }
    }
    if (extraInfo.length > 0) {
      extraInfoHtml = `<div class="flex items-center space-x-3 text-xs text-gray-500 mt-1">
        ${extraInfo.map(info => `<span>• ${info}</span>`).join('')}
      </div>`;
    }

    // 构建购买前置检查信息（仅买入信号）
    let preBuyCheckHtml = '';
    if (signal.action.toUpperCase() === 'BUY') {
      const pf = metadata.preBuyCheckFactors || {};
      const pr = metadata.preBuyCheckResult || {};

      // 🔥 获取策略条件（因子 chip 内部自解析子句，有啥因子展示啥）
      const buyCondition = this._getBuyCondition('buy', strategyId);
      // 获取购买轮次，用于显示对应的预检查条件
      const buyRound = pf.buyRound || 1;
      const preBuyCheckCondition = this._getPreBuyCheckCondition('buy', buyRound);
      // 第三层 GMGN 条件（FAKER 团伙盘案 2026-10-14）：因子实时快照在 metadata.gmgnCheck
      const gmgnCheckCondition = this._getGmgnCheckCondition(strategyId);
      const gmgnCheckInfo = metadata.gmgnCheck || null;
      // 作弊盘检测轨迹（CD1 观察层 / G1 分级门两形状，2026-11-01）
      const cheatCheckInfo = metadata.cheatCheck || null;
      // T117 信号源门链：触发行（signalGate 段）+ BP 门判定（buyPoint 段）——2026-11-07 明细展示
      const signalGateInfo = metadata.signalGate || null;
      const buyPointInfo = metadata.buyPoint || null;
      // T143 因子购买前检查门（FP1，门链第一门·纯代码零 Jev——duanju 案立法）
      const factorCheckInfo = metadata.factorCheck || null;
      // T175/AF1 前置活跃度门（第 2 层·Jev 3 题分流——2026-11-18；灰度关=段缺席不渲染）
      const actFrontGateInfo = metadata.actFrontGate || null;
      // T216/T217 点位类型辨别（⓪层——信号 fire 后纯因子分类，类型路由后续门；
      // 段缺席=包未启用 pointType 模块=全门现行）
      const pointTypeInfo = metadata.pointType || null;

      // 门链触发行（2026-11-18 五层化；2026-11-26 四层化：活跃度并入②因子检查层）
      // 现行：⓪类型通路→①信号触发→②因子检查→③作弊→④BP 买点；
      // 段缺席=灰度关直通或前层拒未到达
      const PIPE_CLS = {
        ok: 'bg-green-200 text-green-900 border-green-400',
        exempt: 'bg-yellow-200 text-yellow-900 border-yellow-400',
        rej: 'bg-red-200 text-red-900 border-red-500 font-bold',
        skip: 'bg-indigo-200 text-indigo-900 border-indigo-400',
        warn: 'bg-amber-100 text-amber-900 border-amber-300',
        pass0: 'bg-gray-200 text-gray-800 border-gray-400',
        off: 'bg-gray-100 text-gray-500 border-gray-300',
      };
      const gateLayerState = (kind, info) => {
        if (kind === 'ptype') {
          if (!info) return { cls: 'off', icon: '—', text: '未启用·全门现行', title: '包未启用 pointType 模块：不分类，四门按现行全链跑' };
          return { cls: 'skip', icon: '🧭', text: info.label || info.type || '?', title: `点位类型 ${info.type}（${info.version || ''}）——按类型策略路由后续门` };
        }
        if (kind === 'signal') return { cls: 'ok', icon: '✅', text: '已触发', title: '触发条件 fire 且信号落库' };
        if (!info) {
          return kind === 'factor'
            ? { cls: 'off', icon: '—', text: '未启用·直通', title: '灰度关（本层未配置启用），直通下一层' }
            : { cls: 'off', icon: '—', text: '未到达', title: '前层已拒或链断，本层未评估' };
        }
        if (kind === 'factor') {
          // T243b：类型 policy 直通（factorCheckArms:skip）——此前落进「故障·放行」误显
          if (info.status === 'policy_pass') return { cls: 'skip', icon: '⏭', text: '类型直通', title: `点位类型 policy：因子门整门跳过（${info.policy || ''}）` };
          if (info.status === 'assessed') return info.pass === true
            ? { cls: 'ok', icon: '✅', text: '放行', title: '因子门纯代码判定通过' }
            : { cls: 'rej', icon: '🚫', text: `拒 ${info.reason || ''}`, title: `拒因 factor_gate_${info.reason || '?'}` };
          if (info.status === 'insufficient_ticks') return { cls: 'pass0', icon: '◻', text: '未判定·放行', title: '锚窗 ticks 不足不判定，BP 门兜底拒（不双拒）' };
          return { cls: 'warn', icon: '⚠', text: '故障·放行', title: '检测层故障 fail-open 放行，下游门接管' };
        }
        if (kind === 'cheat') {
          if (info.status === 'skipped_by_act_front') return { cls: 'skip', icon: '⏭', text: '被活跃度门跳过', title: '前置活跃度门分流跳过（high/burst/停滞再启动通路票不烧 10 题 Jev）' };
          if (info.grade) {
            if (info.grade === 'healthy') {
              // T241 因子代 CF1：healthy = 本层无拒臂放行（非 Jev 检测结论）
              if (isFactorGen(info)) return { cls: 'ok', icon: '✅', text: '放行', title: `因子代 ${factorGenVersion(info)}：作弊组织性形状由①因子门作弊类臂承接，本层无 Jev 档位判定` };
              return info.exempt
              ? { cls: 'exempt', icon: '🟡', text: `豁免过（原判 ${info.exempt.originalGrade || '?'}）`, title: '活跃度/burst 豁免放行' }
              : { cls: 'ok', icon: '✅', text: 'healthy', title: '作弊检测放行' };
            }
            return { cls: 'rej', icon: '🚫', text: info.grade, title: info.grade === 'cheat' ? '拉黑不再交易+持仓清仓' : '本信号拒' };
          }
          if (info.status === 'timeout_fail_open') return { cls: 'warn', icon: '⏱', text: '超时·放行', title: '竞速超时放行，迟到结果下轮生效' };
          if (info.status === 'insufficient_ticks') return { cls: 'pass0', icon: '◻', text: '未判定·放行', title: '锚窗 tick 不足不判定' };
          if (info.status === 'skipped') return { cls: 'off', icon: '—', text: '未启用·直通', title: 'cheatCheck.enabled=false' };
          if (info.status === 'fail' || info.status === 'error') return { cls: 'warn', icon: '⚠', text: '故障·放行', title: '检测层故障 fail-open' };
          return { cls: 'warn', icon: '⚠', text: '放行', title: '检测层结果' };
        }
        if (kind === 'bp') {
          if (info.status === 'assessed' && info.assessment) {
            const b = String(info.assessment.bucket || '?');
            // T241 因子代 BPF3：BP 门只评塞单门（纯代码；crash 形态 T243 起迁因子门 FP48，
            // 历史 BPF2 行仍带 factorTrace）
            const cfHit = !!(info.factorTrace && info.factorTrace.crashForm && info.factorTrace.crashForm.hit);
            if (b === 'good') return { cls: 'ok', icon: '✅', text: 'good', title: 'BP 买点判定 good 放行' };
            if (b === 'neutral') return { cls: 'ok', icon: '🟡', text: 'neutral', title: isFactorGen(info) ? `BP 门放行（因子代 ${factorGenVersion(info)}：塞单门未命中${info.factorTrace ? '；crash 形态复核未命中' : ''}）` : 'BP 买点判定 neutral 放行' };
            // 塞单门拒（BPF3/类型 stuffingOnly policy 唯一拒因）沿用 Jev 代 bucket='poor'
            // 字段名——展示不得冒充六桶判定（2026-11-26 Hawking 0x110c 案用户疑问
            // 「现在不是已经没 BP 了吗」）
            if (info.assessment.rule === 'stuffing_gate' || info.assessment.rule === 'policy_stuffing_only') {
              return { cls: 'rej', icon: '🚫', text: '塞单门', title: 'BP 塞单门拒（同一区块 ∧ 金额四位小数全等 ∧ ≥8 钱包）——因子代 BP 门唯一拒因' };
            }
            return { cls: 'rej', icon: '🚫', text: b, title: `BP 拒（${info.assessment.rule || ''}${cfHit ? '：crash 形态复核命中——无回调 + 无换手的单边下跌' : ''}）` };
          }
          if (info.status === 'insufficient_ticks') return { cls: 'rej', icon: '🚫', text: '数据不足·拒', title: 'BP10：数据不够就挡住' };
          if (info.status) return { cls: 'rej', icon: '🚫', text: '拒', title: 'BP 门 fail-closed（超时/失败全拒）' };
          return { cls: 'off', icon: '—', text: '未到达', title: '前层已拒，本层未评估' };
        }
        return { cls: 'off', icon: '—', text: '—', title: '' };
      };
      // T216/T217 ⓪类型通路明细卡：类型徽章 + policy 门控 chips + 分类因子快照
      // 2026-11-27 用户指令「🧭 点位类型通路也请跟 📋 买入条件配置一样，展示完整的表达式，
      // 以及每个因子的条件满足情况」：徽章行下加判据表达式 + 逐子句因子 chips
      // （_renderPointTypeCondition——表达式取当前注册表，值取 metadata.pointType.snapshot）
      let pointTypeHtml = '';
      if (pointTypeInfo) {
        const pt = pointTypeInfo;
        const pol = pt.policy || {};
        const POLICY_CHIPS = {
          factorCheckArms: { cheatOnly: ['FP：只留作弊臂', 'FP 只评严重作弊类臂（效果提升类全撤）'], skip: ['FP：直通', 'FP 整门跳过'] },
          // T241：活跃度门 / 作弊门的 policy 文案按层语义写（Jev 代=AF1 直通/跳 Jev 题；
          // 因子代=AF2 不判档/CF1 放行——两种代次下同一条 policy 含义一致）
          actFront: { pass: ['活跃度门：直通', '前置活跃度门直通（坑位天然低活跃）'] },
          cheatCheck: { g23: ['作弊门：g23 规则集', '作弊门现行 G 语义'], g23NoSlowGrind: ['作弊门：g23NoSlowGrind', '差集规则集：slowGrindPump strong 不拦+去 E 通道（famous 自然带量≠虚假拉盘）'], skip: ['作弊门：跳过', '跳作弊门（拉黑短路保留）'] },
          buyPoint: { stuffingOnly: ['BP：只评塞单门', 'BP 只评塞单门（≥8 等额同块 stuffing）'], skip: ['BP：直通', 'BP 整门跳过'] },
        };
        const chips = [];
        for (const [dim, variants] of Object.entries(POLICY_CHIPS)) {
          const v = pol[dim] ? variants[pol[dim]] : null;
          if (v) chips.push(`<span class="px-1.5 py-0.5 rounded border border-indigo-400 bg-indigo-900 text-indigo-100 text-xs" title="${this._escapeHtml(v[1])}">${this._escapeHtml(v[0])}</span>`);
        }
        if (Array.isArray(pol.factorCheckArmExempt) && pol.factorCheckArmExempt.length) {
          chips.push(`<span class="px-1.5 py-0.5 rounded border border-amber-400 bg-amber-100 text-amber-900 text-xs" title="FP 臂差集（T217）：这些臂本类型不拦">FP 臂豁免 ${pol.factorCheckArmExempt.map((c) => this._escapeHtml(c)).join(',')}</span>`);
        }
        const snapKeys = Object.keys(pt.snapshot || {});
        const snapHtml = snapKeys.length
          ? `<details class="mt-1"><summary class="text-xs text-gray-400 cursor-pointer">分类因子快照（${snapKeys.length} 键）</summary><div class="flex flex-wrap gap-1 mt-1">${snapKeys.map((k) => `<span class="px-1.5 py-0.5 rounded border border-gray-600 bg-gray-900 text-gray-200 text-xs font-mono">${this._escapeHtml(k)}=<b class="text-emerald-300">${this._escapeHtml(String(pt.snapshot[k]))}</b></span>`).join('')}</div></details>`
          : '';
        pointTypeHtml = `
        <div class="mb-2 border-l-4 border-indigo-500 pl-2">
          <div class="flex items-center flex-wrap gap-2 text-xs">
            <span class="text-indigo-200 font-semibold">🧭 点位类型通路</span>
            <span class="px-2 py-0.5 rounded-full border border-indigo-400 bg-indigo-900 text-indigo-100 font-bold">${this._escapeHtml(pt.label || pt.type || '?')} <code class="text-indigo-300">${this._escapeHtml(pt.type || '')}</code></span>
            <span class="text-gray-500">${this._escapeHtml(pt.version || '')}</span>
            ${chips.join(' ')}
          </div>
          ${this._renderPointTypeCondition(pt, metadata)}
          ${snapHtml}
        </div>`;
      }
      let signalGateHtml = '';
      // T241 门链代次徽章：②③④三门各自的答案来源（Jev 代无 model 键；因子代带 factor@<版本>）
      // ——全因子代 / 混代（逐门消融对拍）都如实列出；全 Jev 代不显示（存量行形状不变）
      const genParts = [
        isFactorGen(actFrontGateInfo) ? `活跃度 ${factorGenVersion(actFrontGateInfo)}` : '',
        isFactorGen(cheatCheckInfo) ? `作弊 ${factorGenVersion(cheatCheckInfo)}` : '',
        isFactorGen(buyPointInfo) ? `BP ${factorGenVersion(buyPointInfo)}` : '',
      ].filter(Boolean);
      const genBadge = genParts.length
        ? `<span class="bg-indigo-900 px-2 py-0.5 rounded border border-indigo-400 text-indigo-100" title="T241 Jev 退役：下列门的结论由纯代码因子产出，零 Jev 调用">⚙ 因子代（零 Jev）：${this._escapeHtml(genParts.join(' · '))}</span>`
        : '';
      const allFactorGen = isFactorGen(actFrontGateInfo) && isFactorGen(cheatCheckInfo) && isFactorGen(buyPointInfo);
      // T243b 恒放行层静默（文件头 T243b 注释）：流水线段与明细卡都不占位——
      //   ②因子：类型 policy 直通 / 因子代放行（活跃度档位由 AF 因子代在门内评估）
      //   ③作弊：类型 policy 直通 / 因子代 CF1（healthy 且无拒因=无拒臂放行）
      //   ④BP：  放行（good/neutral）且属 因子代 / 类型 policy / stuffingOnly 之一
      //             （历史 BPF2 行带 factorTrace=真做过 crash 形态复核，不静默）
      // 只作用于「有留痕且恒放行」的层：真拒买（含历史 BPF2 crash 形态拒）与 Jev 代的
      // 真判定照常显示；段缺席（前层已拒未到达 / 灰度关直通）的展示不变（存量 Jev 代行不变）
      const cheatSilent = !!cheatCheckInfo && (cheatCheckInfo.status === 'policy_pass'
        || (isFactorGen(cheatCheckInfo) && cheatCheckInfo.grade === 'healthy' && !(cheatCheckInfo.reasons || []).length));
      const bpSilent = !!buyPointInfo && buyPointInfo.status === 'assessed' && buyPointInfo.assessment
        && ['good', 'neutral'].includes(String(buyPointInfo.assessment.bucket)) && !buyPointInfo.factorTrace
        && (isFactorGen(buyPointInfo) || buyPointInfo.policy === 'stuffingOnly' || buyPointInfo.assessment.rule === 'policy_stuffing_only');
      if (signalGateInfo) {
        const sg = signalGateInfo;
        const pipeSeg = (n, name, st) => `<span class="px-1.5 py-0.5 rounded border text-xs ${PIPE_CLS[st.cls] || PIPE_CLS.off}" title="${this._escapeHtml(st.title || '')}">${n} ${name} ${st.icon} ${this._escapeHtml(st.text)}</span>`;
        signalGateHtml = `
        <div class="mb-2">
          <div class="flex items-center flex-wrap gap-2 text-xs">
            <span class="text-amber-200 font-semibold">⚡ 信号源门链（四层）</span>
            <span class="bg-gray-900 px-2 py-0.5 rounded border border-gray-600">触发腿 <code>${this._escapeHtml(String(sg.legId || '—'))}</code></span>
            <span class="bg-gray-900 px-2 py-0.5 rounded border border-gray-600">第 ${this._escapeHtml(String(sg.triggerNo ?? '—'))}/${this._escapeHtml(String(sg.maxTriggers ?? 1))} 次触发（触发即消耗·门拒不返还）</span>
            ${Array.isArray(sg.bpPassLevels) && sg.bpPassLevels.length ? `<span class="bg-gray-900 px-2 py-0.5 rounded border border-gray-600">BP 放行档 ${this._escapeHtml(sg.bpPassLevels.join('/'))}</span>` : ''}
            ${genBadge}
            ${sg.recheckCondition ? `<span class="bg-gray-900 px-2 py-0.5 rounded border border-gray-600">作弊重判（CD381）<code>${this._escapeHtml(sg.recheckCondition)}</code></span>` : ''}
            ${sg.cheatRecheck != null ? `<span class="bg-gray-900 px-2 py-0.5 rounded border border-gray-600">cheatRecheck=${sg.cheatRecheck ? 'true（unhealthy 每信号重判）' : 'false（unhealthy 粘滞秒回省配额）'}</span>` : ''}
          </div>
          <div class="flex items-center flex-wrap gap-1.5 mt-1">
            ${pipeSeg('⓪', '类型通路', gateLayerState('ptype', pointTypeInfo))}
            <span class="text-gray-600 text-xs">→</span>
            ${pipeSeg('①', '信号触发', gateLayerState('signal', null))}
            <span class="text-gray-600 text-xs">→</span>
            ${pipeSeg('②', '因子检查', gateLayerState('factor', factorCheckInfo))}
            ${cheatSilent ? '' : `<span class="text-gray-600 text-xs">→</span>
            ${pipeSeg('③', '作弊', gateLayerState('cheat', cheatCheckInfo))}`}
            ${bpSilent ? '' : `<span class="text-gray-600 text-xs">→</span>
            ${pipeSeg('④', 'BP 买点', gateLayerState('bp', buyPointInfo))}`}
          </div>
          <div class="text-xs text-gray-700 mt-0.5">${allFactorGen
            ? '类型+四层：⓪分类定路由（未启用=全门现行）；四层都过才买；活跃度属因子检查的一部分（AF 因子代在②因子门内评估，看「活跃度流动性」分块）；③作弊无拒臂时低活跃、组织性作弊与 crash 形态都由②因子门拦——实际在拦的是②因子门与④塞单门，恒放行的层不占位；段缺席=前层已拒未到达'
            : '类型+四层：⓪分类定路由（未启用=全门现行）；四层都过才买；活跃度并入②因子检查层（AF1 结论在因子门内体现）；②灰度关=直通、③④段缺席=前层已拒未到达'}</div>
        </div>
        `;
      }

      // T143 因子购买前检查门（门链第一门·纯代码零 Jev）：assessed=badge+PVP 分支/
      // 关键计数/CD 臂 chips；insufficient_ticks=数据不足放行（BP 门兜底拒）；disabled
      // 不渲染（灰度关零痕迹）；error=异常放行（fail-open——检测层故障方向对齐 cheat 门）
      let factorGateHtml = '';
      // T243b：类型 policy 直通不渲染因子门卡（整门跳过无可展示；流水线段标「类型直通」）
      if (factorCheckInfo && factorCheckInfo.status !== 'disabled' && factorCheckInfo.status !== 'policy_pass') {
        const fStatus = factorCheckInfo.status || '';
        if (fStatus === 'assessed') {
          const fPass = factorCheckInfo.pass === true;
          const fBadge = fPass
            ? '<span class="text-xs px-2 py-1 bg-green-200 text-green-900 rounded-full font-bold">✅ 放行</span>'
            : '<span class="text-xs px-2 py-1 bg-red-200 text-red-900 rounded-full font-bold">🚫 拒</span>';
          const t = factorCheckInfo.trace || {};
          const fmtNum = (v) => v == null ? '—' : (typeof v === 'number' ? (Number.isInteger(v) ? v : Number(v).toFixed(4)) : v);
          const traceRows = [
            ['量在场单笔 ≥0.29', t.volSingle], ['捆绑块买 BNB', t.volBundledBnb],
            ['0.2 级买入过', t.act20], ['0.29+ 买入过', t.act30],
            ['0.2 级活跃在场', t.act20Active], ['0.29+ 活跃在场', t.act30Active],
            ['近60s大户卖 BNB', t.sell60], ['在场持有(0.2级)', t.holdersHolding],
            ['承接在场', t.absorbAlive], ['承接归零', t.absorbZero],
          ].map(([k, v]) => `
            <div class="flex items-center justify-between gap-2 bg-gray-900 px-2 py-0.5 rounded border border-emerald-400">
              <span class="text-gray-700">${k}</span>
              <span class="text-gray-100 font-mono">${this._escapeHtml(String(fmtNum(v)))}</span>
            </div>`).join('');
          const pvpHit = factorCheckInfo.pvp && factorCheckInfo.pvp.hit === 1;
          const armChips = (Array.isArray(factorCheckInfo.arms) && factorCheckInfo.arms.length
            ? factorCheckInfo.arms.map((a) => `<span class="px-1.5 py-0.5 rounded border border-red-300 bg-red-100 text-red-900 text-xs">${this._escapeHtml(a)}</span>`).join(' ')
            : '');
          // 因子门分类分块（T241b，2026-11-26 用户提案「因子门就很多了，建议进行一下
          // 因子分类。在信号页面，也已分类为分块展示数据」）：门行按类别分块——①因子门
          // 门行 + ④BP 门的塞单门（按 metadata.buyPoint 合成；信号在①被拒时④未到达=无此
          // 行）。新行带 category，历史行按门 id 归类。
          const gateRows = (Array.isArray(factorCheckInfo.gates) ? factorCheckInfo.gates.slice() : []);
          if (buyPointInfo && buyPointInfo.status === 'assessed') {
            const eqW = buyPointInfo.anchors ? buyPointInfo.anchors.exactEqualBlockMaxWallets : null;
            gateRows.push({
              id: 'stuffing_gate', label: 'BP77·同块等额塞单',
              value: `同块等额买入最大簇 ${eqW == null ? '—' : eqW} 钱包`,
              line: '同一区块 ∧ 金额四位小数全等 ∧ ≥8 钱包（④BP 买点门，纯代码）',
              hit: !!(buyPointInfo.assessment && buyPointInfo.assessment.rule === 'stuffing_gate'),
            });
            // 历史 BPF2 行（FP48 前）：crash 形态在 BP 门，按 factorTrace 合成门行；FP48 起
            // 后端因子门门行自带 crash_form（gateRows 已有则不重复合成）
            const cf = buyPointInfo.factorTrace && buyPointInfo.factorTrace.crashForm;
            if (cf && !gateRows.some((row) => row && row.id === 'crash_form')) {
              gateRows.push({
                id: 'crash_form', label: 'BPF2·crash 形态复核',
                value: cf.hit ? '命中：无回调 + 无换手的单边下跌' : `未命中（${String(BP_CRASHFORM_BRANCH_LABELS[cf.branch] || cf.branch || '—').replace(/^[^\s：:]+[：:]\s*/, '')}）`,
                line: '数值提示臂 ∧ chg5≤-1.5（未反弹）∧ 尾 10s 买=0（无换手）∧ 卖>0（④BP 买点门，纯代码）',
                hit: !!cf.hit,
              });
            }
          }
          const catBlocks = FACTOR_GATE_CATEGORIES
            .map((c) => ({ ...c, rows: gateRows.filter((row) => factorGateCategoryOf(row) === c.id) }))
            .filter((b) => b.rows.length);
          // T243b「如果有必要可以在因子门里头强调一下（例如活跃度）」：活跃度流动性分块
          // 顶部一行强调——因子门活跃度臂判定（trace.act=judgeActivityLevel 分支）+ 触发
          // 时刻 FA 多粒度成交额（T218 四窗键，signal metadata 顶层原值）
          const _actBranch = t.act;
          const _aw = (k) => (typeof metadata[k] === 'number' ? Number(metadata[k]).toFixed(2) : null);
          const _awTxt = ['actTotalBnb15s', 'actTotalBnb30s', 'actTotalBnb60s', 'actTotalBnb300s']
            .map((k, i) => `${['15s', '30s', '60s', '300s'][i]} ${_aw(k) === null ? '—' : _aw(k)}B`).join(' · ');
          const liquidityEmphasisHtml = `
              <div class="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span class="font-semibold text-amber-200">🌡️ 活跃度</span>
                <span class="px-1.5 py-0.5 rounded border ${_actBranch && _actBranch !== 'pass' ? 'bg-red-200 text-red-900 border-red-500 font-bold' : 'bg-green-200 text-green-900 border-green-400'}">因子门活跃度臂：${this._escapeHtml(_actBranch && _actBranch !== 'pass' ? `命中 ${_actBranch}` : '未命中')}</span>
                <span class="text-gray-300">成交额 ${this._escapeHtml(_awTxt)}</span>
              </div>`;
          const gateRowHtml = (ge) => `
              <tr class="${ge.hit ? 'bg-red-100' : (ge.observe ? 'bg-amber-100' : (ge.exempt ? 'bg-indigo-100' : ''))}">
                <td class="px-2 py-0.5 border-t border-gray-300 whitespace-nowrap">${this._escapeHtml(ge.label || ge.id)}${ge.hit ? ' 🚫' : (ge.observe ? ' 👁' : (ge.exempt ? ' ⏭ 通路' : ''))}</td>
                <td class="px-2 py-0.5 border-t border-gray-300 font-mono">${this._escapeHtml(ge.value || '—')}</td>
                <td class="px-2 py-0.5 border-t border-gray-300 text-gray-600">${this._escapeHtml(ge.line || '')}</td>
              </tr>`;
          const gatesTable = (catBlocks.length
            ? catBlocks.map((b) => {
              const nHit = b.rows.filter((ge) => ge.hit).length;
              const nMark = b.rows.filter((ge) => ge.observe || ge.exempt).length;
              return `
            <details class="mt-1" open>
              <summary class="text-xs ${nHit ? 'text-red-700 font-bold' : 'text-emerald-800'} cursor-pointer select-none">🧩 ${this._escapeHtml(b.label)} · ${this._escapeHtml(b.question)}（${b.rows.length} 门${nHit ? ` · 🚫 命中 ${nHit}` : ''}${nMark ? ` · 标记 ${nMark}` : ''}）</summary>
              ${b.id === 'liquidity' ? liquidityEmphasisHtml : ''}
              <div class="mt-1 overflow-x-auto"><table class="w-full text-xs border border-gray-400"><thead><tr class="bg-gray-200"><th class="text-left px-2 py-0.5">门</th><th class="text-left px-2 py-0.5">值</th><th class="text-left px-2 py-0.5">线</th></tr></thead><tbody>${b.rows.map(gateRowHtml).join('')}</tbody></table></div>
            </details>`;
            }).join('')
            : '') + (gateRows.some((row) => !factorGateCategoryOf(row))
              ? `<div class="mt-1 text-xs text-amber-700">⚠ 未归类的门：${gateRows.filter((row) => !factorGateCategoryOf(row)).map((row) => this._escapeHtml(row.id)).join(', ')}（分类表未登记）</div>`
              : '');
          // FP6 观察臂标记（不拦截——留待找方案）
          const observeChip = (factorCheckInfo.observe
            ? `<span class="px-1.5 py-0.5 rounded border border-amber-300 bg-amber-100 text-amber-900 text-xs">👁 观察 ${this._escapeHtml(factorCheckInfo.observe.code || '')}（不拦截）</span>`
            : '');
          factorGateHtml = `
          <div class="mt-2 pt-2 border-t border-emerald-300">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-emerald-800">🧮 因子购买前检查门（第 1 层 · 纯代码零 Jev）</div>
              ${fBadge}
            </div>
            <div class="flex flex-wrap gap-2 text-xs text-gray-800 mb-1">
              ${factorCheckInfo.reason ? `<span>拒因 <code class="bg-gray-900 px-1 rounded text-red-300">${this._escapeHtml(factorCheckInfo.reason)}</code></span>` : ''}
              ${factorCheckInfo.pvp && factorCheckInfo.pvp.branch ? `<span>PVP 分支 <code class="bg-gray-900 px-1 rounded">${this._escapeHtml(factorCheckInfo.pvp.branch)}</code>${pvpHit ? '（PVP 命中）' : ''}</span>` : ''}
              <span class="text-gray-600">FP${this._escapeHtml(String(factorCheckInfo.version || '1'))}</span>
            </div>
            ${armChips ? `<div class="flex flex-wrap gap-1 mb-1">${armChips} ${observeChip}</div>` : (observeChip ? `<div class="flex flex-wrap gap-1 mb-1">${observeChip}</div>` : '')}
            ${catBlocks.filter((b) => b.rows.some((ge) => ge.hit)).length ? `<div class="flex flex-wrap items-center gap-1 mb-1 text-xs"><span class="text-red-800">命中类别：</span>${catBlocks.filter((b) => b.rows.some((ge) => ge.hit)).map((b) => `<span class="px-1.5 py-0.5 rounded border border-red-300 bg-red-100 text-red-900">${this._escapeHtml(b.label)}（${b.rows.filter((ge) => ge.hit).length}）</span>`).join(' ')}</div>` : ''}
            ${gatesTable}
            ${traceRows ? `<details class="mt-1"><summary class="text-xs text-emerald-800 cursor-pointer select-none">📐 PVP 判定树计数（点开展开）</summary><div class="mt-1 grid grid-cols-2 gap-1 text-xs sm:grid-cols-3 lg:grid-cols-5">${traceRows}</div></details>` : ''}
          </div>
          `;
        } else if (fStatus === 'insufficient_ticks') {
          factorGateHtml = `
          <div class="mt-2 pt-2 border-t border-emerald-300">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-emerald-800">🧮 因子购买前检查门（第 1 层 · 纯代码零 Jev）</div>
              <span class="text-xs px-2 py-1 bg-gray-200 text-gray-800 rounded-full">未判定·放行</span>
            </div>
            <div class="text-xs text-gray-700">锚窗 ${this._escapeHtml(String(factorCheckInfo.anchorTickCount ?? '—'))} ticks 不足——因子门放行，数据不足由 BP 门 insufficient_ticks 兜底拒（不双拒）</div>
          </div>
          `;
        } else {
          factorGateHtml = `
          <div class="mt-2 pt-2 border-t border-emerald-300">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-emerald-800">🧮 因子购买前检查门（第 1 层 · 纯代码零 Jev）</div>
              <span class="text-xs px-2 py-1 bg-yellow-100 text-yellow-900 rounded-full">${this._escapeHtml(fStatus || '—')}·放行</span>
            </div>
            <div class="text-xs text-gray-700">检测层异常 fail-open 放行（后续门接管）${factorCheckInfo.reason ? `：${this._escapeHtml(String(factorCheckInfo.reason))}` : ''}</div>
          </div>
          `;
        }
      }

      // T175/AF1 前置活跃度门（第 2 层 · Jev 3 题分流，2026-11-18）：assessed=
      // 活跃度/sbw/对倒三档徽章+分流 path 徽章；非 assessed=检测层故障 fail-open
      // 放行进作弊门全链；段缺席（灰度关/AF 上线前行）不渲染零痕迹（factorCheck
      // disabled 同惯例——pipeline 总览行仍显示「未启用·直通」）
      let actFrontGateHtml = '';
      // T243b：恒放行层静默（类型 policy 直通 / 因子代 AF2 不判档）——不渲染明细卡
      // 2026-11-26 用户裁定「活跃度也是因子检查的一部分」：明细卡只在有真判定
      // （assessed 且非静默直通）时渲染；活跃度数值看②因子门「活跃度流动性」分块
      const afHasVerdict = !!actFrontGateInfo && actFrontGateInfo.status !== 'disabled'
        && actFrontGateInfo.status !== 'policy_pass'
        && !(isFactorGen(actFrontGateInfo) && actFrontGateInfo.status === 'assessed' && actFrontGateInfo.path === 'mid_full');
      if (afHasVerdict) {
        const afStatus = actFrontGateInfo.status || '';
        if (afStatus === 'assessed') {
          const act = actFrontGateInfo.act || null;
          const sbw = actFrontGateInfo.sbw || null;
          const wash = actFrontGateInfo.wash || null;
          const path = actFrontGateInfo.path || null;
          const PATH_LABELS = {
            reject_low: '🚫 拒买（low ∧ 非 burst）',
            reject_ultra: '🚫 拒买（ultra ∧ 非 burst）',
            reject_wash: '🚫 拒买（high ∧ 对倒 strong）',
            burst_exempt: '⏭ burst 豁免 → 跳过③直进④',
            restart_exempt: '⏭ 停滞再启动通路 → 跳过③直进④（T210）',
            high_skip: '⏭ 跳过③作弊门 → 直进④',
            mid_full: '✅ mid → 照走③全链',
            fail_open: '⚠ 放行进全链（档位答案缺席）',
          };
          const afBadgeCls = path && path.startsWith('reject_')
            ? 'bg-red-200 text-red-900 border-red-500 font-bold'
            : (path === 'burst_exempt' || path === 'restart_exempt' || path === 'high_skip'
              ? 'bg-indigo-200 text-indigo-900 border-indigo-400 font-semibold'
              : (path === 'mid_full' ? 'bg-green-200 text-green-900 border-green-400' : 'bg-amber-100 text-amber-900 border-amber-300'));
          actFrontGateHtml = `
          <div class="mt-2 pt-2 border-t border-indigo-400">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-indigo-300">🌡️ 前置活跃度门（第 2 层 · Jev 3 题：活跃度+对倒+停滞突发波）</div>
              <span class="text-xs px-2 py-1 rounded-full border ${afBadgeCls}">${this._escapeHtml(PATH_LABELS[path] || path || '—')}</span>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
              ${act ? `<span class="px-2 py-0.5 rounded-full border ${gateBucketClass(act)}">活跃度 ${this._escapeHtml(act)}</span>` : '<span class="text-gray-700">活跃度档位缺席</span>'}
              ${sbw ? `<span class="px-2 py-0.5 rounded-full border ${sbw === 'burst' ? 'bg-indigo-200 text-indigo-900 border-indigo-400' : 'bg-gray-200 text-gray-800 border-gray-400'}">停滞突发波 ${this._escapeHtml(sbw)}</span>` : ''}
              ${wash ? `<span class="px-2 py-0.5 rounded-full border ${gateBucketClass(wash)}">对倒 ${this._escapeHtml(wash)}</span>` : ''}
              ${actFrontGateInfo.stallRestart ? `<span class="px-2 py-0.5 rounded-full border ${actFrontGateInfo.stallRestart.hit ? 'bg-indigo-200 text-indigo-900 border-indigo-400' : 'bg-gray-200 text-gray-700 border-gray-400'}" title="T210 停滞再启动通路六腿：沉寂≥60s ∧ 出口=非尘买单孤笔∧锚在其上 ∧ 前期钱包≥12 ∧ 持仓者≥6∧留存≥55% ∧ 锚前最高价<80% ∧ 额<5B">停滞再启动通路 ${actFrontGateInfo.stallRestart.hit ? '✓ 命中' : '✗ ' + this._escapeHtml((actFrontGateInfo.stallRestart.fail || []).join('/'))}</span>` : ''}
              <span class="text-gray-600">AF${this._escapeHtml(String(actFrontGateInfo.version || '1'))} · 每信号真调不粘滞 · 题面与作弊门同源</span>
            </div>
          </div>
          `;
        } else {
          // timeout_fail_open / fail / insufficient_ticks：检测层故障 fail-open 放行进作弊门
          const afFailLabel = afStatus === 'timeout_fail_open' ? '竞速超时'
            : afStatus === 'insufficient_ticks' ? `锚窗 ${actFrontGateInfo.anchorTickCount ?? '—'} ticks 不足`
            : `检测层故障（reason=${actFrontGateInfo.reason || '—'}）`;
          actFrontGateHtml = `
          <div class="mt-2 pt-2 border-t border-indigo-400">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-indigo-300">🌡️ 前置活跃度门（第 2 层 · Jev 3 题分流）</div>
              <span class="text-xs px-2 py-1 bg-amber-100 text-amber-900 rounded-full border border-amber-300">⚠ 放行</span>
            </div>
            <div class="text-xs text-gray-700">${this._escapeHtml(afFailLabel)} → fail-open 放行进③作弊门全链（数据不可用不拦买点，下游门接管）</div>
          </div>
          `;
        }
      }

      // BP 买入点位门（T117 门链第二门）：assessed=badge+维度+anchors 折叠
      // （BP48 两质量题退役——历史行或含质量题区照展示）；insufficient_ticks=锚窗
      // 不足未判定放行；其余状态如实
      let buyPointHtml = '';
      if (buyPointInfo && !bpSilent) {
        const bpStatus = buyPointInfo.status || '';
        // T241/T243：标题按答案来源（Jev 代文案不变）——因子代 BPF3 只评塞单门；历史
        // BPF2 行带 crash 形态复核判据（分支 + 判据八键做成判据块，替代 Jev 代维度题区）
        const bpFactor = isFactorGen(buyPointInfo);
        const a0 = buyPointInfo.assessment || null; // 类型 policy 塞单门-only 的拒/放行 rule
        const bpTitle = bpFactor
          ? (buyPointInfo.factorTrace
            ? `🎯 BP 买点门（第 4 层 · 因子代 ${this._escapeHtml(factorGenVersion(buyPointInfo))} · 零 Jev）`
            : `🎯 BP 塞单门（第 4 层 · 因子代 ${this._escapeHtml(factorGenVersion(buyPointInfo))} · 纯代码）`)
          : ((buyPointInfo.policy === 'stuffingOnly' || (a0 && a0.rule === 'policy_stuffing_only'))
            ? '🎯 BP 塞单门（第 4 层 · 类型 policy：只评塞单门）'
            : '🎯 BP 买入点位门（第 4 层 · Jev 3 题）');
        const bpCrashForm = buyPointInfo.factorTrace && buyPointInfo.factorTrace.crashForm;
        const bpCrashHit = !!(bpCrashForm && bpCrashForm.hit);
        const bpCrashFormHtml = bpCrashForm ? `
            <div class="mt-1 p-1.5 rounded border ${bpCrashHit ? 'border-red-400 bg-red-50' : 'border-blue-400 bg-gray-900'}">
              <div class="flex items-center justify-between gap-2 text-xs">
                <span class="${bpCrashHit ? 'text-red-900 font-semibold' : 'text-blue-300 font-medium'}">📉 crash 形态复核（纯代码：无回调 + 无换手的单边下跌）</span>
                <span class="px-1.5 py-0.5 rounded border ${bpCrashHit ? 'bg-red-200 text-red-900 border-red-500 font-bold' : 'bg-gray-200 text-gray-800 border-gray-400'}">${bpCrashHit ? '🚫 命中' : '未命中'}</span>
              </div>
              <div class="text-xs ${bpCrashHit ? 'text-red-900' : 'text-gray-700'} mt-0.5">${this._escapeHtml(BP_CRASHFORM_BRANCH_LABELS[bpCrashForm.branch] || bpCrashForm.branch || '—')}</div>
              ${bpCrashForm.trace ? `<div class="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs mt-1 sm:grid-cols-4">${BP_CRASHFORM_TRACE_LABELS.map(([k, label, line]) => `
                <div class="flex items-center justify-between gap-1 bg-gray-900 px-1.5 py-0.5 rounded border ${bpCrashHit ? 'border-red-300' : 'border-gray-700'}">
                  <span class="text-gray-700">${label}${line ? ` <span class="text-gray-600">（${line}）</span>` : ''}</span>
                  <span class="text-gray-100 font-mono">${bpCrashForm.trace[k] == null ? '—' : this._escapeHtml(String(bpCrashForm.trace[k]))}</span>
                </div>`).join('')}</div>` : ''}
            </div>` : '';
        if (bpStatus === 'assessed' && buyPointInfo.assessment) {
          const a = buyPointInfo.assessment;
          const bpBucket = String(a.bucket || '?');
          // 塞单门拒沿用 Jev 代 bucket='poor' 字段名——展示不得冒充六桶判定（2026-11-26
          // Hawking 0x110c 案：用户疑问「现在不是已经没 BP 了吗」）
          const bpIsStuffing = a.rule === 'stuffing_gate' || a.rule === 'policy_stuffing_only';
          const bpBadge = bpBucket === 'good'
            ? '<span class="text-xs px-2 py-1 bg-green-200 text-green-900 rounded-full font-bold">✅ good（放行）</span>'
            : (bpBucket === 'neutral'
              ? '<span class="text-xs px-2 py-1 bg-yellow-200 text-yellow-900 rounded-full font-bold">🟡 neutral（放行）</span>'
              : (bpIsStuffing
                ? '<span class="text-xs px-2 py-1 bg-red-200 text-red-900 rounded-full font-bold" title="同一区块 ∧ 金额四位小数全等 ∧ ≥8 钱包（BP67 塞单门，因子代 BP 门唯一拒因）">🚫 塞单门拒</span>'
                : '<span class="text-xs px-2 py-1 bg-red-200 text-red-900 rounded-full font-bold">🚫 poor（拒）</span>'));
          const qRows = Object.entries(buyPointInfo.qualities || {})
            .map(([qk, q]) => {
              // 条目可整项 null（题退役/Jev 拒答容缺）——缺席渲染 '—' 防崩页
              const qBucket = q ? String(q.bucket ?? '—') : '—';
              return `
            <div class="flex items-center justify-between gap-2 bg-gray-900 px-2 py-1 rounded border border-blue-400">
              <span class="text-gray-800">${this._escapeHtml(BP_QUALITY_LABELS[qk] || qk)}<span class="text-gray-600 ml-1">${this._escapeHtml(qk)}</span></span>
              <span class="flex items-center gap-1">
                <span class="px-1.5 py-0.5 rounded border ${gateBucketClass(q && q.bucket === 'insufficient' ? '' : (q ? q.bucket : null))}">${this._escapeHtml(qBucket)}</span>
                ${q && q.prob != null ? `<span class="text-gray-700">p=${Number(q.prob).toFixed(2)}</span>` : ''}
              </span>
            </div>`;
            }).join('');
          const dimRows = Object.entries(buyPointInfo.dimensions || {})
            .filter(([dk]) => !BP_DIMENSION_HIDDEN.has(dk)) // price_level/price_trend 退役维度展示删除（2026-11-15 用户指令）
            .map(([dk, d]) => {
              // 维度缺席 null=题退役（BP60 起 price_trend/price_level 不再问）/材料薄/Jev 拒答——容缺渲染 '—'
              const dBucket = d ? String(d.bucket ?? '—') : '—';
              // 盘面类型落硬拒桶（famous_monopoly/one_wave_dump）=不符合通过要求——整行标红（2026-11-15 用户指令）
              const isPoorPattern = dk === 'market_pattern' && BP_MARKET_PATTERN_POOR_BUCKETS.has(dBucket);
              const rowBorder = isPoorPattern ? 'border-red-400 bg-red-50' : 'border-blue-400 bg-gray-900';
              const bucketClass = isPoorPattern
                ? 'px-1.5 py-0.5 rounded border bg-red-200 text-red-900 border-red-500 font-bold'
                : 'px-1.5 py-0.5 rounded border bg-gray-200 text-gray-800 border-gray-400';
              return `
            <div class="flex items-center justify-between gap-2 px-2 py-1 rounded border ${rowBorder}">
              <span class="${isPoorPattern ? 'text-red-900 font-semibold' : 'text-gray-800'}">${this._escapeHtml(BP_DIMENSION_LABELS[dk] || dk)}${isPoorPattern ? '（拒买盘形）' : ''}</span>
              <span class="flex items-center gap-1">
                <span class="${bucketClass}">${this._escapeHtml(dBucket)}</span>
                ${d && d.prob != null ? `<span class="text-gray-700">p=${Number(d.prob).toFixed(2)}</span>` : ''}
              </span>
            </div>`;
            }).join('');
          const anchorRows = Object.entries(buyPointInfo.anchors || {})
            .map(([ak, av]) => `
            <div class="flex items-center justify-between gap-2 bg-gray-900 px-2 py-0.5 rounded border border-blue-400">
              <span class="text-gray-700">${this._escapeHtml(ak)}</span>
              <span class="text-gray-100 font-mono">${av == null ? '—' : (typeof av === 'number' ? (Number.isInteger(av) ? av : Number(av).toFixed(4)) : this._escapeHtml(String(av)))}</span>
            </div>`).join('');
          buyPointHtml = `
          <div class="mt-2 pt-2 border-t border-blue-300">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-blue-300">${bpTitle}</div>
              ${bpBadge}
            </div>
            <div class="flex flex-wrap gap-2 text-xs text-gray-800 mb-1">
              ${bpFactor ? '' : `<span>综合概率 p=${a.prob != null ? Number(a.prob).toFixed(2) : '—'}</span>`}
              ${a.rule ? `<span>规则 <code class="bg-gray-900 px-1 rounded">${this._escapeHtml(String(a.rule))}</code></span>` : ''}
              ${buyPointInfo.passed === true ? '<span class="text-green-400 font-medium">→ 放行</span>' : '<span class="text-red-400 font-medium">→ 拒</span>'}
              <span class="text-gray-600">model=${this._escapeHtml(String(buyPointInfo.model || '—'))}${buyPointInfo.usage ? ` · in=${buyPointInfo.usage.input_tokens ?? '—'} out=${buyPointInfo.usage.output_tokens ?? '—'}` : ''}</span>
            </div>
            ${qRows ? `<div class="text-xs text-blue-300 mb-1">质量题（任一 good→good，否则任一 neutral→neutral，否则 poor）：</div><div class="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">${qRows}</div>` : ''}
            ${bpFactor ? bpCrashFormHtml : (dimRows ? `<details class="mt-1" open><summary class="text-xs text-blue-300 cursor-pointer select-none">📐 维度题（参考不进门链，默认展开）</summary><div class="mt-1 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">${dimRows}</div></details>` : '')}
            ${anchorRows ? `<details class="mt-1"><summary class="text-xs text-blue-300 cursor-pointer select-none">🧭 盘面锚值 ${Object.keys(buyPointInfo.anchors || {}).length} 锚（点开展开）</summary><div class="mt-1 grid grid-cols-2 gap-1 text-xs sm:grid-cols-3 lg:grid-cols-4">${anchorRows}</div></details>` : ''}
          </div>
          `;
        } else if (bpStatus === 'insufficient_ticks') {
          buyPointHtml = `
          <div class="mt-2 pt-2 border-t border-blue-300">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-blue-300">${bpTitle}</div>
              <span class="text-xs px-2 py-1 bg-gray-200 text-gray-800 rounded-full">未判定·拒</span>
            </div>
            <div class="text-xs text-gray-700">锚窗 ${this._escapeHtml(String(buyPointInfo.anchorTickCount ?? '—'))} ticks &lt; minTicks 7，${isFactorGen(buyPointInfo) ? '不判定' : '不调 Jev 不判定'}——BP10 裁定 insufficient_ticks 硬拒（数据不够就挡住）</div>
          </div>
          `;
        } else {
          const failLabel = bpStatus === 'fail' ? `判定失败（reason=${this._escapeHtml(String(buyPointInfo.reason || '—'))}）→ fail-closed 拒`
            : bpStatus === 'timeout' ? '竞速超时 → fail-closed 拒'
            : bpStatus === 'disabled' ? 'buyPointCheck.enabled=false → 全拒（配置矛盾）'
            : `status=${this._escapeHtml(bpStatus || '—')}`;
          buyPointHtml = `
          <div class="mt-2 pt-2 border-t border-blue-300">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-blue-300">${bpTitle}</div>
              <span class="text-xs px-2 py-1 bg-red-200 text-red-900 rounded-full">拒</span>
            </div>
            <div class="text-xs text-gray-700">${failLabel}</div>
          </div>
          `;
        }
      }

      // 购买前置检查结果
      const checkResultBadge = pr.canBuy === false ?
        '<span class="text-xs px-2 py-1 bg-red-200 text-red-900 rounded-full">❌ 失败</span>' :
        '<span class="text-xs px-2 py-1 bg-green-200 text-green-900 rounded-full">✅ 通过</span>';

      // 永久阻断标识
      const permanentBlockBadge = pf.permanentBlockTriggered
        ? '<span class="ml-1 text-xs px-2 py-1 bg-red-200 text-red-900 rounded-full font-bold">🚫 永久阻断</span>'
        : '';

      // 显示实验配置的策略条件
      let strategyConfigHtml = '';
      if (buyCondition || preBuyCheckCondition || gmgnCheckCondition || pf.permanentBlockCondition) {
        strategyConfigHtml = `
          <div class="mb-2 pb-2 border-b border-amber-300">
            ${buyCondition ? `
              <div class="text-xs mb-1">
                <span class="font-semibold text-amber-200">📋 买入条件配置:</span>
                <code class="ml-2 px-2 py-0.5 bg-gray-900 rounded text-xs text-amber-200 break-all">${this._escapeHtml(buyCondition)}</code>
                ${this._packVersionNote ? `<span class="text-yellow-600">${this._escapeHtml(this._packVersionNote)}</span>` : ''}
                ${this._renderConditionFactorChips(buyCondition, metadata)}
              </div>
            ` : ''}
            ${preBuyCheckCondition ? `
              <div class="text-xs">
                <span class="font-semibold text-amber-200">🔍 预检查条件配置 (第${buyRound}轮${buyRound > 1 ? '购买' : ''}):</span>
                <code class="ml-2 px-2 py-0.5 bg-gray-900 rounded text-xs text-amber-200 break-all">${this._escapeHtml(preBuyCheckCondition)}</code>
                ${this._renderConditionFactorChips(preBuyCheckCondition, metadata)}
              </div>
            ` : ''}
            ${gmgnCheckCondition ? `
              <div class="text-xs mt-1">
                <span class="font-semibold text-amber-900">🛡️ GMGN 条件配置 (买前第三层实时):</span>
                <code class="ml-2 px-2 py-0.5 bg-gray-900 rounded text-xs text-amber-200 break-all">${this._escapeHtml(gmgnCheckCondition)}</code>
                ${this._renderGmgnCheckChips(gmgnCheckCondition, gmgnCheckInfo, metadata)}
              </div>
            ` : ''}
            ${pf.permanentBlockCondition ? `
              <div class="text-xs mt-1">
                <span class="font-semibold text-red-900">🚫 永久阻断条件:</span>
                <code class="ml-2 px-2 py-0.5 bg-red-200 rounded text-xs text-red-900 break-all">${this._escapeHtml(pf.permanentBlockCondition)}</code>
              </div>
            ` : ''}
          </div>
        `;
      }

      // TPA 持仓分析因子块（买腿 condition 引用 TPAPre_* 时复盘用；键由引擎
      // buildTpaFactorSnapshot 于 fire 时刻快照写入 metadata.tpaFactors）
      let tpaFactorsHtml = '';
      const tpf = metadata.tpaFactors;
      if (tpf) {
        const analyzed = tpf.TPAAnalyzed === 1;
        // 从买入条件解析 TPAPre_tokenScore 阈值染色（如 "TPAPre_tokenScore > 2.2"）
        let tsClass = 'text-gray-100';
        const tsMatch = buyCondition && buyCondition.match(/TPAPre_tokenScore\s*([<>]=?|==)\s*([0-9.]+)/);
        if (tsMatch && tpf.TPAPre_tokenScore != null) {
          const op = tsMatch[1], thr = parseFloat(tsMatch[2]), v = Number(tpf.TPAPre_tokenScore);
          const ok = op === '>' ? v > thr : op === '>=' ? v >= thr : op === '<' ? v < thr : op === '<=' ? v <= thr : v === thr;
          tsClass = ok ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold';
        }
        const ratioDisp = tpf.TPAPre_zhuangRetailRatioInfinite ? '∞'
          : (tpf.TPAPre_zhuangRetailRatio == null ? 'null' : Number(tpf.TPAPre_zhuangRetailRatio).toFixed(2));
        const pct = (v) => v == null ? 'N/A' : Number(v).toFixed(1) + '%';
        const num = (v, d = 2) => v == null ? 'null' : Number(v).toFixed(d);
        tpaFactorsHtml = `
          <div class="mt-2 pt-2 border-t border-gray-600">
            <div class="text-xs font-semibold text-amber-200 mb-1">🎯 TPA 持仓分析因子（fire 时刻快照）</div>
            <div class="grid grid-cols-3 gap-2 text-xs">
              <div><span class="text-amber-200">TPA 状态:</span> <span class="${analyzed ? 'text-green-400' : 'text-red-400'}">${analyzed ? '✅ 已检测' : '❌ 未检测(null fail-closed)'}</span></div>
              <div><span class="text-amber-200">总分(0-5):</span> <span class="${tsClass}">${num(tpf.TPAPre_tokenScore)}</span></div>
              <div><span class="text-amber-200">庄散比:</span> <span class="text-gray-100">${ratioDisp}</span></div>
              <div><span class="text-amber-200">净吸收:</span> <span class="text-gray-100">${pct(tpf.TPAPre_walletHoldingPct)}</span></div>
              <div><span class="text-amber-200">庄占比:</span> <span class="text-gray-100">${pct(tpf.TPAPre_zhuangPct)}</span></div>
              <div><span class="text-amber-200">新钱包占比:</span> <span class="text-gray-100">${pct(tpf.TPAPre_newWalletPct)}</span></div>
              <div><span class="text-amber-200">散占比:</span> <span class="text-gray-100">${pct(tpf.TPAPre_retailPct)}</span></div>
              <div><span class="text-amber-200">中占比:</span> <span class="text-gray-100">${pct(tpf.TPAPre_neutralPct)}</span></div>
              <div><span class="text-amber-200">庄/散/新/中分:</span> <span class="text-gray-100">${num(tpf.TPAPre_zhuangScore)}/${num(tpf.TPAPre_retailScore)}/${num(tpf.TPAPre_newWalletScore)}/${num(tpf.TPAPre_neutralScore)}</span></div>
              <div><span class="text-amber-200">retention:</span> <span class="text-gray-100">${num(tpf.TPAPre_retention)}</span></div>
              <div><span class="text-amber-200">asof相对首价:</span> <span class="text-gray-100">${num(tpf.TPAPre_asofRelFirst)}</span></div>
              <div><span class="text-amber-200">画像就绪年龄:</span> <span class="text-gray-100">${tpf.TPAPre_analyzedAgeSec == null ? 'null' : num(tpf.TPAPre_analyzedAgeSec, 0) + 's'}</span></div>
            </div>
          </div>
        `;
      }

      // 叙事分析轮次摘要（C84 新模型腿）：fire 时刻快照 metadata.narrativeRoundsSummary
      //（轮数/终评/分析提前量 leadMs=fire−末轮完成；rating 门在单一买条件内）
      let narrativeRoundsHtml = '';
      const nrs = metadata.narrativeRoundsSummary;
      if (nrs) {
        const pass = nrs.finalRating === 2 || nrs.finalRating === 3;
        const lead = Number(nrs.leadMs);
        narrativeRoundsHtml = `
          <div class="mt-2 pt-2 border-t border-gray-600">
            <div class="text-xs font-semibold text-amber-200 mb-1">🧠 叙事分析轮次（触发条件链）</div>
            <div class="grid grid-cols-3 gap-2 text-xs">
              <div><span class="text-amber-200">轮数:</span> <span class="text-gray-100">${nrs.rounds}</span></div>
              <div><span class="text-amber-200">终评:</span> <span class="${pass ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}">${nrs.finalRating == null ? 'null' : nrs.finalRating}${pass ? '（过门）' : '（拦截）'}</span></div>
              <div><span class="text-amber-200">分析提前量:</span> <span class="text-gray-100">${Number.isFinite(lead) ? (lead / 1000).toFixed(1) + 's' : '—'}</span></div>
            </div>
          </div>
        `;
      }

      // 构建条件检查详情
      let failedConditionsHtml = '';
      if (pr.failedConditions && pr.failedConditions.length > 0) {
        const failedItems = pr.failedConditions.map(fc => {
          const severityIcon = fc.severity === 'critical' ? '🔴' : fc.severity === 'warning' ? '⚠️' : 'ℹ️';

          // 子因子（复杂条件中的组成因子）的显示逻辑
          if (fc.isSubFactor) {
            return `
              <div class="flex items-start justify-between py-1 border-b border-amber-100 last:border-0 bg-amber-50">
                <div class="flex-1 pl-4">
                  <div class="text-xs text-amber-200">
                    <span class="font-medium">${fc.name}</span>
                  </div>
                  <div class="text-xs text-amber-300 ml-4">
                    <span class="text-gray-700">表达式:</span> <code class="text-xs bg-gray-900 px-1 rounded">${this._escapeHtml(fc.expression)}</code>
                  </div>
                </div>
                <div class="ml-2 text-right">
                  <div class="text-xs text-gray-600 font-medium">${this._escapeHtml(fc.actualFormatted)}</div>
                </div>
              </div>
            `;
          }

          // 正常条件的显示逻辑
          const statusIcon = fc.satisfied ? '✅' : '❌';
          const statusClass = fc.satisfied ? 'text-green-400' : 'text-red-400';

          // 风险指示：宽松/边缘
          let marginBadge = '';
          if (fc.satisfied && fc.margin === 'loose') {
            marginBadge = '<span class="ml-2 text-xs px-1.5 py-0.5 bg-green-200 text-green-800 rounded">🟢 宽松</span>';
          } else if (fc.satisfied && fc.margin === 'edge') {
            marginBadge = '<span class="ml-2 text-xs px-1.5 py-0.5 bg-yellow-200 text-yellow-800 rounded">🟡 边缘</span>';
          }

          return `
            <div class="flex items-start justify-between py-1 border-b border-amber-200 last:border-0 ${fc.isComplex ? 'bg-amber-50' : ''}">
              <div class="flex-1">
                <div class="text-xs text-amber-200">
                  <span class="mr-1">${severityIcon}</span>
                  <span class="font-semibold">${fc.name}</span>
                  ${marginBadge}
                </div>
                <div class="text-xs text-amber-300 ml-5">
                  <span class="text-gray-600">条件:</span> <code class="text-xs bg-gray-900 px-1 rounded">${this._escapeHtml(fc.expression)}</code>
                </div>
              </div>
              <div class="ml-2 text-right">
                <div class="text-xs ${statusClass} font-semibold">${statusIcon} ${fc.satisfied === null ? '-' : (fc.satisfied ? '满足' : '不满足')}</div>
                <div class="text-xs text-gray-600">实际: ${this._escapeHtml(fc.actualFormatted)}</div>
              </div>
            </div>
          `;
        }).join('');

        failedConditionsHtml = `
          <div class="mt-2 pt-2 border-t border-gray-600">
            <div class="text-xs font-semibold text-amber-200 mb-1">📋 条件检查详情</div>
            <div class="bg-gray-900 rounded p-2 border border-gray-700 max-h-80 overflow-y-auto">
              ${failedItems}
            </div>
            ${pr.reason ? `<div class="text-xs text-amber-200 mt-2">📝 ${this._escapeHtml(pr.reason)}</div>` : ''}
          </div>
        `;
      } else if (pr.reason) {
        failedConditionsHtml = `<div class="text-xs text-amber-200 mt-2 border-t border-gray-600 pt-2">${this._escapeHtml(pr.reason)}</div>`;
      }

      // 第三层 GMGN 检查审计块（metadata.gmgnCheck：拒/过两路径引擎都落；
      // 因子值是下单前实时调 GMGN getTokenInfo 的结果，与 preBuy 直调快照口径不同）
      let gmgnCheckHtml = '';
      if (gmgnCheckInfo) {
        const gf = gmgnCheckInfo.factors || {};
        const covered = gf.gmgnRiskCovered === 1;
        // 通过三态：真评估过=绿；无数据跳过（fail-open，2026-10-20）=琥珀；未过=红
        const gmgnPassBadge = gmgnCheckInfo.passed
          ? (covered
            ? '<span class="text-xs px-2 py-1 bg-green-200 text-green-900 rounded-full">✅ 通过</span>'
            : '<span class="text-xs px-2 py-1 bg-amber-200 text-amber-900 rounded-full">⚠️ 放行（无数据跳过）</span>')
          : '<span class="text-xs px-2 py-1 bg-red-200 text-red-900 rounded-full">❌ 未过</span>';
        const num = (v, d = 1) => v == null ? 'null' : Number(v).toFixed(d);
        const valueCls = covered ? 'text-gray-100' : 'text-gray-400';
        const auditBits = [];
        if (gf.durationMs != null) auditBits.push(`耗时 ${num(gf.durationMs, 0)}ms`);
        if (gf.fromCache != null) auditBits.push(`cache=${gf.fromCache ? '1' : '0'}`);
        gmgnCheckHtml = `
          <div class="mt-2 pt-2 border-t border-gray-600">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-amber-200">🛡️ GMGN 风险检查（买前第三层实时）</div>
              ${gmgnPassBadge}
            </div>
            <div class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div><span class="text-amber-200">bundler 钱包占比:</span> <span class="${valueCls}">${num(gf.gmgnBundlerWalletRatio)}%</span></div>
              <div><span class="text-amber-200">推特关联发币数:</span> <span class="${valueCls}">${num(gf.gmgnIssuerTokenCount, 0)}</span></div>
              <div><span class="text-amber-200">实时访问人数:</span> <span class="${valueCls}">${num(gf.gmgnVisitingCount, 0)}</span></div>
              <div><span class="text-amber-200">covered:</span> <span class="${covered ? 'text-green-400' : 'text-amber-300'}">${covered ? '1（有数据）' : '0（无数据 → 放行）'}</span></div>
              ${auditBits.length > 0 ? `<div class="col-span-3 text-gray-700">${auditBits.join(' · ')}</div>` : ''}
              ${gmgnCheckInfo.reason ? `<div class="col-span-3 ${gmgnCheckInfo.passed ? 'text-amber-300' : 'text-red-400'}">📝 ${this._escapeHtml(gmgnCheckInfo.reason)}</div>` : ''}
            </div>
          </div>
        `;
      }

      // 作弊盘检测块（CD158，2026-11-03 重构）：买信号驱动作弊门=最后一层买条件——
      // grade 在场=门条件已评估（conditionPassed=false 的拒买路径不落 metadata，
      // 此处只见放行形状）；fail-open 形状（insufficient_ticks/fail/timeout/skipped）
      // 如实展示；initiated/joined_inflight/reused=CD158 前历史行
      let cheatCheckHtml = '';
      // T243b：恒放行层静默（类型 policy 直通 / 因子代 CF1 无拒臂 healthy）——不渲染明细卡；
      // 因子代若产拒（grade=cheat/unhealthy）照常走下方 grade 分支
      if (cheatCheckInfo && !cheatSilent) {
        const cs = cheatCheckInfo.status || '';
        if (cheatCheckInfo.grade) {
          const g = cheatCheckInfo.grade;
          // 展示口径（2026-11-09 用户裁定）：检测出作弊就是作弊——豁免票主徽章显示
          // 原始判定 grade（exempt.originalGrade），豁免信息单独说明；不把检测是
          // 作弊/不健康的票展示成 healthy。grade 字段本身=豁免改写后的门决策语义
          // （下游消费不动），此处仅展示层还原。
          const exempt = cheatCheckInfo.exempt || null;
          const denied = cheatCheckInfo.exemptDenied || null;
          const showG = exempt && exempt.originalGrade ? exempt.originalGrade : g;
          // 活跃度桶徽章（2026-11-09 用户要求放判定结果旁边——原来只在 16 题明细
          // 折叠里可见，cheat/unhealthy 豁免判读须一眼对照 activity 档位）
          // T217 观测级门控：门决策 grade 由类型规则集重评（观测行落原始 grade）——
          // 分叉时展示「规则集 g23NoSlowGrind：原判 X → 门决策 Y」
          const rsBadge = cheatCheckInfo.ruleset && cheatCheckInfo.rawGrade && cheatCheckInfo.rawGrade !== g
            ? `<span class="text-xs px-2 py-1 rounded-full border border-indigo-400 bg-indigo-200 text-indigo-900 font-bold" title="T217 观测级门控：本类型携带差集规则集，原始观测 grade 与门决策 grade 分叉">🧭 规则集 ${this._escapeHtml(String(cheatCheckInfo.ruleset))}：原判 ${this._escapeHtml(String(cheatCheckInfo.rawGrade))} → 门决策 ${this._escapeHtml(String(g))}</span>`
            : '';
          const actBucket = (cheatCheckInfo.buckets && cheatCheckInfo.buckets.activityLevel) || null;
          const actBadge = actBucket
            ? `<span class="text-xs px-2 py-1 rounded-full border ${gateBucketClass(actBucket)}">活跃度 ${this._escapeHtml(String(actBucket))}</span>`
            : '';
          // 盘面 burst 徽章（2026-11-18 用户要求一眼可见）：BP68/T144 act 题退役后
          // burst 档不再由 BP 产出，sbw=burst 是盘面 burst 的唯一载体——原来只在
          // 16 题明细折叠里可见；与活跃度徽章并排展示（不拦买入，形状标注）
          const sbwBucket = (cheatCheckInfo.buckets && cheatCheckInfo.buckets.stallBurstWave) || null;
          const burstBadge = sbwBucket === 'burst'
            ? `<span class="text-xs px-2 py-1 rounded-full border border-indigo-400 bg-indigo-200 text-indigo-900 font-bold" title="cheat 门停滞突发波判定 sbw=burst：沉积后一波操盘形状（不拦买入；CD397 豁免资格臂输入）">⚡ 盘面 burst</span>`
            : '';
          const EXEMPT_LABELS = {
            activity_high: '活跃度豁免（high 档）',
            activity_ultra: '活跃度豁免（ultra 档）',
            stall_burst: '长期沉积一波操盘豁免（burst 臂）',
          };
          const exemptBadge = exempt
            ? `<span class="text-xs px-2 py-1 bg-yellow-100 text-yellow-900 rounded-full font-bold">🟡 已豁免放行：${this._escapeHtml(EXEMPT_LABELS[exempt.code] || exempt.code)}</span>`
            : '';
          const deniedBadge = denied
            ? `<span class="text-xs px-2 py-1 bg-red-100 text-red-800 rounded-full">豁免失效（${this._escapeHtml(denied)}·原判保持）</span>`
            : '';
          const gBadge = rsBadge + (showG === 'cheat'
            ? `<span class="text-xs px-2 py-1 bg-red-200 text-red-900 rounded-full font-bold">🚫 cheat（检测判定${exempt ? '' : '：拉黑不再交易+持仓清仓'}）</span>${exemptBadge}${deniedBadge}`
            : (showG === 'unhealthy'
              ? `<span class="text-xs px-2 py-1 bg-amber-200 text-amber-900 rounded-full font-bold">⚠️ unhealthy（检测判定）</span>${exemptBadge}${deniedBadge}`
              : (g === 'unhealthy'
                ? (executionReason === 'cheat_gate_unhealthy'
                  ? '<span class="text-xs px-2 py-1 bg-red-200 text-red-900 rounded-full font-bold">⚠️ unhealthy（本信号拒·cheatRecheck 腿下个买信号自动重判）</span>'
                  : '<span class="text-xs px-2 py-1 bg-amber-200 text-amber-900 rounded-full">⚠️ unhealthy（本信号已重判·条件放行）</span>')
                : `<span class="text-xs px-2 py-1 bg-green-200 text-green-900 rounded-full">✅ healthy（粘滞保持·条件放行）</span>`)));
          const codes = (cheatCheckInfo.reasons || []).map((r) => r.code).filter(Boolean).join(', ');
          // CD158 来源位：cached=同题集版本粘滞秒回（零 Jev）；graded=本信号真析；
          // reused=旧形状（增量门重用，历史行）
          const srcBit = cheatCheckInfo.cached === true ? '（粘滞秒回·零 Jev）'
            : (cs === 'graded' ? '（本信号真析）'
              : (cs === 'reused' ? '（增量门内重用上次判定·历史形状）' : ''));
          // 16 题档位明细（buckets 词档 + levels 数值，按严重度降序——T117 明细展示）
          let cheatQuestionsHtml = '';
          const buckets = cheatCheckInfo.buckets || null;
          const levels = cheatCheckInfo.levels || null;
          if (buckets && typeof buckets === 'object') {
            const rows = Object.keys(buckets)
              .map((k) => ({ k, bucket: buckets[k], level: levels ? levels[k] : null }))
              .sort((a, b) => gateBucketSortKey(a.bucket) - gateBucketSortKey(b.bucket));
            cheatQuestionsHtml = `
            <details class="mt-2">
              <summary class="text-xs text-amber-200 cursor-pointer select-none">📋 10 题档位明细（Jev 题集，点开展开）</summary>
              <div class="mt-1 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                ${rows.map((r) => `
                <div class="flex items-center justify-between gap-2 bg-gray-900 px-2 py-1 rounded border border-gray-700">
                  <span class="text-gray-800 truncate" title="${this._escapeHtml(r.k)}">${this._escapeHtml(CHEAT_QUESTION_LABELS[r.k] || r.k)}<span class="text-gray-600 ml-1">${this._escapeHtml(r.k)}</span></span>
                  <span class="flex items-center gap-1 shrink-0">
                    <span class="px-1.5 py-0.5 rounded border ${gateBucketClass(r.bucket)}">${this._escapeHtml(String(r.bucket ?? '—'))}</span>
                    ${r.level != null ? `<span class="text-gray-700">L=${this._escapeHtml(String(r.level))}</span>` : ''}
                  </span>
                </div>`).join('')}
              </div>
            </details>
            `;
          }
          cheatCheckHtml = `
          <div class="mt-2 pt-2 border-t border-gray-600">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-amber-200">🚨 作弊盘检测门（第 3 层 · Jev 10 题）</div>
              <div class="flex items-center gap-1 flex-wrap justify-end">${gBadge}${actBadge}${burstBadge}</div>
            </div>
            <div class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              ${g === 'unhealthy' && cheatCheckInfo.unhealthyGrades != null ? `<div><span class="text-amber-200">unhealthy 判定次数:</span> ${cheatCheckInfo.unhealthyGrades}（下个买信号自动重判）</div>` : ''}
              ${cheatCheckInfo.conditionPassed === true ? '<div><span class="text-amber-200">门条件:</span> 通过</div>' : ''}
              ${cheatCheckInfo.condition ? `<div class="col-span-3"><span class="text-amber-200">门条件表达式:</span> <code class="text-xs bg-gray-900 px-1 rounded">${this._escapeHtml(String(cheatCheckInfo.condition))}</code>${cheatCheckInfo.conditionError ? ` <span class="text-red-700">评估异常: ${this._escapeHtml(String(cheatCheckInfo.conditionError))}</span>` : ''}</div>` : ''}
              ${codes ? `<div class="col-span-3"><span class="text-amber-200">触发通道:</span> <code class="text-xs bg-gray-900 px-1 rounded">${this._escapeHtml(codes)}</code></div>` : ''}
              ${exempt ? `<div class="col-span-3"><span class="text-amber-200">豁免链路:</span> 检测判定 <b>${this._escapeHtml(exempt.originalGrade)}</b> → ${this._escapeHtml(EXEMPT_LABELS[exempt.code] || exempt.code)} → 门决策 grade=${this._escapeHtml(g)} 放行</div>` : ''}
              ${denied ? `<div class="col-span-3"><span class="text-amber-200">豁免失效:</span> exemptDenied=${this._escapeHtml(denied)}（不豁免臂/资格收紧命中，原判保持）</div>` : ''}
              <div class="col-span-3 text-gray-700">status=${this._escapeHtml(cs)}${srcBit} ${srcBit ? '' : '（档位判据=Jev 10 题；映射=cheat-grade G22）'}</div>
            </div>
            ${cheatQuestionsHtml}
          </div>
          `;
        } else if (cs === 'timeout_fail_open') {
          cheatCheckHtml = `
          <div class="mt-2 pt-2 border-t border-gray-600">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-amber-200">🚨 作弊盘检测门（第 3 层 · Jev 10 题）</div>
              <span class="text-xs px-2 py-1 bg-amber-200 text-amber-900 rounded-full">⏱️ 竞速超时放行</span>
            </div>
            <div class="text-xs text-gray-700">本笔放行（等待 ${cheatCheckInfo.awaitMs ?? '—'}ms 未出结果）；迟到结果下轮生效（cheat 迟到则补拉黑+清仓）</div>
          </div>
          `;
        } else if (cs === 'skipped_by_act_front') {
          // T175/AF1 跳过路径（high/burst 豁免票）：活跃度门分流跳过——不烧 10 题
          // Jev，档位判定在上方②前置活跃度门卡片；levels.stallBurstWave 保留供
          // BP cheatBurst 透传链（burst 票 BP state 行在场）
          cheatCheckHtml = `
          <div class="mt-2 pt-2 border-t border-gray-600">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-amber-200">🚨 作弊盘检测门（第 3 层 · Jev 10 题）</div>
              <span class="text-xs px-2 py-1 bg-indigo-200 text-indigo-900 rounded-full border border-indigo-400 font-semibold">⏭ 被活跃度门跳过</span>
            </div>
            <div class="text-xs text-gray-700">分流 path=${this._escapeHtml(String(cheatCheckInfo.path || '—'))}（act=${this._escapeHtml(String(cheatCheckInfo.act || '—'))}${cheatCheckInfo.sbw ? ` · sbw=${this._escapeHtml(String(cheatCheckInfo.sbw))}` : ''}）——高活跃度/burst/停滞再启动通路票不烧 10 题直接进④BP 门；档位判定见上方活跃度门卡片</div>
          </div>
          `;
        } else {
          // fail-open 放行态（insufficient_ticks·fail·skipped·error）与 CD158 前
          // 历史观察行（initiated/joined_inflight——观察模式已随 CD158 退役）
          const label = cs === 'insufficient_ticks' ? '放行（锚窗 tick 不足，不判定）'
            : cs === 'fail' ? `放行（检测层故障 reason=${cheatCheckInfo.reason || '—'}）`
            : cs === 'skipped' ? '放行（cheatCheck.enabled=false 门跳过）'
            : cs === 'error' ? `放行（接线异常 reason=${cheatCheckInfo.reason || '—'}${cheatCheckInfo.grade ? ` grade=${cheatCheckInfo.grade}` : ''}）`
            : cs === 'initiated' ? '历史观察行（CD158 前观察模式：已发起后台分析）'
            : cs === 'joined_inflight' ? '历史观察行（CD158 前观察模式：并入进行中的分析）'
            : `放行（status=${cs || '—'}）`;
          cheatCheckHtml = `
          <div class="mt-2 pt-2 border-t border-gray-600">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-amber-200">🚨 作弊盘检测门（第 3 层 · Jev 10 题）</div>
              <span class="text-xs px-2 py-1 bg-gray-200 text-gray-800 rounded-full">放行</span>
            </div>
            <div class="text-xs text-gray-700">${this._escapeHtml(label)}${cheatCheckInfo.lastAnchorTickCount != null ? ` · 上次锚窗 ${cheatCheckInfo.lastAnchorTickCount} ticks` : ''}</div>
          </div>
          `;
        }
      }

      preBuyCheckHtml = `
        <div class="mt-2 p-3 bg-gray-800 rounded-lg border border-gray-600">
          <div class="flex items-center justify-between mb-2">
            <span class="text-amber-200 font-semibold text-sm">🔍 购买前置检查</span>
            <div class="flex items-center gap-1">
              ${checkResultBadge}
              ${permanentBlockBadge}
            </div>
          </div>
          ${strategyConfigHtml}
          ${pointTypeHtml}
          ${signalGateHtml}
          ${factorGateHtml}
          ${actFrontGateHtml}
          ${failedConditionsHtml}
          ${gmgnCheckHtml}
          ${cheatCheckHtml}
          ${buyPointHtml}
          ${tpaFactorsHtml}
          ${narrativeRoundsHtml}
        </div>
      `;
    }

    // 构建卖出策略信息（仅卖出信号）
    let sellStrategyHtml = '';
    if (signal.action.toUpperCase() === 'SELL') {
      const tf = metadata.trendFactors || {};
      const tradeResult = metadata.tradeResult || {};
      const buyPrice = tf.buyPrice || metadata.buyPrice || 0;

      // 🔥 获取卖出策略条件并解析阈值
      const sellCondition = this._getBuyCondition('sell', strategyId);
      const sellThresholds = sellCondition ? this._parseBuyCondition(sellCondition) : {};

      // 辅助函数：格式化数值
      const formatNum = (val, decimals = 2) => val !== undefined && val !== null ? Number(val).toFixed(decimals) : 'N/A';
      const formatPercent = (val) => val !== undefined && val !== null ? Number(val).toFixed(1) + '%' : 'N/A';

      // 显示实验配置的卖出策略条件（2026-11-04 用户要求：卖出信号也像买入信号一样
      // 展示条件因子值 chips——值取 fire 时刻 metadata.trendFactors 快照，171 键因子表
      // 含 marketCap/realHoldDuration/entryMarketCap 等全部卖腿条件因子）
      let sellStrategyConfigHtml = '';
      if (sellCondition) {
        sellStrategyConfigHtml = `
          <div class="mb-2 pb-2 border-b border-blue-300">
            <div class="text-xs">
              <span class="font-semibold text-blue-900">📋 卖出条件配置:</span>
              <code class="ml-2 px-2 py-0.5 bg-blue-200 rounded text-xs text-blue-900 break-all">${this._escapeHtml(sellCondition)}</code>
              ${this._packVersionNote ? `<span class="text-yellow-700">${this._escapeHtml(this._packVersionNote)}</span>` : ''}
              ${this._renderConditionFactorChips(sellCondition, metadata)}
            </div>
          </div>
        `;
      }

      // 卖出因子显示
      let sellFactorsHtml = '';
      if (Object.keys(tf).length > 0) {
        const drawdownClass = this._getFactorClass('drawdownFromHighest', tf.drawdownFromHighest || 0, sellThresholds);
        const holdDurationClass = this._getFactorClass('holdDuration', (tf.holdDuration || 0) / 60, sellThresholds);
        const profitPercentClass = tf.profitPercent >= 0 ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold';

        sellFactorsHtml = `
          <div class="mt-2 pt-2 border-t border-blue-300">
            <div class="text-xs font-semibold text-blue-900 mb-1">📉 卖出决策因子</div>
            <div class="grid grid-cols-3 gap-2 text-xs">
              <div><span class="text-blue-800">代币年龄:</span> <span class="text-gray-900">${formatNum(tf.age)}分</span></div>
              <div><span class="text-blue-800">持仓时长:</span> <span class="${holdDurationClass}">${formatNum(tf.holdDuration / 60)}分</span></div>
              <div><span class="text-blue-800">利润率:</span> <span class="${profitPercentClass}">${formatPercent(tf.profitPercent)}</span></div>
              <div><span class="text-blue-800">买入价格:</span> <span class="text-gray-900">${formatNum(buyPrice, 8)}</span></div>
              <div><span class="text-blue-800">当前价格:</span> <span class="text-gray-900">${formatNum(tf.currentPrice, 8)}</span></div>
              <div><span class="text-blue-800">最高价格:</span> <span class="text-gray-900">${formatNum(tf.highestPrice, 8)}</span></div>
              <div><span class="text-blue-800">距最高跌幅:</span> <span class="${drawdownClass}">${formatPercent(tf.drawdownFromHighest)}</span></div>
              ${tf.earlyReturn !== undefined ? `<div><span class="text-blue-800">早期收益率:</span> <span class="text-gray-900">${formatPercent(tf.earlyReturn)}</span></div>` : ''}
              ${tf.trendStrengthScore !== undefined ? `<div><span class="text-blue-800">趋势强度:</span> <span class="text-gray-900">${formatNum(tf.trendStrengthScore)}</span></div>` : ''}
              ${tf.trendTotalReturn !== undefined ? `<div><span class="text-blue-800">总回报:</span> <span class="text-gray-900">${formatPercent(tf.trendTotalReturn)}</span></div>` : ''}
              ${tf.holdDuration !== undefined ? `<div><span class="text-blue-800">买入后时长:</span> <span class="text-gray-900">${formatNum(tf.holdDuration / 60)}分</span></div>` : ''}
              ${tf.trendRecentDownRatio !== undefined ? `<div><span class="text-blue-800">近期下跌比:</span> <span class="text-gray-900">${formatNum(tf.trendRecentDownRatio)}</span></div>` : ''}
              ${tf.trendConsecutiveDowns !== undefined ? `<div><span class="text-blue-800">连跌次数:</span> <span class="text-gray-900">${tf.trendConsecutiveDowns}</span></div>` : ''}
              ${tf.trendDrawdownFromWindowHigh !== undefined ? `<div><span class="text-blue-800">窗口回撤:</span> <span class="${tf.trendDrawdownFromWindowHigh < -20 ? 'text-red-700' : 'text-gray-900'}">${formatPercent(tf.trendDrawdownFromWindowHigh)}</span></div>` : ''}
              ${tf.txVolumeU24h !== undefined ? `<div><span class="text-blue-800">24h交易量:</span> <span class="text-gray-900">$${formatNum(tf.txVolumeU24h / 1000)}K</span></div>` : ''}
            </div>
          </div>
        `;
      }

      // 交易结果信息
      let tradeResultHtml = '';
      if (tradeResult.trade && tradeResult.trade.success) {
        const trade = tradeResult.trade;
        const inputAmount = parseFloat(trade.inputAmount || 0);
        const outputAmount = parseFloat(trade.outputAmount || 0);
        const unitPrice = parseFloat(trade.unitPrice || 0);
        const buyPrice = parseFloat((metadata.trendFactors && metadata.trendFactors.buyPrice) || 0);
        const actualProfitPercent = (buyPrice > 0 && unitPrice > 0)
          ? ((unitPrice - buyPrice) / buyPrice * 100)
          : 0;

        tradeResultHtml = `
          <div class="mt-2 pt-2 border-t border-blue-300">
            <div class="text-xs font-semibold text-blue-900 mb-1">💰 交易执行结果</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div><span class="text-blue-800">卖出数量:</span> <span class="text-gray-900">${formatNum(inputAmount)}</span></div>
              <div><span class="text-blue-800">获得金额:</span> <span class="text-gray-900">${formatNum(outputAmount, 4)} BNB</span></div>
              <div><span class="text-blue-800">实际利润率:</span> <span class="${actualProfitPercent >= 0 ? 'text-green-700' : 'text-red-700'}">${formatPercent(actualProfitPercent)}</span></div>
              <div><span class="text-blue-800">交易状态:</span> <span class="text-green-600">✅ 成功</span></div>
            </div>
          </div>
        `;
      }

      sellStrategyHtml = `
        <div class="mt-2 p-3 bg-blue-100 rounded-lg border border-blue-300">
          <div class="flex items-center justify-between mb-2">
            <span class="text-blue-900 font-semibold text-sm">📤 卖出策略检查</span>
            ${tradeResult.trade && tradeResult.trade.success ?
              '<span class="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">✅ 已执行</span>' :
              '<span class="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded-full">📊 决策信息</span>'
            }
          </div>
          ${sellStrategyConfigHtml}
          ${sellFactorsHtml}
          ${tradeResultHtml}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <div class="flex items-center space-x-3 mb-2">
            <span class="signal-badge ${badgeClass}">
              ${isObserve ? '观察' : signal.action.toUpperCase() === 'BUY' ? '买入' : signal.action.toUpperCase() === 'SELL' ? '卖出' : '持有'}
            </span>
            <span class="text-sm font-medium text-gray-700">${signal.symbol || '代币'}</span>
            <span class="text-xs text-gray-400">${signalTime}</span>
            ${executedStatus}
          </div>
          <div class="flex items-center space-x-4 text-sm">
            ${priceInfo}
          </div>
          ${extraInfoHtml}
        </div>
      </div>

      ${rejectionInfoHtml}

      ${blockedInfoHtml}

      ${strategyInfoHtml}

      ${observationInfoHtml}

      ${preBuyCheckHtml}

      ${sellStrategyHtml}

      <details class="mt-3">
        <summary class="cursor-pointer text-xs text-blue-300 hover:text-blue-200">
          📋 查看完整元数据
        </summary>
        <div class="mt-2 p-3 bg-gray-900 rounded-md border border-gray-700">
          <pre class="text-xs bg-gray-900 text-green-400 p-2 rounded overflow-x-auto max-h-64 font-mono">${JSON.stringify(signal.metadata || {}, null, 2)}</pre>
        </div>
      </details>
    `;

    // 添加点击事件，高亮对应的K线标记
    card.addEventListener('click', () => {
      this.highlightSignal(signal);
    });

    // 观察信号手工买入（2026-10-23）：落 manual_trade_requests 行，引擎 2s 轮询消费；
    // 金额逻辑镜像 token-returns 页（perCardBNB>0 按卡，否则 tradeAmount 显式金额）
    const obsBuyBtn = card.querySelector('.obs-manual-buy');
    if (obsBuyBtn) {
      obsBuyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`手工买入 ${signal.symbol || signal.token_address}？`)) return;
        obsBuyBtn.disabled = true;
        obsBuyBtn.textContent = '提交中…';
        try {
          const cfg = this.experimentConfig || {};
          const perCard = cfg.positionManagement?.perCardBNB;
          const body = perCard > 0
            ? { tokenAddress: signal.token_address, direction: 'buy', cards: 1 }
            : { tokenAddress: signal.token_address, direction: 'buy', amountBnb: cfg.tradeAmount || 0.5 };
          const resp = await fetch(`/api/experiment/${this.experimentId}/manual-trade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const result = await resp.json();
          if (!resp.ok || !result.success) throw new Error(result.error || `HTTP ${resp.status}`);
          obsBuyBtn.textContent = '✅ 已下单（引擎 ~2s 消费）';
        } catch (err) {
          alert('手工买入失败: ' + err.message);
          obsBuyBtn.disabled = false;
          obsBuyBtn.textContent = '手工买入';
        }
      });
    }

    return card;
  }

  getSignalClass(action, signal) {
    // 检查是否是被拒绝的信号
    if (signal && signal.execution_status === 'failed') {
      return 'signal-rejected';
    }
    // T157 因子卖出过滤门拦截（famous HOLD）：蓝紫系区别红色拒绝——卖出被延缓非失败
    if (signal && signal.execution_status === 'blocked') {
      return 'signal-blocked';
    }
    switch (action.toUpperCase()) {
      case 'BUY': return 'signal-buy';
      case 'SELL': return 'signal-sell';
      case 'HOLD': return 'signal-hold';
      default: return 'signal-hold';
    }
  }

  getBadgeClass(action, signal) {
    // 检查是否是被拒绝的信号
    if (signal && signal.execution_status === 'failed') {
      return 'badge-rejected';
    }
    if (signal && signal.execution_status === 'blocked') {
      return 'badge-blocked';
    }
    switch (action.toUpperCase()) {
      case 'BUY': return 'badge-buy';
      case 'SELL': return 'badge-sell';
      case 'HOLD': return 'badge-hold';
      default: return 'badge-hold';
    }
  }

  /**
   * 检查信号是否被拒绝
   * @param {Object} signal - 信号对象
   * @returns {boolean} 是否被拒绝
   */
  isSignalRejected(signal) {
    return signal && signal.execution_status === 'failed';
  }

  /**
   * 检查信号是否被因子卖出过滤门拦截（T157 famous HOLD——卖出被延缓非失败）
   */
  isSignalBlocked(signal) {
    return signal && signal.execution_status === 'blocked';
  }

  highlightSignal(signal) {
    // 在图表中高亮显示对应的信号
    if (this.chart) {
      const signalTime = new Date(signal.signal_timestamp).getTime();

      // 查找最近的K线
      const kline = this.klineData.find(k =>
        Math.abs(k.timestamp * 1000 - signalTime) < 30000 // 30秒内的匹配
      );

      if (kline) {
        // 添加高亮注释
        this.chart.options.plugins.annotation.annotations.highlight = {
          type: 'box',
          xMin: kline.timestamp * 1000 - 60000,
          xMax: kline.timestamp * 1000 + 60000,
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderColor: 'rgba(59, 130, 246, 0.3)',
          borderWidth: 1
        };

        this.chart.update();
      }
    }
  }

  applyFilters() {
    this.currentFilters.action = document.getElementById('action-filter').value;
    this.currentFilters.limit = parseInt(document.getElementById('limit').value);

    // 🔥 应用筛选时重新加载数据（因为limit可能改变）
    // 代币筛选不需要重新加载，因为我们在前端有所有数据
    this.loadData();
  }

  updateTimeRange(range) {
    // 这里可以根据时间范围重新加载数据
    console.log('🕐 更新时间范围:', range);
    // 实现时间范围过滤逻辑
  }

  updateChartType(type) {
    if (this.chart) {
      this.chart.config.type = type;
      this.chart.update();
    }
  }

  toggleAutoRefresh() {
    this.autoRefresh = !this.autoRefresh;
    const btn = document.getElementById('auto-refresh-btn');

    if (this.autoRefresh) {
      btn.textContent = '⏰ 自动刷新: 开启';
      btn.classList.remove('bg-gray-600');
      btn.classList.add('bg-green-600');

      // 启动自动刷新（每30秒）
      this.refreshInterval = setInterval(() => {
        this.loadData();
      }, 30000);
    } else {
      btn.textContent = '⏰ 自动刷新: 关闭';
      btn.classList.remove('bg-green-600');
      btn.classList.add('bg-gray-600');

      // 停止自动刷新
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
        this.refreshInterval = null;
      }
    }
  }

  exportSignals() {
    if (this.signals.length === 0) {
      alert('暂无信号数据可导出');
      return;
    }

    // 准备导出数据
    const exportData = this.signals.map(signal => ({
      时间: new Date(signal.signal_timestamp).toLocaleString('zh-CN'),
      代币: signal.symbol,
      动作: signal.action === 'buy' ? '买入' : signal.action === 'sell' ? '卖出' : '持有',
      置信度: `${((signal.confidence || 0) * 100).toFixed(1)}%`,
      价格: signal.price ? parseFloat(signal.price).toFixed(8) : 'N/A',
      原因: signal.reason || '策略信号',
      策略类型: signal.strategy_type
    }));

    // 转换为CSV
    const headers = Object.keys(exportData[0]);
    const csvContent = [
      headers.join(','),
      ...exportData.map(row => headers.map(header => `"${row[header]}"`).join(','))
    ].join('\n');

    // 下载CSV文件
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `交易信号_${this.experimentId}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();

    console.log('📥 信号数据导出完成');
  }

  showError(message) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-message').classList.remove('hidden');
    document.getElementById('error-text').textContent = message;
  }

  hideError() {
    document.getElementById('error-message').classList.add('hidden');
  }

  /**
   * 🔥 获取GMGN区块链标识
   * @param {string} blockchain - 区块链标识
   * @returns {string} GMGN使用的区块链标识
   */
  getGMGNBlockchain(blockchain) {
    const gmgnBlockchainMap = {
      'bsc': 'bsc',
      'bnb': 'bsc',
      'binance': 'bsc',
      'sol': 'sol',
      'solana': 'sol',
      'base': 'base',
      'eth': 'eth',
      'ethereum': 'eth'
    };
    return gmgnBlockchainMap[blockchain?.toLowerCase()] || 'bsc';
  }

  /**
   * 🔥 获取区块链显示名称
   * @param {string} blockchain - 区块链标识
   * @returns {string} 显示名称
   */
  getBlockchainDisplay(blockchain) {
    const blockchainMap = {
      'bsc': 'BSC',
      'bnb': 'BSC',
      'sol': 'Solana',
      'solana': 'Solana',
      'base': 'Base',
      'eth': 'Ethereum',
      'ethereum': 'Ethereum'
    };
    return blockchainMap[blockchain?.toLowerCase()] || blockchain || 'Unknown';
  }

  /**
   * 加载拒绝信号统计
   * @returns {Promise<void>}
   */
  async loadRejectionStats() {
    try {
      const response = await fetch(`/api/experiment/${this.experimentId}/rejection-stats`);
      const result = await response.json();

      if (result.success) {
        this.rejectionStats = result.data;
        this.updateRejectionStatsUI();
      }
    } catch (error) {
      console.error('加载拒绝统计失败:', error);
    }
  }

  /**
   * 更新拒绝统计UI
   */
  updateRejectionStatsUI() {
    if (!this.rejectionStats) return;

    // 更新拒绝信号总数
    const rejectedSignalsEl = document.getElementById('rejected-signals');
    if (rejectedSignalsEl) {
      rejectedSignalsEl.textContent = this.rejectionStats.totalRejected || 0;
    }

    // 更新拒绝原因明细
    this.renderRejectionDetails();
  }

  /**
   * 渲染拒绝原因明细
   */
  renderRejectionDetails() {
    const container = document.getElementById('rejection-reasons-list');
    if (!container || !this.rejectionStats) return;

    const byReason = this.rejectionStats.byReason || {};
    const entries = Object.entries(byReason).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
      container.innerHTML = '<p class="text-gray-400 text-sm">暂无拒绝记录</p>';
      return;
    }

    const maxCount = entries[0][1];
    const totalCount = this.rejectionStats.totalRejected || 1;

    container.innerHTML = entries.map(([reason, count]) => {
      const percentage = ((count / totalCount) * 100).toFixed(1);
      const barWidth = ((count / maxCount) * 100).toFixed(1);

      return `
        <div class="flex items-center space-x-3">
          <div class="flex-1">
            <div class="flex items-center justify-between mb-1">
              <span class="text-sm text-gray-300">${this._escapeHtml(reason)}</span>
              <span class="text-sm text-gray-400">${count} (${percentage}%)</span>
            </div>
            <div class="rejection-reason-bar">
              <div class="rejection-reason-fill" style="width: ${barWidth}%"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * 切换拒绝原因明细的显示/隐藏
   */
  toggleRejectionDetails() {
    const detailsPanel = document.getElementById('rejection-details');
    if (detailsPanel) {
      detailsPanel.classList.toggle('hidden');
    }
  }


  /**
   * HTML转义工具方法
   * @private
   * @param {string} text - 要转义的文本
   * @returns {string} 转义后的文本
   */
  _escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * T202 策略库形状（2026-11-21）：实验 config 只存顶层 strategyId，腿定义在
   * strategy_library 包 definition 里——信号卡片「条件表达式+因子值 chips」与叙事
   * 面板触发条件串都消费 strategiesConfig.buyStrategies/sellStrategies（旧内嵌腿
   * 形状），拿不到腿 = 表达式与因子值静默消失。这里拉取策略包并把
   * definition.buyLegs/sellLegs 物化进 strategiesConfig 双数组；腿 id 形状由消费点
   * enrichment（`buy_${idx}_${priority}`）与引擎组装点同构补齐，信号 metadata.strategyId
   * 命中不变。旧形状（内嵌腿在场）原样跳过零改动；拉取失败仅 console.warn 降级
   * （页面其余功能不受影响，条件区不渲染——与无腿配置的展示行为一致）。
   * 版本漂移：包在实验启动后被改版 → strategyResolved.version（启动解析版）≠ 库
   * 当前 version，条件展示为当前库版并注记（库不存历史版，无法回放启动版腿）。
   * T242 专属腿停用对齐（2026-11-27 修存量显示缺口）：引擎 _buildStrategyConfig 不组装
   * 「绑定类型未激活」的买腿，腿 id（buy_${idx}_${priority}）按**过滤后**的数组编号——
   * 这里若物化全量腿，停用专属腿之后的腿整体错位一位（信号 strategyId 未命中回退首腿，
   * 「📋 买入条件配置」把票显示成 P1 腿的条件与因子 chips）。物化时按引擎启动审计
   * strategyResolved.pointTypes.disabledLegs（停用专属腿的 priority 列表）同款剔除；
   * 无审计段（T242 前实验 / 包未启用 pointType=引擎不过滤）=全量物化零变化。
   * @private
   */
  async _loadStrategyPackLegs() {
    const cfg = this.experimentConfig || {};
    const sc = cfg.strategiesConfig || {};
    if (Array.isArray(sc.buyStrategies) || Array.isArray(sc.sellStrategies)) {
      return; // 旧内嵌腿形状（T202 前实验）——腿已在 config 里
    }
    if (!cfg.strategyId) return;
    try {
      const resp = await fetch(`/api/strategy-library/${cfg.strategyId}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      const def = json && json.data && json.data.definition;
      if (!def || !Array.isArray(def.buyLegs) || !Array.isArray(def.sellLegs)) {
        throw new Error('definition 形状非法（buyLegs/sellLegs 缺失）');
      }
      const audit = cfg.strategyResolved && cfg.strategyResolved.pointTypes;
      const disabledLegPriorities = new Set(audit && Array.isArray(audit.disabledLegs) ? audit.disabledLegs : []);
      const buyLegs = def.buyLegs.filter((leg) => !(leg && leg.pointType && disabledLegPriorities.has(leg.priority)));
      this.experimentConfig.strategiesConfig = {
        ...sc,
        buyStrategies: buyLegs,
        sellStrategies: def.sellLegs,
      };
      // 叙事面板触发条件串读 _experimentData.config.strategiesConfig——同一物化双写
      if (this._experimentData && this._experimentData.config
          && typeof this._experimentData.config === 'object') {
        this._experimentData.config.strategiesConfig = this.experimentConfig.strategiesConfig;
      }
      const resolvedV = cfg.strategyResolved && cfg.strategyResolved.version;
      const libV = json.data.version;
      this._packVersionNote = (Number.isInteger(resolvedV) && libV !== resolvedV)
        ? `（库 v${libV} ≠ 启动解析 v${resolvedV}，展示为当前库版）`
        : '';
      const dropped = def.buyLegs.length - buyLegs.length;
      console.log(`[ExperimentSignals] 策略包腿已物化: ${json.data.name} v${libV} | 买${buyLegs.length}${dropped ? `（包 ${def.buyLegs.length} 腿，专属腿停用 ${[...disabledLegPriorities].map((p) => 'P' + p).join('/')} 不物化=引擎同款）` : ''}/卖${def.sellLegs.length} 腿${this._packVersionNote}`);
    } catch (e) {
      console.warn('[ExperimentSignals] 策略包腿拉取失败（条件表达式/因子 chips 将不展示）:', e);
    }
  }

  /**
   * 拉取点位类型注册表（判据表达式版：GET /api/strategy-library/point-types?include=condition）
   * ——⓪类型通路卡「判据表达式 + 逐子句因子 chips」的数据源（2026-11-27 用户指令「🧭 点位
   * 类型通路也请跟 📋 买入条件配置一样，展示完整的表达式，以及每个因子的条件满足情况」）。
   * 表达式取自当前代码注册表，与 T202 包腿同口径（注册表不存历史版，无法回放信号分类时
   * 的判据）——信号分类版（metadata.pointType.version）≠ 当前注册表版时卡片带漂移注记。
   * 失败不抛：落 _pointTypeRegistryError，卡片显式提示「注册表未加载」（不静默缺表达式）。
   * @private
   */
  async _loadPointTypeRegistry() {
    try {
      const resp = await fetch('/api/strategy-library/point-types?include=condition');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      const data = json && json.data;
      if (!data || typeof data.version !== 'string' || !Array.isArray(data.types)) {
        throw new Error('注册表形状非法（version/types 缺失）');
      }
      this._pointTypeRegistry = { version: data.version, byId: new Map(data.types.map((t) => [t.id, t])) };
      this._pointTypeRegistryError = '';
    } catch (e) {
      this._pointTypeRegistry = null;
      this._pointTypeRegistryError = e && e.message ? e.message : String(e);
      console.warn('[ExperimentSignals] 点位类型注册表拉取失败（类型通路卡判据表达式将显式提示不可展示）:', e);
    }
  }

  /**
   * 从实验配置中获取买入条件（触发条件）
   * @private
   * @param {string} action - 交易动作 ('buy' 或 'sell')
   * @param {string} strategyId - 策略ID (可选，如 'sell_3_4' 或 'buy_0_1')
   * @returns {string|null} 条件表达式
   */
  _getBuyCondition(action, strategyId = null) {
    if (!this.experimentConfig || !this.experimentConfig.strategiesConfig) {
      return null;
    }

    const strategiesConfig = this.experimentConfig.strategiesConfig;
    const strategies = action === 'buy' ? strategiesConfig.buyStrategies : strategiesConfig.sellStrategies;

    if (!strategies || !Array.isArray(strategies) || strategies.length === 0) {
      return null;
    }

    // 动态构建策略数组，添加 id 和 name 字段（因为数据库保存的是原始配置）
    const enrichedStrategies = strategies.map((s, idx) => ({
      ...s,
      id: s.id || `${action}_${idx}_${s.priority || 0}`,
      name: s.name || `${action === 'buy' ? '买入' : '卖出'}策略 P${s.priority || 0}`
    }));

    // 如果提供了 strategyId，查找对应的策略
    if (strategyId) {
      console.log(`[ExperimentSignals] 查找策略: action=${action}, strategyId=${strategyId}`);
      console.log(`[ExperimentSignals] 可用策略列表:`, enrichedStrategies.map(s => ({ id: s.id, name: s.name })));

      const strategy = enrichedStrategies.find(s => s.id === strategyId);
      if (strategy && strategy.condition) {
        console.log(`[ExperimentSignals] 找到匹配策略: ${strategy.name}, condition=${strategy.condition}`);
        return strategy.condition;
      }
      // 如果找不到对应策略，回退到第一个策略
      console.warn(`[ExperimentSignals] 未找到策略ID ${strategyId}，使用第一个策略的条件`);
    }

    // 获取第一个策略的触发条件
    const firstStrategy = enrichedStrategies[0];
    console.log(`[ExperimentSignals] 使用第一个策略: ${firstStrategy?.id} - ${firstStrategy?.name}`);
    return firstStrategy?.condition || null;
  }

  /**
   * 渲染条件表达式各因子子句的触发时刻值（chip 行，紧贴条件表达式展示）。
   * 条件里有啥因子就展示啥（买入/预检查条件共用）；同名因子多子句逐子句展示
   * （如 narrativeRating == 2 OR == 3 两枚 chip），支持 IS [NOT] NULL 子句。
   * 值查找顺序：extraSources → metadata.trendFactors → metadata.tpaFactors → metadata.preBuyCheckFactors → metadata 顶层
   * （extraSources 供 GMGN 第三层实时快照优先——preBuyCheckFactors 里的 gmgn 三键来自
   * 直调 1d TTL 快照，与第三层下单前实时调取口径不同，不可混用）。
   * 着色：满足阈值=绿 / 不满足=红 / null（TPA 未触发等 fail-closed）=红底「null」/
   * 快照段缺失（历史信号）=灰「无快照」——tokenAgeSec 例外：2026-09-29~09-30 的
   * 旧信号白名单无此键，由 age×60 前端推导兜底（与引擎同源换算）。
   * opts.orCoveredKeys（2026-11-27，⓪类型通路卡传入；不传=买入/预检查条件原行为不变）：
   * 子句为假、但所在 OR 组已由另一臂满足的子句键集（_orCoveredClauseKeys 产物）——这类
   * 子句不影响表达式整体成立，降灰并注明「OR 另一臂已满足」，不与真正不满足的子句同标红。
   * @private
   * @param {string} condition - 条件表达式
   * @param {Object} metadata - 信号 metadata
   * @param {Array} [extraSources] - 额外因子源（优先于默认链查找）
   * @param {Object} [opts] - {orCoveredKeys: Set<string>}
   * @returns {string} HTML
   */
  _renderConditionFactorChips(condition, metadata, extraSources = [], opts = {}) {
    const clauses = this._parseConditionClauses(condition);
    if (clauses.length === 0) return '';
    const sources = this._factorChipSources(metadata, extraSources);
    const orCovered = opts && opts.orCoveredKeys instanceof Set ? opts.orCoveredKeys : null;
    const OR_ARM_CLS = 'bg-gray-200 text-gray-600';
    const OR_ARM_NOTE = '（OR 另一臂已满足）';
    // 子句为假 ∧ 在覆盖集内 → 该子句不决定整体成立（降灰）
    const orArm = (cl, ok) => ok === false && orCovered !== null && orCovered.has(this._clauseKey(cl));

    const chips = [];
    for (const cl of clauses) {
      // 在各快照段中找值；区分 undefined（段/键缺失）与 null（因子存在但未就绪）
      const { found, raw, derived } = this._lookupFactorClause(cl, sources);
      let cls, text;
      if (!found) {
        cls = 'bg-gray-100 text-gray-500';
        text = `${cl.name} = 无快照(历史信号)`;
      } else if (cl.isNull) {
        const isNull = raw === null || raw === undefined;
        const ok = cl.notNull ? !isNull : isNull;
        const dim = orArm(cl, ok);
        cls = ok ? 'bg-green-100 text-green-800' : (dim ? OR_ARM_CLS : 'bg-red-100 text-red-800');
        text = `${cl.name} IS ${cl.notNull ? 'NOT ' : ''}NULL ${ok ? '✓' : '✗'}${dim ? OR_ARM_NOTE : ''}（实际 ${isNull ? 'null' : this._fmtFactorVal(raw)}）`;
      } else if (raw === null || raw === undefined) {
        const dim = orArm(cl, false);
        cls = dim ? OR_ARM_CLS : 'bg-red-50 text-red-700 border border-red-200';
        text = `${cl.name} = null(未触发/未就绪)${dim ? OR_ARM_NOTE : ''}`;
      } else {
        const ok = this._cmpFactorOp(cl.op, raw, cl.value);
        const dim = orArm(cl, ok);
        if (derived) {
          // tokenAgeSec 旧信号推导兜底：快照白名单 2026-10-01 才加此键，此前信号由 age×60 同源推导
          cls = ok ? 'bg-green-100 text-green-800' : (dim ? OR_ARM_CLS : 'bg-red-100 text-red-800');
          text = `${cl.name} ≈ ${this._fmtFactorVal(raw)} ${cl.op} ${cl.value} ${ok ? '✓' : '✗'}${dim ? OR_ARM_NOTE : ''}（age×60 推导）`;
        } else {
          cls = ok === null ? 'bg-gray-100 text-gray-700' : (ok ? 'bg-green-100 text-green-800' : (dim ? OR_ARM_CLS : 'bg-red-100 text-red-800'));
          text = `${cl.name} = ${this._fmtFactorVal(raw)} ${cl.op} ${cl.value} ${ok === null ? '?' : (ok ? '✓' : '✗')}${dim ? OR_ARM_NOTE : ''}`;
        }
      }
      chips.push(`<code class="px-1.5 py-0.5 rounded text-xs ${cls}">${this._escapeHtml(text)}</code>`);
    }
    return `<div class="mt-1 flex flex-wrap gap-1 items-center"><span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">📊 因子值:</span>${chips.join('')}</div>`;
  }

  /**
   * 因子 chip 值查找源链：extraSources → metadata.trendFactors → metadata.tpaFactors →
   * metadata.preBuyCheckFactors → metadata 顶层（_renderConditionFactorChips /
   * _orCoveredClauseKeys 共用——两处的取值口径必须一致）
   * @private
   */
  _factorChipSources(metadata, extraSources = []) {
    return [
      ...extraSources,
      metadata && metadata.trendFactors,
      metadata && metadata.tpaFactors,
      metadata && metadata.preBuyCheckFactors,
      metadata
    ].filter(Boolean);
  }

  /**
   * 因子子句取值：首个含该键的源胜出（found=true，raw=原值）；全源缺键时 tokenAgeSec
   * 旧信号由 age×60 推导兜底（derived=true，raw=推导值）；否则 found=false
   * @private
   * @returns {{found:boolean, raw:*, derived:boolean}}
   */
  _lookupFactorClause(cl, sources) {
    let raw;
    let srcIdx = 0;
    while (srcIdx < sources.length) {
      if (cl.name in sources[srcIdx]) { raw = sources[srcIdx][cl.name]; break; }
      srcIdx++;
    }
    if (srcIdx < sources.length) return { found: true, raw, derived: false };
    const ageSrc = sources.find(s => 'age' in s && Number.isFinite(Number(s.age)));
    if (cl.name === 'tokenAgeSec' && cl.op && ageSrc) {
      return { found: true, raw: Number(ageSrc.age) * 60, derived: true };
    }
    return { found: false, raw: undefined, derived: false };
  }

  /** 因子 chip 数值格式：常规域两位小数，极小/极大值科学计数（_renderConditionFactorChips 用） */
  _fmtFactorVal(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return (Math.abs(n) >= 0.001 && Math.abs(n) < 100000) ? n.toFixed(2) : n.toExponential(3);
  }

  /**
   * 因子子句比较（chip 着色口径）：非数值 → false（不满足）；未知运算符 → null（chip 显 ?）
   * ⚠调用方须先处理 null/undefined 原值（Number(null)=0 会误判为满足 0 值比较）
   */
  _cmpFactorOp(op, v, threshold) {
    const n = Number(v);
    if (!Number.isFinite(n)) return false;
    switch (op) {
      case '>=': return n >= threshold;
      case '<=': return n <= threshold;
      case '>': return n > threshold;
      case '<': return n < threshold;
      case '=': case '==': return n === threshold;
      case '!=': return n !== threshold;
      default: return null;
    }
  }

  /** 因子子句标识键（_parseConditionClauses 去重 / OR 臂覆盖集共用） */
  _clauseKey(c) {
    return c.isNull ? `${c.name}|IS${c.notNull ? 'NOT' : ''}NULL` : `${c.name}|${c.op}|${c.value}`;
  }

  /**
   * 解析条件表达式为因子子句列表（保留同名因子多子句；含 IS [NOT] NULL 子句）。
   * 供因子 chip 逐子句渲染——与 _parseBuyCondition（阈值 map，后写覆盖前写）不同，
   * 这里逐子句保序展示，narrativeRating == 2 OR == 3 两子句各自成 chip。
   * @private
   * @param {string} condition - 条件表达式
   * @returns {Array<{name:string, op:string|null, value:number|null, isNull:boolean, notNull:boolean}>}
   */
  _parseConditionClauses(condition) {
    if (!condition || typeof condition !== 'string') return [];
    const clauses = [];
    const seen = new Set();
    const push = (c) => {
      const key = this._clauseKey(c);
      if (seen.has(key)) return;
      seen.add(key);
      clauses.push(c);
    };
    let m;
    const reCmp = /([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|!=|==|=|>|<)\s*(-?\d+\.?\d*)/g;
    while ((m = reCmp.exec(condition)) !== null) {
      push({ name: m[1], op: m[2], value: parseFloat(m[3]), isNull: false, notNull: false });
    }
    const reNull = /([A-Za-z_][A-Za-z0-9_]*)\s+IS\s+(NOT\s+)?NULL/gi;
    while ((m = reNull.exec(condition)) !== null) {
      push({ name: m[1], op: null, value: null, isNull: true, notNull: Boolean(m[2]) });
    }
    return clauses;
  }

  /**
   * ⓪类型通路卡判据区块：完整判据表达式 + 逐子句因子 chips（2026-11-27 用户指令「🧭 点位
   * 类型通路也请跟 📋 买入条件配置一样，展示完整的表达式，以及每个因子的条件满足情况」）。
   * - 表达式=当前注册表里该类型的 condition 原文；值=metadata.pointType.snapshot（引擎
   *   分类时 fire 时刻因子快照，仅含判据引用键）优先，其次 trendFactors 等默认源链——
   *   与 📋 买入条件配置同一渲染器（_renderConditionFactorChips），只多传 OR 臂覆盖集
   * - 着色三态：绿 ✓=子句满足；灰「✗（OR 另一臂已满足）」=子句不满足但其所在 OR 组
   *   已由另一臂满足（本类型已命中，这类子句不决定整体成立——做市类型每张命中票都带
   *   `gmgnProfiledBuyerPct IS NULL ✗` / `chg30Pct > 20 ✗` 两臂，照标红=永久红鲱鱼）；
   *   红 ✗=不满足且不被覆盖——正常只出现在版本漂移（信号按旧版判据命中，新版改写的
   *   子句对其快照不成立），连同漂移注记一起读
   * - 显式降级（不静默）：normal 兜底类型无判据（注册表 condition=null）；注册表未加载 /
   *   类型不在当前注册表 / 接口未返回 condition 各给一句原因
   * @private
   * @param {Object} pt - metadata.pointType {type,label,version,snapshot,…}
   * @param {Object} metadata - 信号 metadata
   * @returns {string} HTML
   */
  _renderPointTypeCondition(pt, metadata) {
    const esc = (s) => this._escapeHtml(String(s));
    const line = (inner, cls = 'text-gray-400') => `<div class="text-xs mt-1 ${cls}"><span class="font-semibold text-indigo-300">🧭 点位类型判据:</span>${inner}</div>`;
    const FALLBACK = '兜底类型无判据表达式——阶梯内排在前面的激活类型均未命中，即落本类型';
    // normal 恒为阶梯末位兜底（注册表 condition=null）——不依赖注册表即可断言
    if (pt.type === 'normal') {
      return line(`<span class="ml-2">${FALLBACK}</span>`);
    }
    if (!this._pointTypeRegistry) {
      return line(`<span class="ml-2 text-yellow-600">⚠ 判据表达式不可展示：点位类型注册表未加载${this._pointTypeRegistryError ? `（${esc(this._pointTypeRegistryError)}）` : ''}</span>`);
    }
    const registry = this._pointTypeRegistry;
    const entry = registry.byId.get(pt.type);
    if (!entry) {
      return line(`<span class="ml-2 text-yellow-600">⚠ 判据表达式不可展示：类型 <code>${esc(pt.type)}</code> 不在当前注册表（${esc(registry.version)}）——类型 id 可能已改名</span>`);
    }
    if (!('condition' in entry) || entry.condition === undefined) {
      // 静态 JS 从磁盘即时生效、路由处理函数须进程重启才换新——pull 后未重启即此形状
      return line(`<span class="ml-2 text-yellow-600">⚠ 判据表达式不可展示：注册表接口未返回判据（web-server 进程仍是旧版本，重启后恢复）</span>`);
    }
    if (entry.condition === null) {
      return line(`<span class="ml-2">${FALLBACK}</span>`);
    }
    const orCoveredKeys = this._orCoveredClauseKeys(entry.condition, this._factorChipSources(metadata, [pt.snapshot]));
    if (orCoveredKeys === null) {
      // 退回逐子句平铺着色（=📋 买入条件配置同款）；注册表全部判据由单测锁定可解析
      console.warn('[ExperimentSignals] 点位类型判据解析失败（OR 臂降灰不可用，按逐子句平铺着色）:', pt.type, entry.condition);
    }
    const drift = pt.version && pt.version !== registry.version;
    return `
          <div class="text-xs mt-1">
            <span class="font-semibold text-indigo-300">🧭 点位类型判据:</span>
            <code class="ml-2 px-2 py-0.5 bg-gray-900 rounded text-xs text-indigo-200 break-all">${esc(entry.condition)}</code>
            ${drift ? `<span class="ml-2 text-yellow-600">（注册表 ${esc(registry.version)} ≠ 信号分类版 ${esc(pt.version)}，表达式为当前注册表版判据）</span>` : ''}
          </div>
          ${this._renderConditionFactorChips(entry.condition, metadata, [pt.snapshot], { orCoveredKeys: orCoveredKeys || undefined })}`;
  }

  /**
   * 条件表达式的 OR 臂覆盖集：返回「子句为假，但所在 OR 组已由另一臂满足」的子句键集
   * （_clauseKey 口径）。三值求值（true/false/null；null=无快照无法判定）：
   *   AND：任一 false → false；否则任一 null → null；否则 true
   *   OR： 任一 true → true；否则任一 null → null；否则 false
   * 自顶向下：叶子为假 ∧ 存在「求值为 true 的 OR 祖先」→ 进覆盖集。同一子句在表达式里
   * 多次出现时任一次未被覆盖即不算覆盖（那一次才是决定整体的那支）。
   * 叶子取值/比较与因子 chip 同口径（_lookupFactorClause/_cmpFactorOp）；缺键：IS [NOT] NULL
   * 叶子按引擎 ConditionEvaluator 口径「缺键=空值」定真假（_getOperandValue 缺键返回
   * undefined → `val == null` 为真），比较叶子=null（无快照无法判定）。
   * @private
   * @param {string} condition - 条件表达式
   * @param {Array<Object>} sources - 因子源链（_factorChipSources 产物）
   * @returns {Set<string>|null} null=表达式解析失败（调用方退回逐子句平铺着色）
   */
  _orCoveredClauseKeys(condition, sources) {
    const root = this._parseConditionTree(condition);
    if (!root) return null;
    this._evalConditionTree(root, sources);
    const covered = new Set();
    const uncovered = new Set();
    const walk = (node, underTrueOr) => {
      if (node.type === 'leaf') {
        if (node.state === false) (underTrueOr ? covered : uncovered).add(this._clauseKey(node.clause));
        return;
      }
      const flag = underTrueOr || (node.type === 'OR' && node.state === true);
      for (const c of node.nodes) walk(c, flag);
    };
    walk(root, false);
    for (const k of uncovered) covered.delete(k);
    return covered;
  }

  /**
   * 条件表达式三值求值：true / false / null（null=无快照无法判定，或表达式解析失败）
   * @private
   * @param {string} condition
   * @param {Array<Object>} sources - 因子源链
   * @returns {boolean|null}
   */
  _evalConditionTriState(condition, sources) {
    const root = this._parseConditionTree(condition);
    return root ? this._evalConditionTree(root, sources) : null;
  }

  /**
   * 结构树三值求值（自底向上；各节点结果写进 node.state，供 OR 臂覆盖集自顶向下判定用）
   * @private
   * @returns {boolean|null}
   */
  _evalConditionTree(node, sources) {
    if (node.type === 'leaf') return (node.state = this._clauseTriState(node.clause, sources));
    const ss = node.nodes.map((c) => this._evalConditionTree(c, sources));
    node.state = node.type === 'OR'
      ? (ss.includes(true) ? true : (ss.includes(null) ? null : false))
      : (ss.includes(false) ? false : (ss.includes(null) ? null : true));
    return node.state;
  }

  /**
   * 因子子句三值：true/false=可判定；null=无快照无法判定（比较叶子缺键）。
   * 可判定叶子的真假与因子 chip 的 ✓/✗ 同口径（_lookupFactorClause/_cmpFactorOp）；
   * IS [NOT] NULL 叶子缺键按引擎 ConditionEvaluator 口径「缺键=空值」定真假
   * （_getOperandValue 缺键返回 undefined → `val == null` 为真）。
   * @private
   * @returns {boolean|null}
   */
  _clauseTriState(cl, sources) {
    const { found, raw } = this._lookupFactorClause(cl, sources);
    if (cl.isNull) {
      if (!found) return !cl.notNull;
      return (raw === null || raw === undefined) !== cl.notNull;
    }
    if (!found) return null;
    if (raw === null || raw === undefined) return false;
    return this._cmpFactorOp(cl.op, raw, cl.value);
  }

  /**
   * 条件表达式 → 布尔结构树（OR 臂覆盖集用）。文法与引擎 ConditionEvaluator._parseCondition
   * 同构：OR 优先级最低、AND 次之、括号分组；叶子=因子比较（右操作数=数字字面量）|
   * 因子 IS [NOT] NULL（关键字大小写不敏感）。叶子 clause 形状与 _parseConditionClauses
   * 产物一致（_clauseKey 可直接标识）。覆盖域外语法（字符串字面量 / 因子对因子比较 /
   * 多余记号）→ null，不抛。
   * @private
   * @param {string} condition
   * @returns {{type:'AND'|'OR',nodes:Array}|{type:'leaf',clause:Object}|null} null=解析失败
   */
  _parseConditionTree(condition) {
    if (!condition || typeof condition !== 'string') return null;
    // 词法：括号 / 比较运算符（双字符优先）/ 标识符 / 数字字面量；遇到其它字符=解析失败
    const tokens = [];
    const TOKEN_RE = /\(|\)|>=|<=|!=|==|=|>|<|[A-Za-z_][A-Za-z0-9_]*|-?\d+\.?\d*/y;
    let i = 0;
    while (i < condition.length) {
      if (/\s/.test(condition[i])) { i++; continue; }
      TOKEN_RE.lastIndex = i;
      const m = TOKEN_RE.exec(condition);
      if (!m) return null;
      const t = m[0];
      tokens.push(t === '(' ? { type: 'lparen' }
        : t === ')' ? { type: 'rparen' }
          : /^[A-Za-z_]/.test(t) ? { type: 'ident', value: t }
            : /^[-\d]/.test(t) ? { type: 'num', value: parseFloat(t) } : { type: 'op', value: t });
      i += t.length;
    }
    const KEYWORDS = ['AND', 'OR', 'IS', 'NOT', 'NULL'];
    const isKw = (t, kw) => !!t && t.type === 'ident' && t.value.toUpperCase() === kw;
    const isAnyKw = (t) => !!t && t.type === 'ident' && KEYWORDS.includes(t.value.toUpperCase());
    let pos = 0;
    const peek = () => tokens[pos];
    const parseOr = () => {
      const nodes = [parseAnd()];
      while (isKw(peek(), 'OR')) { pos++; nodes.push(parseAnd()); }
      return nodes.length === 1 ? nodes[0] : { type: 'OR', nodes };
    };
    const parseAnd = () => {
      const nodes = [parsePrimary()];
      while (isKw(peek(), 'AND')) { pos++; nodes.push(parsePrimary()); }
      return nodes.length === 1 ? nodes[0] : { type: 'AND', nodes };
    };
    const parsePrimary = () => {
      if (peek() && peek().type === 'lparen') {
        pos++;
        const node = parseOr();
        if (!peek() || peek().type !== 'rparen') throw new Error('括号不匹配');
        pos++;
        return node;
      }
      return parseLeaf();
    };
    const parseLeaf = () => {
      const t = peek();
      if (!t || t.type !== 'ident' || isAnyKw(t)) throw new Error('期望因子名');
      pos++;
      if (isKw(peek(), 'IS')) {
        pos++;
        let notNull = false;
        if (isKw(peek(), 'NOT')) { notNull = true; pos++; }
        if (!isKw(peek(), 'NULL')) throw new Error('IS [NOT] 后期望 NULL');
        pos++;
        return { type: 'leaf', clause: { name: t.value, op: null, value: null, isNull: true, notNull } };
      }
      const opTok = peek();
      if (!opTok || opTok.type !== 'op') throw new Error('期望比较运算符');
      pos++;
      const numTok = peek();
      if (!numTok || numTok.type !== 'num') throw new Error('期望数字字面量右操作数');
      pos++;
      return { type: 'leaf', clause: { name: t.value, op: opTok.value, value: numTok.value, isNull: false, notNull: false } };
    };
    try {
      const root = parseOr();
      return pos === tokens.length ? root : null;
    } catch (_e) {
      return null;
    }
  }

  /**
   * 解析买入条件表达式，提取各因子的阈值
   * 支持的运算符: >=, <=, >, <, =, ==
   * @private
   * @param {string} condition - 条件表达式
   * @returns {Object} 因子名到阈值的映射 { factorName: { operator, value } }
   */
  _parseBuyCondition(condition) {
    if (!condition || typeof condition !== 'string') {
      return {};
    }

    const thresholds = {};

    // 匹配模式: factorName operator value
    // 支持的运算符: >=, <=, >, <, =, ==, AND, OR
    const patterns = [
      /(\w+)\s*(>=|<=|>|<|=|==)\s*(\d+\.?\d*)/g
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(condition)) !== null) {
        const [, factorName, operator, value] = match;
        thresholds[factorName] = {
          operator: operator,
          value: parseFloat(value)
        };
      }
    }

    return thresholds;
  }

  /**
   * 从实验配置中获取购买前检查条件
   * @private
   * @param {string} action - 交易动作 ('buy' 或 'sell')
   * @param {number} buyRound - 购买轮次 (1=首次购买, 2+=后续购买)
   * @returns {string|null} 条件表达式
   */
  _getPreBuyCheckCondition(action, buyRound = 1) {
    if (!this.experimentConfig || !this.experimentConfig.strategiesConfig) {
      return null;
    }

    const strategiesConfig = this.experimentConfig.strategiesConfig;
    const strategies = action === 'buy' ? strategiesConfig.buyStrategies : strategiesConfig.sellStrategies;

    if (!strategies || !Array.isArray(strategies) || strategies.length === 0) {
      return null;
    }

    const strategy = strategies[0];

    // 根据购买轮次返回对应的预检查条件
    if (buyRound === 1) {
      // 首次购买：使用 preBuyCheckCondition
      return strategy.preBuyCheckCondition || null;
    } else {
      // 后续购买：使用 repeatBuyCheckCondition
      return strategy.repeatBuyCheckCondition || null;
    }
  }

  /**
   * 从实验配置中获取买腿第三层 GMGN 条件（FAKER 0xc6ee…7777 团伙盘案 2026-10-14；
   * strategyId 未命中回退第一条，id 形状与 _getBuyCondition 的 enriched id 同构）
   * @private
   * @param {string} strategyId - 策略ID (可选，如 'buy_0_1')
   * @returns {string|null} 条件表达式
   */
  _getGmgnCheckCondition(strategyId = null) {
    if (!this.experimentConfig || !this.experimentConfig.strategiesConfig) {
      return null;
    }
    const strategies = this.experimentConfig.strategiesConfig.buyStrategies;
    if (!strategies || !Array.isArray(strategies) || strategies.length === 0) {
      return null;
    }
    const strategy = strategyId
      ? strategies.find((s, idx) => (s.id || `buy_${idx}_${s.priority || 0}`) === strategyId) || strategies[0]
      : strategies[0];
    return String(strategy.gmgnCheckCondition || '').trim() || null;
  }

  /**
   * 渲染 GMGN 条件的因子 chip（买前第三层实时快照）。
   * 三态防误读：无 gmgnCheck 轨迹=灰注（未到第三层/元数据缺失）；covered=0=琥珀注
   * 放行（2026-10-20 乌龟案改 fail-open——零值因子若照常渲染会显示绿 ✓ 误导，
   * 表达式实际未评估）；有数据=正常 chip，值取 metadata.gmgnCheck.factors 实时快照。
   * @private
   * @param {string} condition - GMGN 条件表达式
   * @param {Object|null} gmgnCheckInfo - metadata.gmgnCheck
   * @param {Object} metadata - 信号 metadata
   * @returns {string} HTML
   */
  _renderGmgnCheckChips(condition, gmgnCheckInfo, metadata) {
    if (!gmgnCheckInfo) {
      return '<span class="inline-block ml-2 text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">GMGN 检查无快照（未到第三层/元数据缺失）</span>';
    }
    const f = gmgnCheckInfo.factors;
    if (!f || f.gmgnRiskCovered !== 1) {
      return `<span class="inline-block ml-2 text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">GMGN 无数据（${this._escapeHtml(gmgnCheckInfo.reason || 'gmgn_check_no_data')}）→ 放行，表达式未评估</span>`;
    }
    return this._renderConditionFactorChips(condition, metadata, [f]);
  }

  /**
   * 检查因子值是否满足预检查条件
   * @private
   * @param {string} factorName - 因子名称
   * @param {number} factorValue - 因子值
   * @param {Object} thresholds - 从 _parseBuyCondition 返回的阈值对象
   * @returns {boolean} 是否满足条件
   */
  _checkFactorMeetsCondition(factorName, factorValue, thresholds) {
    if (!thresholds || !thresholds[factorName]) {
      return true; // 没有条件要求，视为满足
    }

    const threshold = thresholds[factorName];
    const value = threshold.value;

    switch (threshold.operator) {
      case '>=':
        return factorValue >= value;
      case '<=':
        return factorValue <= value;
      case '>':
        return factorValue > value;
      case '<':
        return factorValue < value;
      case '=':
      case '==':
        return factorValue == value;
      default:
        return true;
    }
  }

  /**
   * 根据是否满足条件返回对应的 CSS 类
   * @private
   * @param {string} factorName - 因子名称
   * @param {number} factorValue - 因子值
   * @param {Object} thresholds - 阈值对象
   * @returns {string} CSS 类名
   */
  _getFactorClass(factorName, factorValue, thresholds) {
    if (this._checkFactorMeetsCondition(factorName, factorValue, thresholds)) {
      return 'text-green-700'; // 满足条件 - 绿色
    } else {
      return 'text-red-700 font-bold'; // 不满足条件 - 红色加粗
    }
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  window.experimentSignals = new ExperimentSignals();
});