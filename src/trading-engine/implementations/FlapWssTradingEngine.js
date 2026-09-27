/**
 * Flap WSS 交易引擎（BSC flap.sh 专用，事件驱动）
 *
 * 继承 FourMemeWssTradingEngine：买/卖管线、去抖、守护 intervals、重启恢复、时序快照
 * 全部复用父类；仅覆盖平台差异点：
 *   - 配置节：flapWs（config/default.json，实验级 config.flapWs 浅合并覆盖）
 *   - 消费平台：_wsPlatforms()=['flap']（SharedTickConsumer 本地过滤 watcher 双平台流中的
 *     flap 行；WSS 订阅由常驻 watcher 统一持有，事件口径见 flap collector 头注释）
 *   - 新代币落库：无 override——基类 _handleNewToken(info, platform) 按 row.platform
 *     分派 _buildFlapTokenRecord（platform='flap' + flap TokenCreated 字段存档，与旧
 *     override 逐字段一致）；本子类消费集合只放行 flap 行，实参恒 'flap'
 *   - innerPair 后缀：_buildTokenInfo override 保留（flap 版无 name 字段——不给
 *     存量 flap 实验的预检查新增 AVE 同名检查输入，行为零变化）
 *   - live：暂不支持（_initializeLiveTrader 覆盖为 fail-fast；FlapPortalTrader
 *     swapExactInput 接入后在此处替换——TraderFactory 注册位）
 *
 * 范围：virtual 虚拟交易 + backtest（BacktestEngine 平台无关，tick 同表回放）。
 */

const { FourMemeWssTradingEngine } = require('./FourMemeWssTradingEngine');

class FlapWssTradingEngine extends FourMemeWssTradingEngine {
  constructor(engineConfig = {}) {
    super(engineConfig);
    this._id = `flapWs_${Date.now()}`;   // id/name 为 getter-only，改支撑字段
    this._name = 'Flap WSS Trading Engine';
  }

  /** flapWs 配置节（引擎参数 + consumer 轮询参数） */
  _wsConfigSectionName() {
    return 'flapWs';
  }

  /** 消费平台集合：恒 ['flap']（显式子类身份，防 flap 引擎类被误配非 flap 实验；
   *  SharedTickConsumer 本地过滤 ticks/events，flap token_create 的 registerToken
   *  totalSupply 由 consumer 内部按行 platform 取 FLAP_TOTAL_SUPPLY） */
  _wsPlatforms() {
    return ['flap'];
  }

  /** 代币信息（购买前检查用；innerPair 后缀 _fl 区分 flap 内盘存档；无 name 字段——见头注释） */
  _buildTokenInfo(token) {
    return {
      address: token.token,
      symbol: token.symbol,
      chain: token.chain || 'bsc',
      platform: token.platform || 'flap',
      launchAt: token.createdAt || null,
      innerPair: `${token.token}_fl`,
      pairAddress: token.pairAddress || null,
    };
  }

  /**
   * live 暂不支持：fail-fast。后续接入点——FlapPortalTrader
   * （Portal.quoteExactInput / swapExactInput）+ TraderFactory 注册 'flap' + flapWs.live 段
   */
  async _initializeLiveTrader() {
    throw new Error('flap live 交易暂未实现（规划中：FlapPortalTrader + live 验收流程）');
  }
}

module.exports = { FlapWssTradingEngine };
