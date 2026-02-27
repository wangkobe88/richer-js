/**
 * 卡牌仓位管理器
 *
 * 实现基于卡牌的仓位分配机制：
 * - 总卡牌数量固定（默认4个）
 * - 每个卡牌对应固定的 BNB 数量
 * - 购买时：BNB仓位 → 代币仓位（转移1个卡牌）
 * - 出售时：代币仓位 → BNB仓位（转移1个卡牌）
 * - 动态计算交易数量：单个卡牌金额 × 卡牌数量
 */

const Decimal = require('decimal.js');

/**
 * 卡牌仓位管理器
 */
class CardPositionManager {
  /**
   * 构造函数
   * @param {Object} config - 配置参数
   * @param {number} config.totalCards - 总卡牌数量，默认4个
   * @param {number} config.perCardMaxBNB - 单个卡牌对应的最大BNB数量
   * @param {number} config.minCardsForTrade - 交易所需最少卡牌数，默认1个
   * @param {Object} config.initialAllocation - 初始卡牌分配
   * @param {number} config.initialAllocation.bnbCards - BNB仓位初始卡牌数
   * @param {number} config.initialAllocation.tokenCards - 代币仓位初始卡牌数
   */
  constructor(config = {}) {
    this.totalCards = config.totalCards || 4;              // 总卡牌数量
    this.perCardMaxBNB = config.perCardMaxBNB || 0.025;   // 单个卡牌对应的BNB数量
    this.minCardsForTrade = config.minCardsForTrade || 1;  // 交易所需最少卡牌数

    // 初始卡牌分配
    if (config.initialAllocation) {
      const { bnbCards, tokenCards } = config.initialAllocation;

      // 验证
      if (bnbCards === undefined || tokenCards === undefined) {
        throw new Error('initialAllocation 必须包含 bnbCards 和 tokenCards');
      }

      if (bnbCards + tokenCards !== this.totalCards) {
        throw new Error(`初始卡牌分配之和(${bnbCards} + ${tokenCards} = ${bnbCards + tokenCards})必须等于总卡牌数(${this.totalCards})`);
      }

      if (bnbCards < 0 || tokenCards < 0) {
        throw new Error('初始卡牌数不能为负数');
      }

      this.bnbCards = bnbCards;
      this.tokenCards = tokenCards;
    } else {
      // 默认：所有卡牌在BNB
      this.bnbCards = this.totalCards;
      this.tokenCards = 0;
    }

    this.lastUpdateTime = Date.now();    // 最后更新时间

    // 统计信息
    this.stats = {
      totalBuys: 0,
      totalSells: 0,
      totalCardsTransferred: 0
    };

    console.log(`🃏 卡牌仓位管理器初始化完成:`);
    console.log(`   总卡牌数: ${this.totalCards}`);
    console.log(`   单卡BNB: ${this.perCardMaxBNB}`);
    console.log(`   初始BNB仓位: ${this.bnbCards}个卡牌`);
    console.log(`   初始代币仓位: ${this.tokenCards}个卡牌`);
  }

  /**
   * 检查是否可以进行指定方向的交易
   * @param {'buy'|'sell'} direction - 交易方向
   * @returns {boolean} 是否可以交易
   */
  canTrade(direction) {
    if (direction === 'buy') {
      return this.bnbCards >= this.minCardsForTrade;
    } else if (direction === 'sell') {
      return this.tokenCards >= this.minCardsForTrade;
    }
    return false;
  }

  /**
   * 计算下次购买应该花费的BNB数量
   * @param {number} [cards=1] - 使用的卡片数量,默认1个
   * @returns {number} 购买金额(BNB)
   */
  calculateBuyAmount(cards = 1) {
    if (!this.canTrade('buy')) {
      throw new Error(`无法进行购买：BNB仓位只有${this.bnbCards}个卡牌,需要至少${this.minCardsForTrade}个`);
    }

    if (cards <= 0) {
      throw new Error(`卡片数量必须大于0,当前值: ${cards}`);
    }

    // 卡片数量不足时，使用实际可用的卡牌数量
    let actualCards = cards;
    if (cards > this.bnbCards) {
      console.warn(`⚠️  请求使用${cards}张卡，但BNB仓位只有${this.bnbCards}张可用，将使用全部${this.bnbCards}张`);
      actualCards = this.bnbCards;
    }

    // 如果没有可用卡牌，返回0
    if (actualCards === 0) {
      console.warn(`⚠️  BNB仓位没有可用卡牌，无法购买`);
      return 0;
    }

    // 使用 Decimal 进行乘法，避免浮点数精度问题
    const perCardDecimal = new Decimal(this.perCardMaxBNB);
    const actualCardsDecimal = new Decimal(actualCards);
    const buyAmountDecimal = perCardDecimal.mul(actualCardsDecimal);
    const buyAmount = buyAmountDecimal.toNumber();

    console.log(`💰 计算购买金额: ${this.perCardMaxBNB} BNB/卡 × ${actualCards}个卡牌 = ${buyAmount} BNB`);

    return buyAmount;
  }

