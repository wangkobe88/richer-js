# 实盘交易引擎重建方案 v2

## 概述

本文档详细规划实盘交易引擎（LiveTradingEngine）的重建工作。**核心原则**：三种引擎（虚拟、回测、实盘）共用统一基类，差异仅在于**持仓数据来源**和**交易执行方式**。

## 一、架构设计：统一基类方案

### 1.1 三种引擎对比分析

| 特性 | VirtualTradingEngine | BacktestEngine | LiveTradingEngine (待实现) |
|------|---------------------|----------------|---------------------------|
| **监控循环** | 定时轮询 (_runMonitoringLoop) | 历史数据遍历 (_runBacktest) | 定时轮询 (_runMonitoringLoop) |
| **数据源** | FourmemeCollector 实时采集 | 时序数据回放 | FourmemeCollector 实时采集 |
| **持仓来源** | PortfolioManager 虚拟持仓 | PortfolioManager 回放持仓 | PortfolioManager + **AVE API 同步** |
| **交易执行** | 模拟交易，立即更新 | 回放历史交易 | **真实链上交易** |
| **TokenPool** | ✅ 使用 | ✅ 使用 (_tokenStates 模拟) | ✅ 使用 |
| **StrategyEngine** | ✅ 使用 | ✅ 使用 | ✅ 使用 |
| **CardPositionManager** | ✅ 使用 | ✅ 使用 | ✅ **必须使用** |
| **RoundSummary** | ✅ 使用 | ✅ 使用 | ✅ 使用 |
| **TimeSeries 记录** | ✅ 实时记录 | ❌ 不记录（回放历史） | ✅ 实时记录 |

### 1.2 统一基类架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AbstractTradingEngine (统一基类)                      │
├─────────────────────────────────────────────────────────────────────────┤
│  公共属性:                                                               │
│  + _tokenPool: TokenPool                                                │
│  + _fourmemeCollector: FourmemeCollector                                 │
│  + _strategyEngine: StrategyEngine                                       │
│  + _portfolioManager: PortfolioManager  (含 CardPositionManager)         │
│  + _roundSummary: RoundSummary                                           │
│  + _timeSeriesService: ExperimentTimeSeriesService                       │
│  + _experiment: Experiment                                               │
│  + _logger: Logger                                                       │
│                                                                          │
│  公共方法:                                                               │
│  + initialize(experimentOrId)                                            │
│  + start()                                                               │
│  + stop()                                                                │
│                                                                          │
│  抽象方法 (子类必须实现):                                                 │
│  + _initializeDataSources()      - 初始化数据源                           │
│  + _runMainLoop()                - 主循环（轮询或回放）                    │
│  + _syncHoldings()               - 同步持仓                               │
│  + _executeBuy(signal)           - 执行买入                               │
│  + _executeSell(signal)          - 执行卖出                               │
│  + _shouldRecordTimeSeries()     - 是否记录时序数据                       │
└─────────────────────────────────────────────────────────────────────────┘
                              △
                              │ 继承
          ┌─────────────────┼─────────────────┐
          │                 │                 │
┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
│  VirtualTrading │ │  Backtest    │ │  LiveTrading     │
│  Engine         │ │  Engine      │ │  Engine          │
├─────────────────┤ ├──────────────┤ ├──────────────────┤
│ _initializeData │ │ _initialize  │ │ _initializeData   │
│ _runMonitoring  │ │ _runBacktest │ │ _runMonitoring   │
│                 │ │              │ │                   │
│ _syncHoldings:  │ │ _syncHold    │ │ _syncHoldings:   │
│ → 返回虚拟持仓  │ │ → 从时序     │ │ → **AVE API**    │
│                 │ │   数据回放   │ │                   │
│ _executeBuy:    │ │ _executeBuy: │ │ _executeBuy:      │
│ → 模拟交易      │ │ → 回放历史   │ │ → **真实交易**    │
│                 │ │   交易       │ │                   │
│ _shouldRecord:  │ │ _shouldRec:  │ │ _shouldRecord:    │
│ → true          │ │ → false      │ │ → true            │
└─────────────────┘ └──────────────┘ └──────────────────┘
```

### 1.3 核心流程统一

```javascript
// AbstractTradingEngine.js - 主流程框架

