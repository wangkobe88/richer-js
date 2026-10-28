/**
 * Gang WSS 交易引擎（BSC gang.fun LaunchpadV2 专用，事件驱动）
 *
 * 继承 FourMemeWssTradingEngine：买/卖管线、去抖、守护 intervals、重启恢复、时序快照
 * 全部复用父类；仅覆盖平台差异点：
 *   - 配置节：gangWs（config/default.json，实验级 config.gangWs 浅合并覆盖）
 *   - 采集平台：_wsPlatforms()=['gang']（基类 _createCollectors 按此构造一枚
 *     GangAnkrWsCollector 内嵌本进程持有订阅，事件口径见 gang collector 头注释——
 *     五事件 topic0 已链上实测对拍；计价币 Created 终态固定，无 flap QuoteSet）
 *   - 新代币落库：基类 _handleNewToken(info, 'gang') 分派 _buildGangTokenRecord
 *     （platform='gang' + totalSupply 1e9 + quote/gradAmt 存档字段）
 *   - 毕业进度：gang 资金口径（净入金 1.0/1.0 直计 / 阈值 graduationThresholdBnb
 *     ?? 15，见 FA _graduationFundsThreshold gang 分支）
 *   - live（2026-10-28 用户裁定「直接实盘」）：GangBawTrader——官方 gang CLI 子进程
 *     封装 + Binance Agentic Wallet（半自动通道：买全自动 BROADCASTED / 卖须 App
 *     确认 PENDING_CONFIRMATION，形状档案 docs/gang-cli-shapes.md）。钱包=BAW 地址
 *     address-only（无 privateKey，引擎 BAW 第三形态）；毕业票不路由 PCS（BAW 无
 *     EOA 签名链）——Telegram 告警 + 人工 gang CLI 处置（_graduatedManualIntercept）。
 *     卖出到账 WNB（WBNB ERC20），实收=WBNB 余额差（trader 内）。
 *
 * 范围：virtual 虚拟交易 + backtest（BacktestEngine 平台无关，tick 同表回放）。
 */

const { FourMemeWssTradingEngine } = require('./FourMemeWssTradingEngine');

class GangWssTradingEngine extends FourMemeWssTradingEngine {
  constructor(engineConfig = {}) {
    super(engineConfig);
    this._id = `gangWs_${Date.now()}`;   // id/name 为 getter-only，改支撑字段
    this._name = 'Gang WSS Trading Engine';
  }

  /** gangWs 配置节（引擎参数 + 内嵌 gang collector 段） */
  _wsConfigSectionName() {
    return 'gangWs';
  }

  /** 采集平台集合：恒 ['gang']（显式子类身份，防 gang 引擎类被误配非 gang 实验；
   *  基类 _createCollectors 按此构造 GangAnkrWsCollector（gangWs 段），gang
   *  token_create 的 registerToken totalSupply 由 collector 恒取 GANG_TOTAL_SUPPLY） */
  _wsPlatforms() {
    return ['gang'];
  }

  /** 代币信息（购买前检查用；innerPair 后缀 _ga 区分 gang 内盘存档；gang info 有
   *  name 字段，走父类形状仅改后缀） */
  _buildTokenInfo(token) {
    return {
      address: token.token,
      symbol: token.symbol,
      name: token.name || '',
      chain: token.chain || 'bsc',
      platform: token.platform || 'gang',
      launchAt: token.createdAt || null,
      innerPair: `${token.token}_ga`,
      pairAddress: token.pairAddress || null,
    };
  }

  /** live trader 类型：GangBawTrader（官方 gang CLI + BAW 审批流，见头注释）。
   *  注册名 'gang'（traders/index.js GangBawTrader） */
  _liveTraderType() {
    return 'gang';
  }

  /** trader 构造后钩子（基类空实现，gang 覆盖）：注入 Telegram 告警钩子——卖侧
   *  PENDING_CONFIRMATION / 状态未定防重发锁必须实时触达用户（App 确认是人在环上） */
  async _postTraderInit(trader) {
    trader.setAlertHook((title, body) => this._notifyLiveAlert(title, body));
    this.logger.info(this._experimentId, 'GangWssTradingEngine', 'GangBawTrader 告警钩子已接（App 确认提醒/防重发锁告警走 Telegram）');
  }

  /** gang 毕业票人工处置拦截（基类恒 false）：BAW 无 EOA 签名链，_ensurePcsTrader
   *  读 wallet.privateKey 必炸——本钩子返回 true 后自动卖（策略/止损/扫描兜底）与
   *  手工卖全部短路，Telegram 告警一次（同 token 去重 30min，防 30s 扫描兜底每轮
   *  重触发拦截造成告警风暴）。毕业票处置须人工（Binance App / 转 EOA 钱包） */
  _graduatedManualIntercept(signal, gradInfo) {
    const token = signal?.tokenAddress;
    const now = Date.now();
    this._gradAlertAt = this._gradAlertAt || new Map();
    const last = this._gradAlertAt.get(token) || 0;
    if (now - last > 30 * 60 * 1000) {
      this._gradAlertAt.set(token, now);
      const qty = Number(this._getHolding(token)?.amount ?? 0);
      this._notifyLiveAlert('🎓 gang 毕业票人工处置（自动卖已拦截）',
        `${signal?.symbol || token} 已毕业（内盘曲线终结，BAW 无法在外盘签名）。` +
        `持仓 ${qty} 个请人工处置（Binance App / 转 EOA 钱包去 PCS），引擎已长冷却不再自动卖。` +
        `Token: ${token}`);
    }
    return true;
  }
}

module.exports = { GangWssTradingEngine };