  /**
   * 计算下次出售应该售卖的代币数量
   * @param {number|Decimal} tokenBalance - 当前代币余额
   * @param {string} tokenSymbol - 代币符号,用于日志
   * @param {number} [cards=1] - 使用的卡片数量,默认1个
   * @param {boolean} [sellAll=false] - 是否出售全部持仓
   * @returns {number} 出售数量(代币)
   */
  calculateSellAmount(tokenBalance, tokenSymbol = 'TOKEN', cards = 1, sellAll = false) {
    // 全部出售模式 - 直接返回原值（保持 Decimal 类型）
    if (sellAll) {
      console.log(`💰 计算出售数量(全部): ${tokenBalance} ${tokenSymbol}`);
      // 如果是 Decimal 类型，返回其数值；否则返回原值
      return tokenBalance instanceof Decimal ? tokenBalance.toNumber() : tokenBalance;
    }

    if (!this.canTrade('sell')) {
      throw new Error(`无法进行出售：代币仓位只有${this.tokenCards}个卡牌,需要至少${this.minCardsForTrade}个`);
    }

    // 使用 Decimal 进行高精度计算
    const balance = new Decimal(tokenBalance);

    if (balance.lte(0)) {
      throw new Error(`${tokenSymbol}代币余额不足,无法进行出售`);
    }

    if (cards <= 0) {
      throw new Error(`卡片数量必须大于0,当前值: ${cards}`);
    }

    // 卡片数量不足时，使用实际可用的卡牌数量
    let actualCards = cards;
    if (cards > this.tokenCards) {
      console.warn(`⚠️  请求使用${cards}张卡，但代币仓位只有${this.tokenCards}张可用，将使用全部${this.tokenCards}张`);
      actualCards = this.tokenCards;
    }

    // 如果没有可用卡牌，返回0
    if (actualCards === 0) {
      console.warn(`⚠️  代币仓位没有可用卡牌，无法出售`);
      return 0;
    }

    // 使用 Decimal 进行除法和乘法，避免浮点数精度问题
    const tokenCardsDecimal = new Decimal(this.tokenCards);
    const actualCardsDecimal = new Decimal(actualCards);
    const sellAmountDecimal = balance.div(tokenCardsDecimal).mul(actualCardsDecimal);

    // 转换为 number 返回（保持与现有接口兼容）
    const sellAmount = sellAmountDecimal.toNumber();

    console.log(`💰 计算出售数量: (${tokenBalance} ${tokenSymbol} ÷ ${this.tokenCards}个卡牌) × ${actualCards}个卡牌 = ${sellAmount} ${tokenSymbol}`);

    return sellAmount;
  }

  /**
   * 购买后更新卡牌分配
   * @param {string} tokenSymbol - 购买的代币符号
   * @param {number} [cards=1] - 转移的卡片数量,默认1个
   */
  afterBuy(tokenSymbol = 'TOKEN', cards = 1) {
    console.log(`🔍 [afterBuy] 调用参数: tokenSymbol=${tokenSymbol}, cards=${cards}`);
    console.log(`   当前状态: BNB卡=${this.bnbCards}, Token卡=${this.tokenCards}`);

    // 卡片数量不足时，使用实际可用的卡牌数量
    let actualCards = cards;
    if (cards > this.bnbCards) {
      const msg = `⚠️  afterBuy: 请求转移${cards}张卡，但BNB仓位只有${this.bnbCards}张可用，将转移全部${this.bnbCards}张`;
      console.warn(msg);
      actualCards = this.bnbCards;
    }

    // 如果没有可用卡牌，不更新
    if (actualCards === 0) {
      const msg = `⚠️  afterBuy: BNB仓位没有可用卡牌，跳过卡牌更新`;
      console.warn(msg);
      return;
    }

    // 更新卡牌分配
    const prevBnbCards = this.bnbCards;
    const prevTokenCards = this.tokenCards;

    this.bnbCards -= actualCards;
    this.tokenCards += actualCards;
    this.lastUpdateTime = Date.now();
    this.stats.totalBuys++;
    this.stats.totalCardsTransferred += actualCards;

    // 详细日志
    console.log(`🃏 购买${tokenSymbol}后卡牌分配更新:`);
    console.log(`   BNB仓位: ${prevBnbCards} → ${this.bnbCards} (-${actualCards})`);
    console.log(`   代币仓位: ${prevTokenCards} → ${this.tokenCards} (+${actualCards})`);
  }