async _processSingleRound() {
  // 1. 同步持仓 (子类实现不同逻辑)
  await this._syncHoldings();

  // 2. 采集新币/更新数据 (子类实现不同数据源)
  const tokens = await this._collectTokens();

  // 3. 为每个代币生成策略信号
  for (const token of tokens) {
    const signal = await this._strategyEngine.generateSignal(token, this._portfolioManager);

    if (signal) {
      await this._handleSignal(signal);  // 4. 处理信号
    }
  }

  // 5. 创建投资组合快照
  await this._createPortfolioSnapshot();

  // 6. 记录时序数据 (如果子类允许)
  if (this._shouldRecordTimeSeries()) {
    await this._recordTimeSeriesData();
  }

  // 7. 输出轮次摘要
  if (this._roundSummary) {
    this._roundSummary.printToConsole();
    this._roundSummary.writeToLog();
  }
}

async _handleSignal(signal) {
  // 记录信号到数据库
  await this._saveSignal(signal);

  if (signal.action === 'buy') {
    const result = await this._executeBuy(signal);
    await this._handleTradeResult(result, signal);
  } else if (signal.action === 'sell') {
    const result = await this._executeSell(signal);
    await this._handleTradeResult(result, signal);
  }
}
```

## 二、实盘引擎核心实现

### 2.1 PortfolioManager 使用（含卡盘仓位管理）

**关键点**: 实盘引擎**完全使用** PortfolioManager，包括 CardPositionManager 的卡盘仓位计算。区别仅在于**数据来源**。

**重要**: 从 AVE API 同步持仓时，**必须保留 CardPositionManager 的卡牌状态**，只更新 PortfolioManager 的持仓数据（余额、成本）。

```javascript
// LiveTradingEngine.js

