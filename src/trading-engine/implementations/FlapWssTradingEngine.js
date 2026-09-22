/**
 * Flap WSS 交易引擎（BSC flap.sh 专用，事件驱动）
 *
 * 继承 FourMemeWssTradingEngine：买/卖管线、去抖、守护 intervals、重启恢复、时序快照
 * 全部复用父类；仅覆盖平台差异点：
 *   - 配置节：flapWs（config/default.json，实验级 config.flapWs 浅合并覆盖）
 *   - 采集器：FlapAnkrWsCollector（订阅 flap Portal 合约，事件口径见 collector 头注释）
 *   - 新代币落库：platform='flap' + flap TokenCreated 字段存档
 *   - innerPair 后缀：_fl（仅日志与 early_participant_trades 存档用）
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

  /** flapWs 配置节（引擎参数 + collector 订阅合约） */
  _wsConfigSectionName() {
    return 'flapWs';
  }

  /** flap Portal 采集器（发现 + tick + LaunchedToDEX 毕业） */
  _createCollector() {
    const { FlapAnkrWsCollector } = require('../../collectors/flap-ankr-ws-collector');
    return new FlapAnkrWsCollector(
      { flapWs: this._mergedWsConfig() },
      this.logger,
      this._tokenPool,
      this._factorAggregator,
      {
        onTokenCreate: (info) => this._handleNewToken(info),
        onGraduation: (info) => this._handleGraduation(info),
      },
    );
  }

  /** TokenCreated：新代币落库 experiment_tokens（platform='flap' + flap 字段存档） */
  async _handleNewToken(info) {
    const tokenKey = `${info.token}-bsc`;
    if (this._seenTokens.has(tokenKey)) return;
    this._seenTokens.add(tokenKey);

    try {
      await this.dataService.saveToken(this._experimentId, {
        token: info.token,
        symbol: info.symbol || '',
        chain: 'bsc',
        platform: 'flap',
        data_source: 'wss',
        created_at: Math.floor(info.blockTimeMs / 1000),
        raw_api_data: {
          source: 'wss_token_create',
          name: info.name,
          symbol: info.symbol,
          totalSupply: 1e9,          // flap 内盘固定总量
          creator: info.creator,
          nonce: info.nonce,
          eventTs: info.eventTsSec,  // 事件自带秒级时间戳（年龄口径仍用块时间，仅存档）
          meta: info.meta,           // IPFS 元数据 URL
          taxToken: info.taxToken,   // 税币（地址后缀 7777）
          blockNumber: info.blockNumber,
          txHash: info.txHash,
        },
        creator_address: info.creator,
        status: 'monitoring',
      });
    } catch (error) {
      this.logger.error(this._experimentId, 'NewToken',
        `新代币落库失败 | ${info.token} ${error.message}`);
      return;
    }

    // 行已确保存在后补采语料（IPFS metadata，meta=IPFS URL/裸 CID；
    // fire-and-forget 同 four.meme，enricher 配置取 flapWs.corpusEnrich）
    this._enrichCorpus(info, 'flap');
  }

  /** 代币信息（购买前检查用；innerPair 后缀 _fl 区分 flap 内盘存档） */
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