  /**
   * 出售后更新卡牌分配
   * @param {string} tokenSymbol - 出售的代币符号
   * @param {number} [cards=1] - 转移的卡片数量,默认1个
   * @param {boolean} [sellAll=false] - 是否出售全部持仓
   */
  afterSell(tokenSymbol = 'TOKEN', cards = 1, sellAll = false) {
    console.log(`🔍 [afterSell] 调用参数: tokenSymbol=${tokenSymbol}, cards=${cards}, sellAll=${sellAll}`);
    console.log(`   当前状态: BNB卡=${this.bnbCards}, Token卡=${this.tokenCards}`);

    if (sellAll) {
      // 全部出售:所有代币卡牌转移回BNB
      const transferredCards = this.tokenCards;
      const prevBnbCards = this.bnbCards;

      this.bnbCards += this.tokenCards;
      this.tokenCards = 0;
      this.lastUpdateTime = Date.now();
      this.stats.totalSells++;
      this.stats.totalCardsTransferred += transferredCards;

      console.log(`🃏 出售${tokenSymbol}后卡牌分配更新(全部):`);
      console.log(`   BNB仓位: ${prevBnbCards} → ${this.bnbCards} (+${transferredCards})`);
      console.log(`   代币仓位: ${this.tokenCards}个卡牌 (清空)`);
      return;
    }

    // 卡片数量不足时，使用实际可用的卡牌数量
    let actualCards = cards;
    if (cards > this.tokenCards) {
      const msg = `⚠️  afterSell: 请求转移${cards}张卡，但代币仓位只有${this.tokenCards}张可用，将转移全部${this.tokenCards}张`;
      console.warn(msg);
      actualCards = this.tokenCards;
    }

    // 如果没有可用卡牌，不更新
    if (actualCards === 0) {
      const msg = `⚠️  afterSell: 代币仓位没有可用卡牌，跳过卡牌更新`;
      console.warn(msg);
      return;
    }

    // 更新卡牌分配
    const prevBnbCards = this.bnbCards;
    const prevTokenCards = this.tokenCards;

    this.tokenCards -= actualCards;
    this.bnbCards += actualCards;
    this.lastUpdateTime = Date.now();
    this.stats.totalSells++;
    this.stats.totalCardsTransferred += actualCards;

    // 详细日志
    console.log(`🃏 出售${tokenSymbol}后卡牌分配更新:`);
    console.log(`   BNB仓位: ${prevBnbCards} → ${this.bnbCards} (+${actualCards})`);
    console.log(`   代币仓位: ${prevTokenCards} → ${this.tokenCards} (-${actualCards})`);
  }

  /**
   * 获取仓位健康状态
   * @returns {Object} 健康状态信息
   */
  getHealthStatus() {
    const bnbRatio = this.bnbCards / this.totalCards;
    const tokenRatio = this.tokenCards / this.totalCards;

    let healthLevel = 'healthy';
    let recommendation = '仓位分配正常';

    if (bnbRatio < 0.2) {
      healthLevel = 'warning';
      recommendation = 'BNB仓位卡牌过少，建议适当出售代币';
    } else if (tokenRatio < 0.2) {
      healthLevel = 'warning';
      recommendation = '代币仓位卡牌过少，建议适当购买代币';
    } else if (bnbRatio < 0.1 || tokenRatio < 0.1) {
      healthLevel = 'critical';
      recommendation = '仓位极度不平衡，需要立即重新平衡';
    }

    return {
      healthLevel,
      healthy: healthLevel === 'healthy',
      bnbRatio,
      tokenRatio,
      recommendation,
      totalCards: this.totalCards,
      bnbCards: this.bnbCards,
      tokenCards: this.tokenCards,
      perCardMaxBNB: this.perCardMaxBNB
    };
  }