async _syncHoldings() {
  // 1. 从 AVE API 获取真实钱包持仓
  const walletBalances = await this._walletService.getWalletBalances(
    this.walletAddress,
    this.blockchain || 'bsc'
  );

  // 2. 获取当前 PortfolioManager
  const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);

  // 3. 记录现有 CardPositionManager 状态（需要保留）
  const existingCardManagers = new Map();
  for (const [tokenAddr, position] of portfolio.positions) {
    const cardManager = this._tokenPool.getCardPositionManager(tokenAddr, this.blockchain);
    if (cardManager) {
      existingCardManagers.set(tokenAddr, {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards,
        perCardMaxBNB: cardManager.perCardMaxBNB
      });
    }
  }

  // 4. 清空现有持仓（只清 PortfolioManager，不清 TokenPool 的 CardPositionManager）
  portfolio.positions.clear();

  // 5. 同步真实持仓到 PortfolioManager
  for (const token of walletBalances) {
    if (token.balance.gt(0)) {
      const normalizedAddr = BlockchainConfig.normalizeTokenAddress(
        token.address,
        this.blockchain
      );

      // 更新或创建持仓（只更新余额和成本，不影响卡牌状态）
      await this._portfolioManager.updatePosition(
        this._portfolioId,
        normalizedAddr,
        token.balance,
        token.averagePurchasePrice || token.priceUSD || 0,
        'hold'
      );

      // 如果是新代币（没有 CardPositionManager），创建默认卡牌管理器
      const existingManager = existingCardManagers.get(normalizedAddr);
      if (!existingManager) {
        let cardManager = this._tokenPool.getCardPositionManager(normalizedAddr, this.blockchain);
        if (!cardManager) {
          // 新代币：创建默认卡牌管理器（初始状态：全部卡牌在 BNB）
          cardManager = new CardPositionManager({
            totalCards: 4,
            perCardMaxBNB: 0.025,
            initialAllocation: {
              bnbCards: 4,  // 初始全部在 BNB
              tokenCards: 0
            }
          });
          this._tokenPool.setCardPositionManager(normalizedAddr, this.blockchain, cardManager);
          console.log(`🃏 为新代币创建卡牌管理器: ${token.symbol} (${normalizedAddr})`);
        }
      }
      // 如果已有 CardPositionManager，保持其状态不变
    }
  }

  console.log(`💰 实盘持仓已同步: ${portfolio.positions.size} 种代币`);
  console.log(`   保留卡牌状态: ${existingCardManagers.size} 个代币`);
}
```

**核心原理**:

```
┌─────────────────────────────────────────────────────────┐
│           AVE API 持仓同步流程                           │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  1. 从 AVE API 获取真实持仓                               │
│     - 代币余额 (balance)                                │
│     - 平均成本 (averagePurchasePrice)                   │
│     - 当前价值 (valueUSD)                               │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  2. 保存现有 CardPositionManager 状态                    │
│     - bnbCards (BNB卡牌数)                              │
│     - tokenCards (代币卡牌数)                           │
│     - 这些是策略状态，不能被覆盖！                        │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  3. 更新 PortfolioManager 持仓数据                        │
│     - positions[token].amount = AVE余额                  │
│     - positions[token].averagePrice = AVE成本            │
│     - 不影响 CardPositionManager                         │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  4. 处理新代币                                           │
│     - 如果是新代币，创建默认 CardPositionManager          │
│     - 初始状态：全部卡牌在 BNB (bnbCards=4, tokenCards=0) │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  5. 已有代币保持 CardPositionManager 状态不变              │
│     - 卡牌分配保持交易后的状态                            │
│     - 代币市值变化不影响卡牌数量                          │
└─────────────────────────────────────────────────────────┘
```

**关键差异**:

| 组件 | 数据来源 | 更新频率 | 说明 |
|------|---------|---------|------|
| **PortfolioManager** | AVE API | 每轮同步 | 真实持仓数据：余额、成本、价值 |
| **CardPositionManager** | 交易后更新 | 仅在买入/卖出后 | 策略状态：卡牌分配（bnbCards/tokenCards） |
| **TokenPool** | 合并两者 | 持续更新 | 代币信息 + 卡牌状态 |

**AVE API 返回的平均成本价**:

AVE API 的 `averagePurchasePrice` 已经考虑了多次买入的平均成本，可以直接用于初始化 CardPositionManager。

```javascript
// AVE API 返回数据示例
{
  symbol: "TOKEN",
  address: "0x...",
  balance: Decimal("1000"),
  valueUSD: Decimal("500"),
  averagePurchasePrice: 0.5,  // ✅ 直接使用
  pnl: {
    unrealized: Decimal("100"),
    realized: Decimal("50"),
    total: Decimal("150")
  }
}
```

### 2.2 每轮迭代持仓同步流程

```
┌─────────────────────────────────────────────────────────┐
│          LiveTradingEngine._processSingleRound()         │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  1. _syncHoldings() - 每轮开始时同步真实持仓              │
├─────────────────────────────────────────────────────────┤
│  - 调用 AVE API 获取钱包所有代币余额                      │
│  - 清空 PortfolioManager 当前持仓                         │
│  - 用真实持仓重建 PortfolioManager                         │
│  - CardPositionManager 自动处理卡盘计算                    │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  2. 采集新币 + 生成信号                                   │
├─────────────────────────────────────────────────────────┤
│  - FourmemeCollector 采集新币                            │
│  - TokenPool 更新价格                                    │
│  - StrategyEngine 生成信号（基于 _portfolioManager）      │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  3. 执行交易                                             │
├─────────────────────────────────────────────────────────┤
│  - _executeBuy()  → 真实链上交易                          │
│  - _executeSell() → 真实链上交易                          │
│  - 交易后更新 PortfolioManager                           │
│  - CardPositionManager 自动计算新仓位                     │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  4. 记录时序数据                                         │
├─────────────────────────────────────────────────────────┤
│  - 记录信号、价格、持仓状态                               │
│  - CardPositionManager 的卡盘数据也会被记录               │
└─────────────────────────────────────────────────────────┘
```

### 2.3 卡盘仓位管理的关键优势

实盘引擎使用 CardPositionManager 的好处：

1. **分批买入的成本跟踪**: 不同价格买入的代币会按批次记录
2. **精确的盈亏计算**: FIFO 算法确保卖出时成本计算准确
3. **风险控制**: 可以设置单个代币最大仓位
4. **与虚拟/回测一致**: 三种引擎使用相同的仓位管理逻辑

```javascript
// CardPositionManager 自动处理示例

// 买入 1000 个代币，价格 0.5
portfolioManager.addPosition(tokenAddr, 1000, 0.5);
// → CardPositionManager 创建仓位: { amount: 1000, cost: 500 }

// 再次买入 500 个代币，价格 0.6
portfolioManager.addPosition(tokenAddr, 500, 0.6);
// → CardPositionManager 创建新仓位: { amount: 500, cost: 300 }

