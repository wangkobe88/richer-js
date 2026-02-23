#!/usr/bin/env node

/**
 * richer-js Web服务器
 * 用于 fourmeme 交易实验的Web监控界面
 */

require('dotenv').config({ path: '../config/.env' });
const express = require('express');
const cors = require('cors');
const path = require('path');

// 导入实验管理组件
const { ExperimentFactory } = require('./trading-engine/factories/ExperimentFactory');
const { ExperimentDataService } = require('./web/services/ExperimentDataService');
const { WalletDataService } = require('./web/services/WalletDataService');
const { TokenHolderDataService } = require('./web/services/TokenHolderDataService');
const PriceRefreshService = require('./web/services/price-refresh-service');
const { CryptoUtils } = require('./utils/CryptoUtils');

/**
 * Web服务器类
 */
class RicherJsWebServer {
  constructor() {
    this.app = express();
    this.port = process.env.WEB_PORT || 3000;
    this.setupMiddleware();
    this.initializeServices();
    this.setupRoutes();
  }

  /**
   * 设置中间件
   */
  setupMiddleware() {
    // CORS配置
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true
    }));

    // JSON解析
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // 静态文件服务（禁用缓存）
    this.app.use('/static', express.static(path.join(__dirname, 'web/static'), {
      maxAge: 0,
      etag: false,
      lastModified: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));
    this.app.use(express.static(path.join(__dirname, 'web/public')));

    // 请求日志
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * 初始化服务
   */
  initializeServices() {
    this.experimentFactory = ExperimentFactory.getInstance();
    this.dataService = new ExperimentDataService();
    this.walletService = new WalletDataService();
    this.tokenHolderService = new TokenHolderDataService();
    this.priceRefreshService = new PriceRefreshService(
      console,
      this.dataService.supabase,
      require('../config/default.json')
    );
    console.log('✅ Web服务初始化完成');
  }

  /**
   * 设置路由
   */
  setupRoutes() {
    // 主页 - 重定向到实验监控
    this.app.get('/', (req, res) => {
      res.redirect('/experiments');
    });

    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'richer-js'
      });
    });

    // API文档
    this.app.get('/api', (req, res) => {
      res.json({
        name: 'Richer-js Web API',
        description: 'Fourmeme 交易实验系统',
        endpoints: {
          experiments: {
            'GET /api/experiments': '获取实验列表',
            'GET /api/experiment/:id': '获取实验详情',
            'POST /api/experiments': '创建新实验',
            'PUT /api/experiment/:id': '更新实验信息',
            'PUT /api/experiment/:id/status': '更新实验状态',
            'DELETE /api/experiment/:id': '删除实验'
          },
          data: {
            'GET /api/experiment/:id/signals': '获取交易信号',
            'GET /api/experiment/:id/trades': '获取交易记录',
            'GET /api/experiment/:id/metrics': '获取运行时指标',
            'GET /api/experiment/:id/stats': '获取实验统计'
          },
          stats: {
            'GET /api/stats': '获取系统统计',
            'DELETE /api/experiments/clear-all': '清空所有数据'
          }
        }
      });
    });

    // ============ 页面路由 ============

    // 实验监控页面
    this.app.get('/experiments', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/experiments.html'));
    });

    // 创建实验页面
    this.app.get('/create-experiment', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/create_experiment.html'));
    });

    // 钱包管理页面
    this.app.get('/wallets', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/wallets.html'));
    });

    // 代币持有者页面
    this.app.get('/token-holders', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/token-holders.html'));
    });

    // 实验子页面（必须在 /experiment/:id 之前定义）
    // 信号页面
    this.app.get('/experiment/:id/signals', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/experiment_signals.html'));
    });

    // 交易页面
    this.app.get('/experiment/:id/trades', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/experiment_trades.html'));
    });

    // 代币观察页面
    this.app.get('/experiment/:id/tokens', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/experiment_tokens.html'));
    });

    // 时序数据观察页面
    this.app.get('/experiment/:id/observer', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/experiment_observer.html'));
    });

    // 代币收益汇总页面
    this.app.get('/experiment/:id/token-returns', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/experiment_token_returns.html'));
    });

    // 实验详情页面（必须放在最后，作为默认路由）
    this.app.get('/experiment/:id', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/experiment_detail.html'));
    });

    // ============ API路由：实验管理 ============

    // 获取可回测的实验列表（必须在 /api/experiments 之前定义，避免路由冲突）
    this.app.get('/api/experiments/backtestable', async (req, res) => {
      try {
        console.log('📊 [API] 获取可回测实验列表...');

        // 直接获取虚拟交易模式的实验列表
        const experiments = await this.experimentFactory.list({
          tradingMode: 'virtual',
          limit: 100
          // 不过滤状态，让用户可以选择
        });

        console.log(`📊 [API] 找到 ${experiments.length} 个虚拟交易实验`);

        // 过滤出有足够运行时间的实验
        const backtestableExperiments = experiments
          .filter(exp => {
            // 简单的过滤条件：实验有创建时间
            return exp.createdAt;
          })
          .map(exp => ({
            id: exp.id,
            experiment_name: exp.experimentName,
            trading_mode: exp.tradingMode,
            status: exp.status,
            blockchain: exp.blockchain,
            created_at: exp.createdAt
          }));

        console.log(`📊 [API] 返回 ${backtestableExperiments.length} 个可回测实验`);

        res.json({
          success: true,
          data: backtestableExperiments,
          count: backtestableExperiments.length
        });
      } catch (error) {
        console.error('❌ [API] 获取可回测实验列表失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取实验列表
    this.app.get('/api/experiments', async (req, res) => {
      try {
        const filters = {
          status: req.query.status,
          tradingMode: req.query.mode,
          blockchain: req.query.blockchain,
          limit: parseInt(req.query.limit) || 50,
          offset: parseInt(req.query.offset) || 0
        };

        const experiments = await this.experimentFactory.list(filters);
        res.json({
          success: true,
          data: experiments.map(exp => exp.toJSON()),
          count: experiments.length
        });
      } catch (error) {
        console.error('获取实验列表失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取实验详情
    this.app.get('/api/experiment/:id', async (req, res) => {
      try {
        const experiment = await this.experimentFactory.load(req.params.id);
        if (!experiment) {
          return res.status(404).json({ success: false, error: '实验不存在' });
        }
        res.json({
          success: true,
          data: experiment.toJSON()
        });
      } catch (error) {
        console.error('获取实验详情失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 创建实验
    this.app.post('/api/experiments', async (req, res) => {
      try {
        const {
          experiment_name,
          experiment_description,
          trading_mode,
          blockchain,
          kline_type,
          initial_balance,
          strategy,
          virtual,
          backtest,
          wallet,
          reserveNative
        } = req.body;

        // 构建实验配置
        const config = {
          name: experiment_name,
          description: experiment_description,
          blockchain: blockchain || 'bsc',
          kline_type: kline_type || '1m'
        };

        // 根据交易模式添加特定配置
        if (trading_mode === 'virtual') {
          config.virtual = {
            initialBalance: virtual?.initialBalance || parseFloat(initial_balance) || 100,
            tradeAmount: strategy?.tradeAmount !== undefined ? parseFloat(strategy.tradeAmount) : 0.1
          };
        } else if (trading_mode === 'backtest') {
          config.backtest = {
            initialBalance: backtest?.initialBalance || parseFloat(initial_balance) || 100,
            sourceExperimentId: backtest?.sourceExperimentId
          };
        } else if (trading_mode === 'live') {
          // 实盘交易配置 - 必须加密私钥
          if (!wallet || !wallet.privateKey) {
            return res.status(400).json({ success: false, error: '实盘交易需要提供钱包私钥' });
          }

          // 加密私钥
          const { CryptoUtils } = require('../src/utils/CryptoUtils');
          const cryptoUtils = new CryptoUtils();
          config.wallet = {
            address: wallet.address,
            privateKey: cryptoUtils.encrypt(wallet.privateKey) // 只加密私钥
          };
          config.reserveNative = reserveNative || 0.1; // 保留用于 GAS 的金额
          config.trading = {
            maxGasPrice: strategy?.trading?.maxGasPrice || 10,
            maxGasLimit: strategy?.trading?.maxGasLimit || 500000,
            maxSlippage: strategy?.trading?.maxSlippage || 5
          };
        } else {
          // 兼容旧格式
          config.virtual = {
            initialBalance: parseFloat(initial_balance) || 100,
            tradeAmount: strategy?.tradeAmount !== undefined ? parseFloat(strategy.tradeAmount) : 0.1
          };
        }

        // 如果提供了策略参数，添加到配置中
        if (strategy) {
          // 新的卡牌策略系统
          if (strategy.buyStrategies || strategy.sellStrategies) {
            config.strategiesConfig = {
              buyStrategies: strategy.buyStrategies || [],
              sellStrategies: strategy.sellStrategies || []
            };
          }

          // 卡牌管理配置
          if (strategy.positionManagement) {
            config.positionManagement = strategy.positionManagement;
          }

          // 兼容旧格式的简单策略参数（用于 fourmeme_earlyreturn）
          // 如果没有提供新格式的策略，使用默认值
          if (!strategy.buyStrategies && !strategy.sellStrategies) {
            config.strategy = {
              buyTimeMinutes: strategy.buyTimeMinutes !== undefined ? parseFloat(strategy.buyTimeMinutes) : 1.33,
              takeProfit1: strategy.takeProfit1 !== undefined ? parseInt(strategy.takeProfit1) : 30,
              takeProfit1Sell: strategy.takeProfit1Sell !== undefined ? parseFloat(strategy.takeProfit1Sell) : 0.5,
              takeProfit2: strategy.takeProfit2 !== undefined ? parseInt(strategy.takeProfit2) : 50,
              takeProfit2Sell: strategy.takeProfit2Sell !== undefined ? parseFloat(strategy.takeProfit2Sell) : 1.0,
              stopLossMinutes: strategy.stopLossMinutes !== undefined ? parseInt(strategy.stopLossMinutes) : 5
            };
          }
        }

        const experiment = await this.experimentFactory.createFromConfig(config, trading_mode);
        res.json({
          success: true,
          data: experiment.toJSON()
        });
      } catch (error) {
        console.error('创建实验失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 更新实验信息
    this.app.put('/api/experiment/:id', async (req, res) => {
      try {
        const { experiment_name, experiment_description } = req.body;
        const result = await this.experimentFactory.updateConfig(
          req.params.id,
          null, // config
          {
            experimentName: experiment_name,
            experimentDescription: experiment_description
          }
        );

        if (result.success) {
          res.json({ success: true });
        } else {
          res.status(500).json({ success: false, error: result.error });
        }
      } catch (error) {
        console.error('更新实验失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 更新实验状态
    this.app.put('/api/experiment/:id/status', async (req, res) => {
      try {
        const { status } = req.body;
        const success = await this.experimentFactory.updateStatus(req.params.id, status);

        if (success) {
          res.json({ success: true });
        } else {
          res.status(500).json({ success: false, error: '更新状态失败' });
        }
      } catch (error) {
        console.error('更新实验状态失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 删除实验
    this.app.delete('/api/experiment/:id', async (req, res) => {
      try {
        // 先清空实验数据
        await this.dataService.clearExperimentData(req.params.id);
        // 再删除实验
        const success = await this.experimentFactory.delete(req.params.id);

        if (success) {
          res.json({ success: true });
        } else {
          res.status(500).json({ success: false, error: '删除实验失败' });
        }
      } catch (error) {
        console.error('删除实验失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ============ API路由：钱包管理 ============

    // 获取钱包列表
    this.app.get('/api/wallets', async (req, res) => {
      try {
        const wallets = await this.walletService.getWallets();
        res.json({
          success: true,
          data: wallets
        });
      } catch (error) {
        console.error('获取钱包列表失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 创建钱包
    this.app.post('/api/wallets', async (req, res) => {
      try {
        console.log('创建钱包请求体:', req.body);
        const { address, name, category } = req.body;

        if (!address) {
          return res.status(400).json({ success: false, error: '钱包地址不能为空' });
        }

        const wallet = await this.walletService.createWallet({ address, name, category });
        res.json({
          success: true,
          data: wallet
        });
      } catch (error) {
        console.error('创建钱包失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 更新钱包
    this.app.put('/api/wallets/:id', async (req, res) => {
      try {
        const { name, category } = req.body;
        const wallet = await this.walletService.updateWallet(req.params.id, { name, category });
        res.json({
          success: true,
          data: wallet
        });
      } catch (error) {
        console.error('更新钱包失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 删除钱包
    this.app.delete('/api/wallets/:id', async (req, res) => {
      try {
        await this.walletService.deleteWallet(req.params.id);
        res.json({ success: true });
      } catch (error) {
        console.error('删除钱包失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 添加单个钱包到流水盘
    this.app.post('/api/wallets/add-single', async (req, res) => {
      try {
        const { address, name, category } = req.body;

        if (!address) {
          return res.status(400).json({ success: false, error: '钱包地址不能为空' });
        }

        // 检查钱包是否已存在
        const existing = await this.walletService.getWalletByAddress(address);
        if (existing) {
          return res.json({
            success: true,
            message: '钱包已存在于黑名单中',
            data: existing,
            alreadyExists: true
          });
        }

        // 创建钱包
        const wallet = await this.walletService.createWallet({
          address,
          name: name || '流水盘钱包',
          category: category || 'pump_group'
        });

        res.json({
          success: true,
          message: '钱包已添加到黑名单',
          data: wallet
        });
      } catch (error) {
        console.error('添加单个钱包失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 根据地址删除钱包
    this.app.delete('/api/wallets/address/:address', async (req, res) => {
      try {
        const { address } = req.params;

        if (!address) {
          return res.status(400).json({ success: false, error: '钱包地址不能为空' });
        }

        // 先检查钱包是否存在
        const existing = await this.walletService.getWalletByAddress(address);
        if (!existing) {
          return res.status(404).json({ success: false, error: '钱包不存在' });
        }

        await this.walletService.deleteWalletByAddress(address);
        res.json({
          success: true,
          message: '钱包已从黑名单中删除'
        });
      } catch (error) {
        console.error('删除钱包失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ============ API路由：代币持有者 ============

    // 获取代币持有者数据
    this.app.get('/api/token-holders/:tokenAddress', async (req, res) => {
      try {
        const { tokenAddress } = req.params;
        if (!tokenAddress) {
          return res.status(400).json({ success: false, error: '代币地址不能为空' });
        }
        const data = await this.tokenHolderService.getTokenHolders(tokenAddress);
        res.json({ success: true, data });
      } catch (error) {
        console.error('获取代币持有者失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取有持有者数据的代币列表
    this.app.get('/api/token-holders', async (req, res) => {
      try {
        const { experiment } = req.query;
        const tokens = await this.tokenHolderService.getTokenList(experiment || null);
        res.json({ success: true, data: tokens });
      } catch (error) {
        console.error('获取代币列表失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 批量添加流水盘钱包到黑名单
    this.app.post('/api/token-holders/add-pump-group', async (req, res) => {
      try {
        const { holders, snapshotDate } = req.body;

        if (!holders || !Array.isArray(holders)) {
          return res.status(400).json({ success: false, error: '持有者数据格式错误' });
        }

        // 排除 LP 地址
        const EXCLUDE_ADDRESSES = [
          '0x5c952063c7fc8610ffdb798152d69f0b9550762b', // fourmeme LP
          '0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0'  // slap.sh LP
        ].map(addr => addr.toLowerCase());

        // 筛选持仓比例大于0.05%的钱包
        const targetWallets = holders.filter(h => {
          if (EXCLUDE_ADDRESSES.includes(h.address?.toLowerCase())) {
            return false;
          }
          let ratio = 0;
          if (typeof h.balance_ratio === 'number') {
            ratio = h.balance_ratio;
          } else if (typeof h.balance_ratio === 'string') {
            const cleaned = h.balance_ratio.replace('%', '').trim();
            ratio = (parseFloat(cleaned) || 0) / 100;
          }
          return ratio > 0.0005; // 大于0.05%
        });

        if (targetWallets.length === 0) {
          return res.json({
            success: true,
            message: '没有符合条件的新钱包需要添加',
            data: { success: 0, skipped: 0, wallets: [] }
          });
        }

        // 生成钱包名称（使用日期）
        const dateStr = snapshotDate
          ? new Date(snapshotDate).toISOString().split('T')[0].replace(/-/g, '')
          : new Date().toISOString().split('T')[0].replace(/-/g, '');
        const walletName = `流水盘钱包群-${dateStr}`;

        // 批量创建钱包
        const walletsToCreate = targetWallets.map(h => ({
          address: h.address,
          name: walletName,
          category: 'pump_group'
        }));

        const result = await this.walletService.bulkCreateWallets(walletsToCreate);

        res.json({
          success: true,
          message: `成功添加 ${result.success} 个钱包，跳过 ${result.skipped} 个已存在的钱包`,
          data: {
            success: result.success,
            skipped: result.skipped,
            walletName: walletName,
            wallets: result.details
          }
        });
      } catch (error) {
        console.error('批量添加流水盘钱包失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取实验的持有者黑名单统计
    this.app.get('/api/experiment/:id/holder-blacklist-stats', async (req, res) => {
      try {
        const experimentId = req.params.id;

        // 获取黑名单钱包
        const { data: blacklistWallets } = await this.dataService.supabase
          .from('wallets')
          .select('address')
          .in('category', ['dev', 'pump_group', 'negative_holder']);

        const blacklistSet = new Set((blacklistWallets || []).map(w => w.address.toLowerCase()));

        // 获取该实验的所有持有者快照
        const pageSize = 1000;
        let offset = 0;
        let hasMore = true;
        const tokenBlacklistStats = new Map();

        while (hasMore) {
          const { data: snapshots } = await this.dataService.supabase
            .from('token_holders')
            .select('token_address, holder_data')
            .eq('experiment_id', experimentId)
            .range(offset, offset + pageSize - 1);

          if (snapshots && snapshots.length > 0) {
            for (const snapshot of snapshots) {
              const tokenAddr = snapshot.token_address;
              if (!tokenBlacklistStats.has(tokenAddr)) {
                tokenBlacklistStats.set(tokenAddr, {
                  hasBlacklist: false,
                  blacklistedHolders: 0
                });
              }
              const stats = tokenBlacklistStats.get(tokenAddr);

              if (snapshot.holder_data?.holders) {
                for (const holder of snapshot.holder_data.holders) {
                  const addr = holder.address?.toLowerCase();
                  if (addr && blacklistSet.has(addr)) {
                    stats.hasBlacklist = true;
                    stats.blacklistedHolders++;
                  }
                }
              }
            }
            offset += pageSize;
            hasMore = snapshots.length === pageSize;
          } else {
            hasMore = false;
          }
        }

        const tokensWithBlacklist = Array.from(tokenBlacklistStats.entries())
          .filter(([_, stats]) => stats.hasBlacklist)
          .map(([tokenAddr, stats]) => ({ token: tokenAddr, ...stats }));

        const totalTokens = tokenBlacklistStats.size;

        res.json({
          success: true,
          data: {
            totalTokens: totalTokens,
            blacklistedTokens: tokensWithBlacklist.length,
            blacklistedTokenList: tokensWithBlacklist,
            blacklistWalletCount: blacklistSet.size
          }
        });
      } catch (error) {
        console.error('获取黑名单统计失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ============ API路由：实验数据 ============

    // 获取交易信号
    this.app.get('/api/experiment/:id/signals', async (req, res) => {
      try {
        const options = {
          action: req.query.action,
          signalType: req.query.signalType,
          limit: parseInt(req.query.limit) || 100,
          offset: parseInt(req.query.offset) || 0
        };

        const data = await this.dataService.getFormattedSignals(req.params.id, options);
        res.json(data);
      } catch (error) {
        console.error('获取信号失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取交易记录
    this.app.get('/api/experiment/:id/trades', async (req, res) => {
      try {
        const options = {
          success: req.query.success,
          direction: req.query.direction,
          tradeType: req.query.tradeType,
          limit: parseInt(req.query.limit) || 100,
          offset: parseInt(req.query.offset) || 0
        };

        const data = await this.dataService.getFormattedTrades(req.params.id, options);
        res.json(data);
      } catch (error) {
        console.error('获取交易记录失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取运行时指标
    this.app.get('/api/experiment/:id/metrics', async (req, res) => {
      try {
        const options = {
          metricName: req.query.metricName,
          limit: parseInt(req.query.limit) || 100,
          offset: parseInt(req.query.offset) || 0
        };

        const metrics = await this.dataService.getRuntimeMetrics(req.params.id, options);
        res.json({
          success: true,
          data: metrics,
          count: metrics.length
        });
      } catch (error) {
        console.error('获取运行时指标失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取实验统计
    this.app.get('/api/experiment/:id/stats', async (req, res) => {
      try {
        const stats = await this.dataService.getExperimentStats(req.params.id);
        res.json({
          success: true,
          data: stats
        });
      } catch (error) {
        console.error('获取实验统计失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取投资组合数据
    this.app.get('/api/experiment/:id/portfolio', async (req, res) => {
      try {
        const options = {
          limit: parseInt(req.query.limit) || 1000
        };

        const result = await this.dataService.getPortfolioSnapshots(req.params.id, options);
        res.json(result);
      } catch (error) {
        console.error('获取投资组合数据失败:', error);
        res.status(500).json({ success: false, error: error.message, snapshots: [] });
      }
    });

    // ============ API路由：实验时序数据 ============
    // 注意：时序数据 API 必须在代币管理 API 之前定义，避免路由冲突

    // 获取有数据的实验列表
    this.app.get('/api/experiment/time-series/experiments', async (req, res) => {
      try {
        const { ExperimentTimeSeriesService } = require('./web/services/ExperimentTimeSeriesService');
        const timeSeriesService = new ExperimentTimeSeriesService();

        const experiments = await timeSeriesService.getExperimentsWithData();

        res.json({
          success: true,
          data: experiments.map(exp => ({
            experimentId: exp.experimentId,
            blockchain: exp.blockchain,
            dataPointCount: exp.dataPointCount,
            startTime: exp.dataPointCount > 0 ? null : new Date().toISOString()
          }))
        });
      } catch (error) {
        console.error('获取实验列表失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 获取实验的代币列表
    this.app.get('/api/experiment/time-series/tokens/:experimentId', async (req, res) => {
      try {
        const { experimentId } = req.params;
        const { ExperimentTimeSeriesService } = require('./web/services/ExperimentTimeSeriesService');
        const timeSeriesService = new ExperimentTimeSeriesService();

        const tokens = await timeSeriesService.getExperimentTokens(experimentId);

        res.json({
          success: true,
          data: tokens
        });
      } catch (error) {
        console.error('获取代币列表失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 获取时序数据
    this.app.get('/api/experiment/time-series/data', async (req, res) => {
      try {
        const { experimentId, tokenAddress, startTime, endTime, limit } = req.query;

        if (!experimentId) {
          return res.status(400).json({
            success: false,
            error: '缺少必需参数: experimentId'
          });
        }

        const { ExperimentTimeSeriesService } = require('./web/services/ExperimentTimeSeriesService');
        const timeSeriesService = new ExperimentTimeSeriesService();

        const options = {};
        if (startTime) {
          options.startTime = new Date(startTime);
        }
        if (endTime) {
          options.endTime = new Date(endTime);
        }
        if (limit) {
          options.limit = parseInt(limit);
        }

        const data = await timeSeriesService.getExperimentTimeSeries(
          experimentId,
          tokenAddress,
          options
        );

        res.json({
          success: true,
          data: data
        });
      } catch (error) {
        console.error('获取时序数据失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 获取可用的因子列表
    this.app.get('/api/experiment/time-series/factors', async (req, res) => {
      try {
        const { experimentId, tokenAddress } = req.query;

        if (!experimentId || !tokenAddress) {
          return res.status(400).json({
            success: false,
            error: '缺少必需参数: experimentId, tokenAddress'
          });
        }

        const { ExperimentTimeSeriesService } = require('./web/services/ExperimentTimeSeriesService');
        const timeSeriesService = new ExperimentTimeSeriesService();

        const factors = await timeSeriesService.getAvailableFactors(experimentId, tokenAddress);

        res.json({
          success: true,
          data: factors
        });
      } catch (error) {
        console.error('获取因子列表失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 获取特定因子的时序数据
    this.app.get('/api/experiment/time-series/factor-data', async (req, res) => {
      try {
        const { experimentId, tokenAddress, factorName } = req.query;

        if (!experimentId || !tokenAddress || !factorName) {
          return res.status(400).json({
            success: false,
            error: '缺少必需参数: experimentId, tokenAddress, factorName'
          });
        }

        const { ExperimentTimeSeriesService } = require('./web/services/ExperimentTimeSeriesService');
        const timeSeriesService = new ExperimentTimeSeriesService();

        const data = await timeSeriesService.getFactorTimeSeries(
          experimentId,
          tokenAddress,
          factorName
        );

        res.json({
          success: true,
          data: data
        });
      } catch (error) {
        console.error('获取因子时序数据失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 分页获取时序数据（用于详细数据表格）
    this.app.get('/api/experiment/time-series/data/paginated', async (req, res) => {
      try {
        const { experimentId, tokenAddress, page = '1', pageSize = '50' } = req.query;

        if (!experimentId || !tokenAddress) {
          return res.status(400).json({
            success: false,
            error: '缺少必需参数: experimentId, tokenAddress'
          });
        }

        const { ExperimentTimeSeriesService } = require('./web/services/ExperimentTimeSeriesService');
        const timeSeriesService = new ExperimentTimeSeriesService();

        const result = await timeSeriesService.getPaginatedTimeSeries(
          experimentId,
          tokenAddress,
          {
            page: parseInt(page),
            pageSize: parseInt(pageSize)
          }
        );

        res.json({
          success: true,
          data: result
        });
      } catch (error) {
        console.error('分页查询失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // ============ API路由：代币管理 ============

    // 获取实验代币列表（包含信号标记）
    // 从 experiment_tokens 表获取所有代币，同时关联 strategy_signals 表标记哪些代币有交易信号
    this.app.get('/api/experiment/:id/tokens-with-signals', async (req, res) => {
      try {
        const result = await this.dataService.getTokensWithSignals(req.params.id);
        res.json(result);
      } catch (error) {
        console.error('获取代币列表（含信号）失败:', error);
        res.status(500).json({ success: false, error: error.message, data: [] });
      }
    });

    // 获取实验代币列表
    this.app.get('/api/experiment/:id/tokens', async (req, res) => {
      try {
        const options = {
          status: req.query.status,
          limit: parseInt(req.query.limit) || 100,
          offset: parseInt(req.query.offset) || 0
        };

        const result = await this.dataService.getFormattedTokens(req.params.id, options);
        res.json(result);
      } catch (error) {
        console.error('获取代币列表失败:', error);
        res.status(500).json({ success: false, error: error.message, tokens: [] });
      }
    });

    // 分析实验代币涨幅
    this.app.post('/api/experiment/:id/analyze-tokens', async (req, res) => {
      try {
        const { TokenAnalysisService } = require('./web/services/TokenAnalysisService');
        const analysisService = new TokenAnalysisService();

        console.log(`[代币分析] 开始分析实验 ${req.params.id} 的代币涨幅...`);

        let progress = 0;
        const totalTokens = await analysisService.getAllTokens(req.params.id);
        const total = totalTokens.length;

        const result = await analysisService.analyzeExperimentTokens(req.params.id, (current, total) => {
          progress = current;
          const percent = ((current / total) * 100).toFixed(1);
          console.log(`[代币分析] 进度: ${current}/${total} (${percent}%)`);
        });

        console.log(`[代币分析] 分析完成: ${result.analyzed} 成功, ${result.failed} 失败`);

        res.json({
          success: true,
          ...result
        });
      } catch (error) {
        console.error('分析代币涨幅失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取实验代币统计
    this.app.get('/api/experiment/:id/tokens/stats', async (req, res) => {
      try {
        const stats = await this.dataService.getTokenStats(req.params.id);
        res.json({
          success: true,
          data: stats
        });
      } catch (error) {
        console.error('获取代币统计失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 刷新实验代币的实时价格
    this.app.post('/api/experiment/:id/tokens/refresh-prices', async (req, res) => {
      try {
        const result = await this.priceRefreshService.refreshTokenPrices(req.params.id);

        if (result.success) {
          res.json({
            success: true,
            updated: result.updated,
            failed: result.failed,
            duration: result.duration,
            message: result.message
          });
        } else {
          res.status(500).json({
            success: false,
            error: result.error || '价格刷新失败'
          });
        }
      } catch (error) {
        console.error('刷新价格失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取单个代币详情
    this.app.get('/api/experiment/:id/tokens/:address', async (req, res) => {
      try {
        const token = await this.dataService.getToken(req.params.id, req.params.address);
        if (!token) {
          return res.status(404).json({ success: false, error: '代币不存在' });
        }
        res.json({
          success: true,
          data: token
        });
      } catch (error) {
        console.error('获取代币详情失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 更新代币状态
    this.app.put('/api/experiment/:id/tokens/:address', async (req, res) => {
      try {
        const { status } = req.body;
        if (!status || !['monitoring', 'bought', 'exited'].includes(status)) {
          return res.status(400).json({ success: false, error: '无效的状态' });
        }

        const success = await this.dataService.updateTokenStatus(req.params.id, req.params.address, status);
        if (success) {
          res.json({ success: true });
        } else {
          res.status(500).json({ success: false, error: '更新失败' });
        }
      } catch (error) {
        console.error('更新代币状态失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ============ API路由：统计信息 ============

    // 获取系统统计
    this.app.get('/api/stats', async (req, res) => {
      try {
        const stats = await this.experimentFactory.getStats();
        res.json({
          success: true,
          data: stats
        });
      } catch (error) {
        console.error('获取系统统计失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 清空所有实验数据
    this.app.delete('/api/experiments/clear-all', async (req, res) => {
      try {
        const experiments = await this.experimentFactory.list({ limit: 1000 });
        let cleared = 0;

        for (const exp of experiments) {
          await this.dataService.clearExperimentData(exp.id);
          await this.experimentFactory.delete(exp.id);
          cleared++;
        }

        res.json({
          success: true,
          message: `已清空 ${cleared} 个实验`
        });
      } catch (error) {
        console.error('清空数据失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ============ API路由：K线数据 ============

    // 获取K线数据（用于信号/交易页面图表显示）
    this.app.get('/api/experiment/:id/kline', async (req, res) => {
      try {
        const { tokenId, source = 'signals' } = req.query;

        // 加载实验信息
        const experiment = await this.experimentFactory.load(req.params.id);
        if (!experiment) {
          return res.status(404).json({ success: false, error: '实验不存在' });
        }

        // 确定要查询的代币地址
        let targetTokenAddress = null;
        let targetTokenSymbol = null;

        if (tokenId) {
          // 使用指定的代币
          targetTokenAddress = tokenId;
          // 从代币表获取符号
          const tokenData = await this.dataService.getToken(req.params.id, tokenId);
          targetTokenSymbol = tokenData?.token_symbol || 'Unknown';
        } else {
          // 获取实验的第一个代币（优先选择已买入的）
          const tokens = await this.dataService.getTokens(req.params.id, {
            sortBy: 'discovered_at',
            sortOrder: 'asc',
            limit: 1
          });

          if (!tokens || tokens.length === 0) {
            return res.json({
              success: true,
              kline_data: [],
              signals: [],
              trades_on_chart: [],
              interval_minutes: 1,
              token: { symbol: 'N/A', address: null },
              time_range: { start_date: '-', end_date: '-' }
            });
          }

          targetTokenAddress = tokens[0].token_address;
          targetTokenSymbol = tokens[0].token_symbol;
        }

        // 构建 tokenId 格式：{address}-{chain}
        const blockchain = experiment.blockchain || 'bsc';
        const aveTokenId = `${targetTokenAddress}-${blockchain}`;

        // 导入 AveKlineAPI
        const { AveKlineAPI } = require('./core/ave-api/kline-api');
        const config = require('../config/default.json');
        const apiKey = process.env.AVE_API_KEY;
        const aveApi = new AveKlineAPI(
          config.ave?.apiUrl || 'https://prod.ave-api.com',
          config.ave?.timeout || 30000,
          apiKey
        );

        // 获取1分钟K线数据（获取足够多的数据以覆盖实验时间段）
        const klineResult = await aveApi.getKlineDataByToken(aveTokenId, 1, 1000);

        // 格式化K线数据
        const formattedKlineData = AveKlineAPI.formatKlinePoints(klineResult.points);

        // 确定实验时间范围
        const experimentStartTime = new Date(experiment.startedAt || experiment.createdAt).getTime();
        const experimentEndTime = experiment.stoppedAt
          ? new Date(experiment.stoppedAt).getTime()
          : Date.now();

        // 转换为前端期望的格式，并过滤到实验时间范围内
        const klineData = formattedKlineData
          .filter(k => {
            // k.timestamp 是毫秒，检查是否在实验时间范围内
            const klineTime = k.timestamp;
            return klineTime >= experimentStartTime && klineTime <= experimentEndTime;
          })
          .map(k => ({
            timestamp: Math.floor(k.timestamp / 1000), // 转换为秒
            open_price: k.open.toString(),
            high_price: k.high.toString(),
            low_price: k.low.toString(),
            close_price: k.close.toString(),
            volume: k.volume.toString()
          }))
          .sort((a, b) => a.timestamp - b.timestamp); // 按时间正序排列

        // 获取信号数据（用于图表标记）
        let signalsForChart = [];
        if (source === 'signals') {
          const signals = await this.dataService.getSignals(req.params.id, { limit: 100 });
          signalsForChart = signals.map(s => s.toJSON());
        }

        // 计算时间范围（使用实验的实际时间范围）
        const timeRange = {
          start_date: new Date(experimentStartTime).toISOString().split('T')[0],
          end_date: new Date(experimentEndTime).toISOString().split('T')[0],
          start_timestamp: Math.floor(experimentStartTime / 1000),
          end_timestamp: Math.floor(experimentEndTime / 1000)
        };

        // 如果没有K线数据，时间范围仍然显示实验的时间范围
        if (klineData.length > 0) {
          timeRange.data_start_date = new Date(klineData[0].timestamp * 1000).toISOString().split('T')[0];
          timeRange.data_end_date = new Date(klineData[klineData.length - 1].timestamp * 1000).toISOString().split('T')[0];
        }

        res.json({
          success: true,
          kline_data: klineData,
          signals: signalsForChart,
          trades_on_chart: [], // fourmeme暂不使用交易标记
          interval_minutes: 1,
          token: {
            symbol: targetTokenSymbol,
            address: targetTokenAddress,
            blockchain: blockchain
          },
          time_range: timeRange
        });

      } catch (error) {
        console.error('获取K线数据失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 404处理
    this.app.use((req, res) => {
      res.status(404).json({ success: false, error: 'Not found' });
    });

    // 错误处理
    this.app.use((err, req, res, next) => {
      console.error('服务器错误:', err);
      res.status(500).json({ success: false, error: err.message });
    });
  }

  /**
   * 启动服务器
   */
  start() {
    this.app.listen(this.port, () => {
      console.log('');
      console.log('========================================');
      console.log('🚀 Richer-js Web服务器已启动');
      console.log('========================================');
      console.log(`📊 监控面板: http://localhost:${this.port}/experiments`);
      console.log(`🔧 API文档: http://localhost:${this.port}/api`);
      console.log(`💚 健康检查: http://localhost:${this.port}/health`);
      console.log('========================================');
      console.log('');
    });
  }
}

// 启动服务器
if (require.main === module) {
  const server = new RicherJsWebServer();
  server.start();

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n👋 收到关闭信号，正在关闭服务器...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n👋 收到关闭信号，正在关闭服务器...');
    process.exit(0);
  });
}

module.exports = RicherJsWebServer;