  /**
   * 获取当前状态摘要
   * @returns {Object} 状态摘要
   */
  getStatusSummary() {
    return {
      totalCards: this.totalCards,
      perCardMaxBNB: this.perCardMaxBNB,
      bnbCards: this.bnbCards,
      tokenCards: this.tokenCards,
      lastUpdateTime: this.lastUpdateTime,
      canBuy: this.canTrade('buy'),
      canSell: this.canTrade('sell'),
      stats: { ...this.stats }
    };
  }

  /**
   * 打印详细状态信息
   * @param {Object} [tokenBalances] - 代币余额映射（可选）
   */
  printStatus(tokenBalances = {}) {
    console.log('\n🃏 卡牌仓位状态:');
    console.log(`   总卡牌数: ${this.totalCards}`);
    console.log(`   单卡BNB: ${this.perCardMaxBNB}`);
    console.log(`   BNB仓位: ${this.bnbCards}个卡牌 (${(this.bnbCards/this.totalCards*100).toFixed(1)}%)`);
    console.log(`   代币仓位: ${this.tokenCards}个卡牌 (${(this.tokenCards/this.totalCards*100).toFixed(1)}%)`);

    if (this.canTrade('buy')) {
      const nextBuyAmount = this.calculateBuyAmount();
      console.log(`   下次购买金额: ${nextBuyAmount} BNB`);
    }

    const health = this.getHealthStatus();
    console.log(`   健康状态: ${health.healthy ? '✅ 健康' : '⚠️ ' + health.recommendation}`);

    console.log(`   统计信息: 购买${this.stats.totalBuys}次, 出售${this.stats.totalSells}次, 卡牌转移${this.stats.totalCardsTransferred}次`);
  }

  /**
   * 重置到初始状态
   */
  reset() {
    this.bnbCards = this.totalCards;
    this.tokenCards = 0;
    this.lastUpdateTime = Date.now();
    this.stats = {
      totalBuys: 0,
      totalSells: 0,
      totalCardsTransferred: 0
    };

    console.log('🃏 卡牌仓位管理器已重置到初始状态');
  }

  /**
   * 动态设置初始卡牌分配
   * @param {number} bnbCards - BNB仓位卡牌数
   * @param {number} tokenCards - 代币仓位卡牌数
   */
  setInitialAllocation(bnbCards, tokenCards) {
    // 验证
    if (typeof bnbCards !== 'number' || typeof tokenCards !== 'number') {
      throw new Error('卡牌数必须是数字');
    }

    if (bnbCards < 0 || tokenCards < 0) {
      throw new Error('卡牌数不能为负数');
    }

    if (bnbCards + tokenCards !== this.totalCards) {
      throw new Error(`卡牌分配之和(${bnbCards} + ${tokenCards} = ${bnbCards + tokenCards})必须等于总卡牌数(${this.totalCards})`);
    }

    const prevBnbCards = this.bnbCards;
    const prevTokenCards = this.tokenCards;

    this.bnbCards = bnbCards;
    this.tokenCards = tokenCards;
    this.lastUpdateTime = Date.now();

    console.log(`🔄 卡牌分配已动态更新:`);
    console.log(`   BNB仓位: ${prevBnbCards} → ${this.bnbCards}`);
    console.log(`   代币仓位: ${prevTokenCards} → ${this.tokenCards}`);
  }

  /**
   * 验证配置参数
   * @param {Object} config - 配置参数
   * @returns {boolean} 配置是否有效
   */
  static validateConfig(config) {
    if (!config) return true;

    if (config.totalCards && (config.totalCards < 2 || config.totalCards > 36)) {
      throw new Error('总卡牌数量必须在2-36之间');
    }

    if (config.minCardsForTrade && (config.minCardsForTrade < 1 || config.minCardsForTrade > config.totalCards)) {
      throw new Error('最少交易卡牌数必须在1到总卡牌数之间');
    }

    if (config.perCardMaxBNB !== undefined && config.perCardMaxBNB <= 0) {
      throw new Error('单卡BNB数量必须大于0');
    }

    // 验证初始分配
    if (config.initialAllocation) {
      const { bnbCards, tokenCards } = config.initialAllocation;
      const total = config.totalCards || 4;

      if (bnbCards !== undefined && tokenCards !== undefined) {
        if (bnbCards + tokenCards !== total) {
          throw new Error(`初始卡牌分配之和(${bnbCards} + ${tokenCards} = ${bnbCards + tokenCards})必须等于总卡牌数(${total})`);
        }
        if (bnbCards < 0 || tokenCards < 0) {
          throw new Error('初始卡牌数不能为负数');
        }
      }
    }

    return true;
  }
}

module.exports = {
  CardPositionManager
};