// 卖出 800 个代币，当前价格 0.7
portfolioManager.reducePosition(tokenAddr, 800, 0.7);
// → FIFO 算法：
//   - 先卖出第一批的全部 1000 个（成本 500）→ 但只卖 800 个，成本 = 500 * 0.8 = 400
//   - 盈亏 = 800 * 0.7 - 400 = 560 - 400 = 160
```

## 三、WalletService 与 AVE API 集成

### 3.1 WalletService 数据结构

```javascript
// services/WalletService.js (拷贝自 rich-js)

class WalletService {
  async getWalletBalances(walletAddress, chain = 'bsc') {
    // 调用 AVE API
    const url = `https://prod.ave-api.com/v2/address/walletinfo/tokens
                  ?wallet_address=${walletAddress}&chain=${chain}&pageSize=500`;

    const response = await fetch(url, {
      headers: { 'X-API-KEY': this.apiKey }
    });

    const result = await response.json();
    const walletData = result.data || [];

    return walletData.map(token => ({
      symbol: token.symbol,
      address: token.token,
      balance: new Decimal(token.balance_amount || 0),
      valueUSD: new Decimal(token.balance_usd || 0),
      priceUSD: new Decimal(token.current_price_usd || 0),
      averagePurchasePrice: parseFloat(token.average_purchase_price_usd || 0),
      decimals: token.decimals || 18,
      pnl: {
        unrealized: new Decimal(token.unrealized_profit || 0),
        realized: new Decimal(token.realized_profit || 0),
        total: new Decimal(token.total_profit || 0)
      }
    }));
  }
}
```

### 3.2 LiveTradingEngine 集成

```javascript
// LiveTradingEngine.js

const { WalletService } = require('../../services/WalletService');
const { BlockchainConfig } = require('../../utils/BlockchainConfig');

class LiveTradingEngine extends AbstractTradingEngine {
  constructor(config) {
    super(config);
    this._walletService = new WalletService({
      apiKey: process.env.AVE_API_KEY,
      timeout: 30000,
      retryAttempts: 3
    });
    this.walletAddress = null;
    this.privateKey = null;
  }

  async onInitialize(config) {
    // ... 基类初始化

    // 解密钱包信息
    const walletConfig = this.experiment.config?.wallet;
    if (walletConfig?.encryptedPrivateKey) {
      const encryptionPassword = process.env.ENCRYPTION_PASSWORD;
      this.privateKey = CryptoUtils.decryptPrivateKey(
        walletConfig.encryptedPrivateKey,
        encryptionPassword
      );
      this.walletAddress = walletConfig.address;

      // 初始化交易器
      await this._initializeTraders();
    }

    // 首次同步持仓
    await this._syncHoldings();
  }

  async _syncHoldings() {
    const walletBalances = await this._walletService.getWalletBalances(
      this.walletAddress,
      this.blockchain || 'bsc'
    );

    // 同步到 PortfolioManager
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    portfolio.positions.clear();

    for (const token of walletBalances) {
      if (token.balance.gt(0)) {
        const normalizedAddr = BlockchainConfig.normalizeTokenAddress(
          token.address,
          this.blockchain
        );

        // 添加仓位到 PortfolioManager
        // CardPositionManager 会自动创建卡盘记录
        await this._portfolioManager.addPosition(
          normalizedAddr,
          token.balance,
          token.averagePurchasePrice || token.priceUSD || 0
        );
      }
    }

    console.log(`💰 实盘持仓同步完成: ${portfolio.positions.size} 种代币`);
    return walletBalances;
  }
}
```

## 四、交易执行实现

### 4.1 交易器集成

```javascript
// LiveTradingEngine.js

const FourMemeDirectTrader = require('../../traders/implementations/FourMemeDirectTrader');
const PancakeSwapV2Trader = require('../../traders/implementations/PancakeSwapV2Trader');

