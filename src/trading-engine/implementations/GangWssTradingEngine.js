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
 *   - live：本期不支持（2026-10-27 接入裁定）。gang 为 agent-only 平台——内盘交易
 *     链上校验 Agent ID，须 Binance Agentic Wallet + 「preview→requestId→execute→
 *     App 审批」流，无法用自有 EOA 直发合约；live 执行器另案设计。_liveTraderType
 *     throw fail-fast（web 层创建 live+gang 400 在前，本防线兜底直连构造）。
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

  /** live trader 类型：恒 throw（gang live 不支持，见头注释；_liveTraderTypeFor 的
   *  per-platform 分派同款 fail-fast，两道防线） */
  _liveTraderType() {
    throw new Error('gang 平台 live 不支持（agent-only 平台须 Binance Agentic Wallet + 审批流，另案设计；本期只做采集+虚拟+回测）');
  }
}

module.exports = { GangWssTradingEngine };