async _initializeTraders() {
  const networkConfig = BlockchainConfig.getNetworkConfig(this.blockchain);

  // 创建交易器
  this._fourMemeTrader = new FourMemeDirectTrader({ network: networkConfig });
  this._pancakeTrader = new PancakeSwapV2Trader({ network: networkConfig });

  // 设置钱包
  await this._fourMemeTrader.setWallet(this.privateKey);
  await this._pancakeTrader.setWallet(this.privateKey);
}
```

### 4.2 买入实现

```javascript
async _executeBuy(signal) {
  const tokenAddress = signal.tokenAddress;
  const amountBNB = signal.amount || this._calculateBuyAmount(signal);

  console.log(`🛒 实盘买入: ${signal.symbol} (${tokenAddress})`);
  console.log(`   金额: ${amountBNB} BNB`);

  try {
    // 检查代币是否在 FourMeme 平台
    const poolInfo = await this._fourMemeTrader.getPoolInfo(tokenAddress);

    let result;
    if (poolInfo.success && poolInfo.token.isSupported && !poolInfo.token.liquidityAdded) {
      // 使用 FourMeme 内盘交易
      console.log(`   使用: FourMeme Direct Trader`);
      result = await this._fourMemeTrader.buyToken(
        tokenAddress,
        ethers.parseEther(amountBNB.toString()),
        {
          slippageTolerance: 5, // 5%
          gasLimit: 300000,
          maxGasPrice: '10'
        }
      );
    } else {
      // 使用 PancakeSwap 外盘交易
      console.log(`   使用: PancakeSwap V2 Trader`);
      result = await this._pancakeTrader.buyToken(
        tokenAddress,
        amountBNB.toString(),
        {
          slippage: 0.05, // 5%
          gasLimit: 300000,
          deadline: 300
        }
      );
    }

    if (result.success) {
      console.log(`✅ 买入成功: ${result.transactionHash}`);
      console.log(`   获得: ${result.actualAmountOut || result.amountOut} tokens`);

      // 交易后立即同步持仓（确保 PortfolioManager 最新）
      await this._syncHoldings();

      // 记录交易到数据库
      await this._saveTradeToDatabase({
        direction: 'BUY',
        tokenAddress,
        symbol: signal.symbol,
        amountIn: amountBNB,
        amountOut: result.actualAmountOut || result.amountOut,
        price: result.price || 0,
        txHash: result.transactionHash,
        gasUsed: result.gasUsed,
        trader: poolInfo.token.isSupported ? 'FourMeme' : 'PancakeSwap'
      });
    } else {
      console.error(`❌ 买入失败: ${result.error}`);
    }

    return result;

  } catch (error) {
    console.error(`❌ 买入异常: ${error.message}`);
    return { success: false, error: error.message };
  }
}
```

### 4.3 卖出实现

```javascript
async _executeSell(signal) {
  const tokenAddress = signal.tokenAddress;
  const holding = this._portfolioManager.getPosition(tokenAddress);

  if (!holding || holding.amount.eq(0)) {
    console.warn(`⚠️ 无持仓可卖: ${signal.symbol}`);
    return { success: false, error: '无持仓' };
  }

  // 计算卖出数量 (支持部分卖出)
  const sellRatio = signal.ratio || 1;
  const sellAmount = holding.amount.mul(sellRatio);

  console.log(`💰 实盘卖出: ${signal.symbol} (${tokenAddress})`);
  console.log(`   持仓: ${holding.amount} tokens`);
  console.log(`   卖出: ${sellAmount} tokens (${sellRatio * 100}%)`);

  try {
    // 检查代币是否在 FourMeme 平台
    const poolInfo = await this._fourMemeTrader.getPoolInfo(tokenAddress);

    let result;
    if (poolInfo.success && poolInfo.token.isSupported) {
      // 使用 FourMeme 卖出
      console.log(`   使用: FourMeme Direct Trader`);
      result = await this._fourMemeTrader.sellToken(
        tokenAddress,
        ethers.parseUnits(sellAmount.toString(), 18),
        {
          slippageTolerance: 5,
          gasLimit: 300000
        }
      );
    } else {
      // 使用 PancakeSwap 卖出
      console.log(`   使用: PancakeSwap V2 Trader`);
      result = await this._pancakeTrader.sellToken(
        tokenAddress,
        sellAmount.toString(),
        {
          slippage: 0.05,
          gasLimit: 300000,
          deadline: 300
        }
      );
    }

    if (result.success) {
      console.log(`✅ 卖出成功: ${result.transactionHash}`);
      console.log(`   获得: ${result.actualReceived || result.amountOut} BNB`);

      // 交易后立即同步持仓
      await this._syncHoldings();

      // 记录交易到数据库
      await this._saveTradeToDatabase({
        direction: 'SELL',
        tokenAddress,
        symbol: signal.symbol,
        amountIn: sellAmount.toString(),
        amountOut: result.actualReceived || result.amountOut,
        price: result.price || 0,
        txHash: result.transactionHash,
        gasUsed: result.gasUsed,
        trader: poolInfo.token.isSupported ? 'FourMeme' : 'PancakeSwap'
      });
    } else {
      console.error(`❌ 卖出失败: ${result.error}`);
    }

    return result;

  } catch (error) {
    console.error(`❌ 卖出异常: ${error.message}`);
    return { success: false, error: error.message };
  }
}
```

## 五、实施阶段

### 阶段 1: 创建统一基类 (1-2 天)

**任务**:
1. 创建 `AbstractTradingEngine.js`
2. 提取 VirtualTradingEngine 公共逻辑到基类
3. 重构 VirtualTradingEngine 继承基类
4. 重构 BacktestEngine 继承基类

**验证**:
- 虚拟引擎功能正常运行
- 回测引擎功能正常运行

### 阶段 2: 钱包管理 (1 天)

**任务**:
1. 拷贝 `CryptoUtils.js`
2. 修改创建实验页面添加钱包配置
3. 实现私钥加密/解密流程

**验证**:
- 可以创建带钱包配置的实盘实验
- 私钥加密存储正确

### 阶段 3: WalletService 集成 (1 天)

**任务**:
1. 拷贝 `WalletService.js` 和 `AveWalletAPI.js`
2. 实现 `_syncHoldings()` 方法
3. 集成到每轮迭代流程

**验证**:
- 可以正确获取钱包真实持仓
- PortfolioManager 持仓与链上一致

### 阶段 4: 交易执行 (2-3 天)

**任务**:
1. 拷贝交易器模块
2. 实现 `_executeBuy()` 和 `_executeSell()`
3. 实现交易结果记录

**验证**:
- 小额测试交易成功
- 交易记录正确

### 阶段 5: 完整测试 (1-2 天)

## 六、文件变更清单

### 新增文件

```
richer-js/
├── src/
│   ├── trading-engine/
│   │   ├── core/
│   │   │   └── AbstractTradingEngine.js        (新建 - 统一基类)
│   │   └── implementations/
│   │       └── LiveTradingEngine.js            (重写)
│   ├── traders/                                 (新建目录)
│   │   ├── core/
│   │   │   └── BaseTrader.js                   (拷贝)
│   │   ├── interfaces/
│   │   │   └── ITrader.js                      (拷贝)
│   │   ├── implementations/
│   │   │   ├── FourMemeDirectTrader.js         (拷贝)
│   │   │   └── PancakeSwapV2Trader.js          (拷贝)
│   │   └── factory/
│   │       └── TraderFactory.js                (拷贝)
│   ├── utils/
│   │   ├── CryptoUtils.js                      (拷贝)
│   │   └── BlockchainConfig.js                 (确保存在)
│   └── services/
│       ├── WalletService.js                    (拷贝)
│       └── api/
│           └── ave/
│               └── wallet-api.js               (拷贝)
│   └── web/
│       ├── templates/
│       │   └── create_experiment.html          (修改)
│       └── static/js/
│           └── create_experiment.js            (修改或新建)
```

### 修改文件

```
richer-js/
├── src/
│   ├── trading-engine/
│   │   ├── implementations/
│   │   │   ├── VirtualTradingEngine.js         (重构继承基类)
│   │   │   └── BacktestEngine.js               (重构继承基类)
│   │   └── interfaces/
│   │       └── ITradingEngine.js               (可能需要调整)
│   └── web/
│       └── web-server.js                       (添加私钥加密)
```

## 七、依赖项

### 新增环境变量

```env
# 私钥加密密码 (必须设置)
ENCRYPTION_PASSWORD=your_secure_password_here

# AVE API Key (已有)
AVE_API_KEY=your_ave_api_key

# BSC RPC URL (已有)
BSC_RPC_URL=https://bsc-dataseed1.binance.org/
```

### npm 依赖

```json
{
  "dependencies": {
    "ethers": "^6.9.0",
    "decimal.js": "^10.4.0"
  }
}
```

## 八、关键差异总结

| 特性 | Virtual | Backtest | Live |
|------|---------|----------|------|
| _syncHoldings() | 返回现有虚拟持仓 | 从时序数据回放 | **AVE API 实时查询** |
| _executeBuy() | 模拟交易 | 回放历史 | **真实链上交易** |
| _executeSell() | 模拟交易 | 回放历史 | **真实链上交易** |
| _shouldRecordTimeSeries() | true | false | true |
| _runMainLoop() | 定时轮询 | 历史遍历 | 定时轮询 |
| PortfolioManager | ✅ 使用 | ✅ 使用 | ✅ 使用 |
| CardPositionManager | ✅ 使用 | ✅ 使用 | ✅ **使用** |
