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
const { WalletAnalysisDataService } = require('./web/services/WalletAnalysisDataService');
const { BayesModelService } = require('./services/BayesModelService');
const { TwitterService } = require('./services/TwitterService');
const PriceRefreshService = require('./web/services/price-refresh-service');
const { CryptoUtils } = require('./utils/CryptoUtils');
const narrativeRoutes = require('./web/routes/narrative.routes');

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
    this.walletAnalysisService = new WalletAnalysisDataService();
    this.bayesModelService = new BayesModelService();
    this.twitterService = new TwitterService(console);
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

    // 钱包分析页面
    this.app.get('/wallet-analysis', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/wallet_analysis.html'));
    });

    // AVE钱包API查询页面
    this.app.get('/wallet-ave-query', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/wallet_ave_query.html'));
    });

    // 代币持有者页面
    this.app.get('/token-holders', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/token-holders.html'));
    });

    // 平台标签代币页面
    this.app.get('/platform-tokens', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/platform_tokens.html'));
    });

    // 实验子页面（必须在 /experiment/:id 之前定义）
    // 信号统计页面（新增）
    this.app.get('/experiment/:id/signal-stats', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/experiment_signal_stats.html'));
    });

    // 信号页面（详情页，支持 ?token=xxx 参数）
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

    // 实验叙事分析页面
    this.app.get('/experiment/:id/narrative', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/experiment_narrative.html'));
    });

    // 交易策略分析页面
    this.app.get('/experiment/:id/strategy-analysis', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/strategy_analysis.html'));
    });

    // 代币详情页面（独立页面，不在实验子路由下）
    this.app.get('/token-detail', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/token_detail.html'));
    });

    // 叙事分析页面（独立页面，不在实验子路由下）
    this.app.get('/narrative-analyzer', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/narrative-analyzer.html'));
    });

    // 叙事分析任务管理页面
    this.app.get('/narrative-tasks', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/narrative_tasks.html'));
    });

    // 事件监控页面
    this.app.get('/monitor', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/monitor.html'));
    });

    // 信号早期交易数据页面
    this.app.get('/signal/:id/early-trades', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/signal_early_trades.html'));
    });

    // 实验详情页面（必须放在最后，作为默认路由）
    this.app.get('/experiment/:id', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/experiment_detail.html'));
    });

    // ============ API路由：叙事分析 ============
    this.app.use('/api/narrative', narrativeRoutes);

    // ============ API路由：事件监控 ============

    // 获取 Supabase 前端配置（用于 Realtime 订阅）
    this.app.get('/api/supabase-config', (req, res) => {
      res.json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY
      });
    });

    // 获取事件列表
    this.app.get('/api/events', async (req, res) => {
      try {
        const { experiment_id, action, limit = 50, offset = 0 } = req.query;

        let query = this.dataService.supabase
          .from('experiment_events')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false });

        if (experiment_id) {
          query = query.eq('experiment_id', experiment_id);
        }
        if (action) {
          query = query.eq('action', action);
        }

        query = query.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        const { data, error, count } = await query;

        if (error) throw error;

        res.json({
          success: true,
          data: data || [],
          pagination: {
            total: count || 0,
            limit: parseInt(limit),
            offset: parseInt(offset)
          }
        });
      } catch (error) {
        console.error('获取事件列表失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 清空指定时间段外的事件
    this.app.delete('/api/events/purge', async (req, res) => {
      try {
        const { keepHours } = req.body;
        if (!keepHours || keepHours <= 0) {
          return res.status(400).json({ success: false, error: '请提供有效的保留小时数' });
        }

        const cutoff = new Date(Date.now() - keepHours * 3600000).toISOString();
        const { count, error } = await this.dataService.supabase
          .from('experiment_events')
          .delete()
          .lt('created_at', cutoff)
          .select('id');

        if (error) throw error;

        res.json({
          success: true,
          deleted: count || 0,
          cutoff
        });
      } catch (error) {
        console.error('清空事件失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
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

    // ============ API路由：策略分析 ============
    // 注意：这些路由必须在 /api/experiment/:id 之前定义，避免路由冲突

    // 获取实验的策略列表
    this.app.get('/api/experiment/strategies', async (req, res) => {
      try {
        const { experimentId } = req.query;

        if (!experimentId) {
          return res.status(400).json({
            success: false,
            error: '缺少必需参数: experimentId'
          });
        }

        const { StrategyAnalysisService } = require('./web/services/StrategyAnalysisService');
        const analysisService = new StrategyAnalysisService();

        const result = await analysisService.getStrategies(experimentId);
        res.json(result);

      } catch (error) {
        console.error('获取策略列表失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 分析策略在代币时序数据上的匹配情况
    this.app.get('/api/experiment/strategy-analysis', async (req, res) => {
      try {
        const { experimentId, tokenAddress, strategyType = 'buy', strategyIndex = '0' } = req.query;

        if (!experimentId || !tokenAddress) {
          return res.status(400).json({
            success: false,
            error: '缺少必需参数: experimentId, tokenAddress'
          });
        }

        const { StrategyAnalysisService } = require('./web/services/StrategyAnalysisService');
        const analysisService = new StrategyAnalysisService();

        const result = await analysisService.analyzeStrategy(
          experimentId,
          tokenAddress,
          strategyType,
          parseInt(strategyIndex)
        );

        res.json(result);

      } catch (error) {
        console.error('策略分析失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
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

          // 叙事分析配置
          if (strategy.narrativeAnalysis) {
            config.strategiesConfig = config.strategiesConfig || {};
            config.strategiesConfig.narrativeAnalysis = strategy.narrativeAnalysis;
          }

          // 统计配置
          if (strategy.stats) {
            config.strategiesConfig = config.strategiesConfig || {};
            config.strategiesConfig.stats = strategy.stats;
          }

          // 电报通知配置
          if (strategy.telegramNotifications) {
            config.strategiesConfig = config.strategiesConfig || {};
            config.strategiesConfig.telegramNotifications = strategy.telegramNotifications;
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

    // 更新实验名字
    this.app.put('/api/experiment/:id/name', async (req, res) => {
      try {
        const { experimentName } = req.body;

        if (!experimentName || typeof experimentName !== 'string') {
          return res.status(400).json({ success: false, error: '无效的实验名字' });
        }

        if (experimentName.trim().length === 0) {
          return res.status(400).json({ success: false, error: '实验名字不能为空' });
        }

        if (experimentName.length > 100) {
          return res.status(400).json({ success: false, error: '实验名字不能超过100个字符' });
        }

        // 直接更新 experiment_name 字段，不改变 config
        const { error } = await this.experimentFactory.supabase
          .from('experiments')
          .update({ experiment_name: experimentName.trim() })
          .eq('id', req.params.id);

        if (error) {
          throw error;
        }

        res.json({ success: true });
      } catch (error) {
        console.error('更新实验名字失败:', error);
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

    // 压缩实验时序数据（删除低涨幅代币的数据）
    this.app.post('/api/experiment/:id/compress-time-series', async (req, res) => {
      try {
        const { id: experimentId } = req.params;
        const { threshold = 50 } = req.body;

        // 验证阈值
        const validThreshold = parseFloat(threshold);
        if (isNaN(validThreshold) || validThreshold < 0 || validThreshold > 100) {
          return res.status(400).json({
            success: false,
            error: '阈值必须是 0-100 之间的数字'
          });
        }

        const { ExperimentTimeSeriesService } = require('./web/services/ExperimentTimeSeriesService');
        const timeSeriesService = new ExperimentTimeSeriesService();

        const result = await timeSeriesService.compressTimeSeriesData(experimentId, validThreshold);

        if (result.success) {
          res.json(result);
        } else {
          res.status(500).json(result);
        }
      } catch (error) {
        console.error('压缩时序数据失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 清理无价格数据的代币
    this.app.post('/api/experiment/:id/cleanup-tokens', async (req, res) => {
      try {
        const { id: experimentId } = req.params;

        const { ExperimentTimeSeriesService } = require('./web/services/ExperimentTimeSeriesService');
        const timeSeriesService = new ExperimentTimeSeriesService();

        const result = await timeSeriesService.cleanupTokens(experimentId);

        if (result.success) {
          res.json(result);
        } else {
          res.status(500).json(result);
        }
      } catch (error) {
        console.error('清理代币失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 批量补充代币的叙事表征语料ID
    this.app.post('/api/experiment/:id/backfill-material-id', async (req, res) => {
      try {
        const { id: experimentId } = req.params;
        console.log(`[MaterialID补全] 开始为实验 ${experimentId} 补全 narrative_material_id...`);

        const result = await this.dataService.backfillNarrativeMaterialId(experimentId);

        if (result.success) {
          res.json(result);
        } else {
          res.status(500).json(result);
        }
      } catch (error) {
        console.error('[MaterialID补全] 失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 分析所有实验的统计数据
    this.app.post('/api/experiments/analyze-all', async (req, res) => {
      try {
        const { ExperimentStatsService } = require('./web/services/ExperimentStatsService');
        const statsService = new ExperimentStatsService();

        // 获取所有实验
        const filters = {
          limit: 1000,
          offset: 0
        };
        const experiments = await this.experimentFactory.list(filters);

        console.log(`📊 开始分析 ${experiments.length} 个实验的统计数据...`);

        const results = {
          total: experiments.length,
          processed: 0,
          failed: 0,
          skipped: 0,
          details: []
        };

        for (const experiment of experiments) {
          try {
            const expData = experiment.toJSON();

            // 如果已经有统计数据，跳过
            if (expData.stats && Object.keys(expData.stats).length > 0) {
              results.skipped++;
              results.details.push({
                id: experiment.id,
                name: expData.experimentName,
                status: 'skipped',
                reason: '已有统计数据'
              });
              continue;
            }

            // 只分析已停止或已完成的实验
            if (expData.status !== 'stopped' && expData.status !== 'completed') {
              results.skipped++;
              results.details.push({
                id: experiment.id,
                name: expData.experimentName,
                status: 'skipped',
                reason: '实验未完成'
              });
              continue;
            }

            // 计算统计数据
            const stats = await statsService.calculateExperimentStats(experiment.id);

            // 保存到数据库
            const { error } = await this.dataService.supabase
              .from('experiments')
              .update({ stats })
              .eq('id', experiment.id);

            if (error) {
              throw new Error(`保存统计数据失败: ${error.message}`);
            }

            results.processed++;
            results.details.push({
              id: experiment.id,
              name: expData.experimentName,
              status: 'success',
              stats
            });

            console.log(`✅ 已分析实验: ${expData.experimentName}`);

          } catch (error) {
            results.failed++;
            results.details.push({
              id: experiment.id,
              name: experiment.experimentName || '未知',
              status: 'failed',
              error: error.message
            });
            console.error(`❌ 分析实验失败 ${experiment.id}:`, error.message);
          }
        }

        console.log(`📊 分析完成: 成功 ${results.processed}, 失败 ${results.failed}, 跳过 ${results.skipped}`);

        res.json({
          success: true,
          data: results
        });
      } catch (error) {
        console.error('分析实验统计数据失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 更新单个实验的统计数据
    this.app.put('/api/experiment/:id/stats', async (req, res) => {
      try {
        const { ExperimentStatsService } = require('./web/services/ExperimentStatsService');
        const statsService = new ExperimentStatsService();

        const stats = await statsService.calculateExperimentStats(req.params.id);

        // 保存到数据库
        const { error } = await this.dataService.supabase
          .from('experiments')
          .update({ stats })
          .eq('id', req.params.id);

        if (error) {
          throw new Error(`保存统计数据失败: ${error.message}`);
        }

        res.json({
          success: true,
          data: stats
        });
      } catch (error) {
        console.error('更新实验统计数据失败:', error);
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

    // 批量根据地址删除钱包
    this.app.post('/api/wallets/batch-delete', async (req, res) => {
      try {
        const { addresses } = req.body;

        if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
          return res.status(400).json({ success: false, error: '钱包地址列表不能为空' });
        }

        console.log(`🗑️ 批量删除钱包请求: ${addresses.length} 个`);
        const results = await this.walletService.deleteWalletsByAddresses(addresses);
        console.log('✅ 批量删除结果:', results);
        res.json({
          success: true,
          message: `已删除 ${results.deleted} 个钱包${results.notFound > 0 ? `，${results.notFound} 个未找到` : ''}`,
          data: results
        });
      } catch (error) {
        console.error('批量删除钱包失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 根据地址删除钱包（必须在 /api/wallets/:id 之前定义）
    this.app.delete('/api/wallets/address/:address', async (req, res) => {
      try {
        const { address } = req.params;

        console.log('🗑️ 删除钱包请求:', address);

        if (!address) {
          return res.status(400).json({ success: false, error: '钱包地址不能为空' });
        }

        // 先检查钱包是否存在
        const existing = await this.walletService.getWalletByAddress(address);
        console.log('🔍 查找结果:', existing);
        if (!existing) {
          return res.status(404).json({ success: false, error: '钱包不存在' });
        }

        const deleted = await this.walletService.deleteWalletByAddress(address);
        console.log('✅ 删除结果:', deleted);
        res.json({
          success: true,
          message: '钱包已从黑名单中删除'
        });
      } catch (error) {
        console.error('❌ 删除钱包失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 删除钱包（按ID）
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
            message: '钱包已存在',
            data: existing,
            alreadyExists: true
          });
        }

        // 创建钱包
        const result = await this.walletService.createWallet({
          address,
          name: name || '流水盘钱包',
          category: category || 'pump_group'
        });

        if (result.alreadyExists) {
          return res.json({
            success: true,
            message: '钱包已存在',
            data: result.data,
            alreadyExists: true
          });
        }

        if (!result.success) {
          return res.status(500).json({ success: false, error: result.error || '创建钱包失败' });
        }

        res.json({
          success: true,
          message: '钱包已添加',
          data: result.data
        });
      } catch (error) {
        console.error('添加单个钱包失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ============ API路由：钱包分析 ============

    // 获取标注代币总数
    this.app.get('/api/wallet-analysis/token-count', async (req, res) => {
      try {
        const tokens = await this.walletAnalysisService.getAnnotatedTokens(null);
        res.json({ success: true, data: { count: tokens.length } });
      } catch (error) {
        console.error('获取标注代币数量失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取可用实验列表
    this.app.get('/api/wallet-analysis/experiments', async (req, res) => {
      try {
        const experiments = await this.walletAnalysisService.getAvailableExperiments();
        res.json({ success: true, data: experiments });
      } catch (error) {
        console.error('获取实验列表失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 生成钱包画像（使用所有实验的标注代币）
    this.app.post('/api/wallet-analysis/generate-profiles', async (req, res) => {
      try {
        const taskId = Date.now().toString();

        // 异步执行分析，传入 taskId
        this.walletAnalysisService.generateProfiles(taskId, (progress) => {
          console.log(`[钱包分析] ${taskId}: ${progress.progress}% - ${progress.message}`);
        }).then(result => {
          console.log(`[钱包分析] ${taskId} 完成:`, result.stats);
        }).catch(error => {
          console.error(`[钱包分析] ${taskId} 失败:`, error);
        });

        res.json({ success: true, taskId });
      } catch (error) {
        console.error('生成钱包画像失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取生成任务状态
    this.app.get('/api/wallet-analysis/generate-profiles/:taskId/status', async (req, res) => {
      try {
        const taskId = req.params.taskId;
        const taskStatus = this.walletAnalysisService.getTaskStatus(taskId);

        if (taskStatus.status === 'not_found') {
          // 任务不存在，可能是已完成的旧任务
          const stats = await this.walletAnalysisService.getStats();
          res.json({
            success: true,
            data: {
              status: 'completed',
              progress: 100,
              message: '完成',
              stats: {
                totalWallets: stats.totalProfiles
              }
            }
          });
        } else {
          // 返回实际任务状态
          res.json({
            success: true,
            data: taskStatus
          });
        }
      } catch (error) {
        console.error('获取任务状态失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 生成钱包标签
    this.app.post('/api/wallet-analysis/generate-labels', async (req, res) => {
      try {
        const { algorithmConfig } = req.body;
        const result = await this.walletAnalysisService.generateLabels(algorithmConfig);
        res.json({ success: true, data: result });
      } catch (error) {
        console.error('生成标签失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 同步到 wallets 表
    this.app.post('/api/wallet-analysis/sync-to-wallets', async (req, res) => {
      try {
        const { mode = 'upsert' } = req.body;
        const result = await this.walletAnalysisService.syncToWallets(mode);
        res.json({ success: true, data: result });
      } catch (error) {
        console.error('同步失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取钱包画像列表
    this.app.get('/api/wallet-analysis/profiles', async (req, res) => {
      try {
        const filters = {
          label: req.query.label,
          dominant_category: req.query.dominant_category,
          search: req.query.search,
          page: parseInt(req.query.page) || 1,
          limit: parseInt(req.query.limit) || 50
        };
        const result = await this.walletAnalysisService.getProfiles(filters);
        res.json({ success: true, data: result });
      } catch (error) {
        console.error('获取钱包画像失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取钱包画像详情
    this.app.get('/api/wallet-analysis/profiles/:address', async (req, res) => {
      try {
        const blockchain = req.query.blockchain || 'bsc';
        const profile = await this.walletAnalysisService.getProfile(req.params.address, blockchain);
        if (!profile) {
          return res.status(404).json({ success: false, error: '钱包画像不存在' });
        }
        res.json({ success: true, data: profile });
      } catch (error) {
        console.error('获取钱包画像详情失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取统计概览
    this.app.get('/api/wallet-analysis/stats', async (req, res) => {
      try {
        const stats = await this.walletAnalysisService.getStats();
        res.json({ success: true, data: stats });
      } catch (error) {
        console.error('获取统计失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ============ API路由：贝叶斯模型 ============

    // 训练模型
    this.app.post('/api/bayes/train', async (req, res) => {
      try {
        const taskId = Date.now().toString();

        // 异步执行训练
        this.bayesModelService.trainModel((progress) => {
          console.log(`[贝叶斯训练] ${progress.progress}% - ${progress.message}`);
        }).then(result => {
          console.log(`[贝叶斯训练] 完成:`, result.stats);
        }).catch(error => {
          console.error(`[贝叶斯训练] 失败:`, error);
        });

        res.json({ success: true, taskId });
      } catch (error) {
        console.error('训练贝叶斯模型失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 预测代币性质
    this.app.post('/api/bayes/predict', async (req, res) => {
      try {
        const { tokenAddress, chain = 'bsc' } = req.body;

        if (!tokenAddress) {
          return res.status(400).json({ success: false, error: '代币地址不能为空' });
        }

        const result = await this.bayesModelService.predictToken(tokenAddress, chain);
        res.json({ success: true, data: result });
      } catch (error) {
        console.error('贝叶斯预测失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取模型信息
    this.app.get('/api/bayes/model', async (req, res) => {
      try {
        const info = await this.bayesModelService.getModelInfo();
        res.json({ success: true, data: info });
      } catch (error) {
        console.error('获取贝叶斯模型信息失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 评估训练集准确率
    this.app.get('/api/bayes/evaluate', async (req, res) => {
      try {
        const evaluation = await this.bayesModelService.evaluateTrainingSet();
        res.json({ success: true, data: evaluation });
      } catch (error) {
        console.error('评估训练集失败:', error);
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

        // 筛选有效钱包
        const targetWallets = holders.filter(h => {
          // 排除 LP 地址
          if (EXCLUDE_ADDRESSES.includes(h.address?.toLowerCase())) {
            return false;
          }

          // 如果没有 balance_ratio 字段（来自早期交易页面），不过滤持仓比例
          if (h.balance_ratio === undefined || h.balance_ratio === null) {
            return h.address && h.address.length > 0;
          }

          // 有 balance_ratio 字段时，筛选持仓比例大于0.05%的钱包
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
            skippedWallets: result.skippedWallets || [],
            walletName: walletName,
            wallets: result.details
          }
        });
      } catch (error) {
        console.error('批量添加流水盘钱包失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 批量添加好持有者到白名单
    this.app.post('/api/token-holders/add-good-holders', async (req, res) => {
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

        // 筛选所有有效钱包（白名单不筛选持仓比例）
        const targetWallets = holders.filter(h => {
          if (EXCLUDE_ADDRESSES.includes(h.address?.toLowerCase())) {
            return false;
          }
          return h.address && h.address.length > 0;
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
        const walletName = `好持有者-${dateStr}`;

        // 批量创建钱包
        const walletsToCreate = targetWallets.map(h => ({
          address: h.address,
          name: walletName,
          category: 'good_holder'
        }));

        const result = await this.walletService.bulkCreateWallets(walletsToCreate);

        res.json({
          success: true,
          message: `成功添加 ${result.success} 个好持有者，跳过 ${result.skipped} 个已存在的钱包`,
          data: {
            success: result.success,
            skipped: result.skipped,
            skippedWallets: result.skippedWallets || [],
            walletName: walletName,
            wallets: result.details
          }
        });
      } catch (error) {
        console.error('批量添加好持有者失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取实验的持有者黑名单统计
    this.app.get('/api/experiment/:id/holder-blacklist-stats', async (req, res) => {
      try {
        let experimentId = req.params.id;

        // 🔥 如果是回测实验，使用源实验ID查询黑名单数据
        const { data: expConfig } = await this.dataService.supabase
          .from('experiments')
          .select('config')
          .eq('id', experimentId)
          .single();

        if (expConfig?.config?.backtest?.sourceExperimentId) {
          const sourceExperimentId = expConfig.config.backtest.sourceExperimentId;
          console.log(`📊 [黑名单统计] 回测实验，使用源实验ID: ${sourceExperimentId}`);
          experimentId = sourceExperimentId;
        }

        // 获取黑名单钱包（使用分页获取全部）
        const pageSize = 1000;
        const blacklistSet = new Set();
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          const { data: blacklistWallets } = await this.dataService.supabase
            .from('wallets')
            .select('address')
            .in('category', ['dev', 'pump_group', 'negative_holder'])
            .range(offset, offset + pageSize - 1);

          if (blacklistWallets && blacklistWallets.length > 0) {
            blacklistWallets.forEach(w => blacklistSet.add(w.address.toLowerCase()));
            offset += pageSize;
            hasMore = blacklistWallets.length === pageSize;
          } else {
            hasMore = false;
          }
        }

        // 获取白名单钱包（使用分页获取全部）
        offset = 0;
        hasMore = true;
        const whitelistSet = new Set();

        while (hasMore) {
          const { data: whitelistWallets } = await this.dataService.supabase
            .from('wallets')
            .select('address')
            .eq('category', 'good_holder')
            .range(offset, offset + pageSize - 1);

          if (whitelistWallets && whitelistWallets.length > 0) {
            whitelistWallets.forEach(w => whitelistSet.add(w.address.toLowerCase()));
            offset += pageSize;
            hasMore = whitelistWallets.length === pageSize;
          } else {
            hasMore = false;
          }
        }

        // 获取该实验的所有持有者快照
        offset = 0;
        hasMore = true;
        const tokenStats = new Map();

        while (hasMore) {
          const { data: snapshots } = await this.dataService.supabase
            .from('token_holders')
            .select('token_address, holder_data')
            .eq('experiment_id', experimentId)
            .range(offset, offset + pageSize - 1);

          if (snapshots && snapshots.length > 0) {
            for (const snapshot of snapshots) {
              const tokenAddr = snapshot.token_address;
              if (!tokenStats.has(tokenAddr)) {
                tokenStats.set(tokenAddr, {
                  hasBlacklist: false,
                  blacklistedHolders: 0,
                  hasWhitelist: false,
                  whitelistedHolders: 0
                });
              }
              const stats = tokenStats.get(tokenAddr);

              if (snapshot.holder_data?.holders) {
                for (const holder of snapshot.holder_data.holders) {
                  const addr = holder.address?.toLowerCase();
                  if (addr) {
                    // 检查黑名单
                    if (blacklistSet.has(addr)) {
                      stats.hasBlacklist = true;
                      stats.blacklistedHolders++;
                    }
                    // 检查白名单
                    if (whitelistSet.has(addr)) {
                      stats.hasWhitelist = true;
                      stats.whitelistedHolders++;
                    }
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

        const tokensWithBlacklist = Array.from(tokenStats.entries())
          .filter(([_, stats]) => stats.hasBlacklist)
          .map(([tokenAddr, stats]) => ({ token: tokenAddr, ...stats }));

        const tokensWithWhitelist = Array.from(tokenStats.entries())
          .filter(([_, stats]) => stats.hasWhitelist)
          .map(([tokenAddr, stats]) => ({ token: tokenAddr, ...stats }));

        const totalTokens = tokenStats.size;

        res.json({
          success: true,
          data: {
            totalTokens: totalTokens,
            blacklistedTokens: tokensWithBlacklist.length,
            blacklistedTokenList: tokensWithBlacklist,
            blacklistWalletCount: blacklistSet.size,
            whitelistedTokens: tokensWithWhitelist.length,
            whitelistedTokenList: tokensWithWhitelist,
            whitelistWalletCount: whitelistSet.size
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
          tokenAddress: req.query.tokenAddress,  // 新增：按代币地址过滤
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

    // 获取拒绝信号统计
    this.app.get('/api/experiment/:id/rejection-stats', async (req, res) => {
      try {
        const stats = await this.dataService.getRejectionStats(req.params.id);
        res.json({
          success: true,
          data: stats
        });
      } catch (error) {
        console.error('获取拒绝统计失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取早期交易者数据（按信号ID）
    this.app.get('/api/signal/:id/early-trades', async (req, res) => {
      try {
        // 获取强势交易者列表
        const { STRONG_TRADERS } = require('./trading-engine/pre-check/STRONG_TRADERS');
        const { WalletClusterService } = require('./trading-engine/pre-check/WalletClusterService');

        // 获取信号数据以获取 token_address 和 metadata（包含preBuyCheckResult）
        const { data: signalData, error: signalError } = await this.dataService.supabase
          .from('strategy_signals')
          .select('token_address, metadata')
          .eq('id', req.params.id)
          .single();

        if (signalError) {
          throw signalError;
        }

        // 获取早期交易数据
        const { data, error } = await this.dataService.supabase
          .from('early_participant_trades')
          .select('*')
          .eq('signal_id', req.params.id)
          .single();

        // 执行聚簇分析
        let clusterAnalysis = null;
        let clustersWithTrades = null;

        if (data && data.trades_data && data.trades_data.length > 0) {
          const clusterService = new WalletClusterService(console, { mode: 'block', clusterBlockThreshold: 7 });
          clusterAnalysis = clusterService.performClusterAnalysis(data.trades_data, signalData?.token_address);

          // 构建带交易的簇数据
          const trades = data.trades_data;
          const detectedClusters = clusterService._detectClusters(trades);

          clustersWithTrades = detectedClusters.map((clusterIndices, idx) => {
            const clusterTrades = clusterIndices.map(i => trades[i]);
            const blocks = clusterTrades.map(t => t.block_number).filter(b => b != null);
            const uniqueWallets = new Set();
            clusterTrades.forEach(t => {
              if (t.from_address) uniqueWallets.add(t.from_address.toLowerCase());
              if (t.to_address) uniqueWallets.add(t.to_address.toLowerCase());
            });

            // 计算Mega簇阈值
            const avgClusterSize = detectedClusters.reduce((sum, c) => sum + c.length, 0) / detectedClusters.length;
            const megaThreshold = Math.max(5, Math.floor(avgClusterSize * 2));
            const isMega = clusterIndices.length >= megaThreshold;

            return {
              id: idx + 1,
              size: clusterIndices.length,
              minBlock: blocks.length > 0 ? Math.min(...blocks) : null,
              maxBlock: blocks.length > 0 ? Math.max(...blocks) : null,
              uniqueWallets: uniqueWallets.size,
              isMega: isMega,
              trades: clusterTrades
            };
          });
        }

        if (error) {
          if (error.code === 'PGRST116') {
            // 未找到数据
            res.json({
              success: true,
              data: null,
              token_address: signalData?.token_address || null,
              signal_metadata: signalData?.metadata || null,
              strong_traders: Array.from(STRONG_TRADERS),
              cluster_analysis: clusterAnalysis,
              clusters: clustersWithTrades
            });
          } else {
            throw error;
          }
        } else {
          res.json({
            success: true,
            data: data,
            token_address: signalData?.token_address || null,
            signal_metadata: signalData?.metadata || null,
            strong_traders: Array.from(STRONG_TRADERS),
            cluster_analysis: clusterAnalysis,
            clusters: clustersWithTrades
          });
        }
      } catch (error) {
        console.error('获取早期交易数据失败:', error);
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

        const { skipAnalyzed = false } = req.body;
        const skipText = skipAnalyzed ? '（跳过已分析）' : '';
        console.log(`[代币分析] 开始分析实验 ${req.params.id} 的代币涨幅${skipText}...`);

        let progress = 0;
        const totalTokens = await analysisService.getAllTokens(req.params.id);
        const total = totalTokens.length;

        const result = await analysisService.analyzeExperimentTokens(req.params.id, (current, total) => {
          progress = current;
          const percent = ((current / total) * 100).toFixed(1);
          console.log(`[代币分析] 进度: ${current}/${total} (${percent}%)`);
        }, { skipAnalyzed });

        const skippedText = result.skipped > 0 ? `, ${result.skipped} 跳过` : '';
        console.log(`[代币分析] 分析完成: ${result.analyzed} 成功, ${result.failed} 失败${skippedText}`);

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

    // 获取实验叙事分析数据
    this.app.get('/api/experiment/:id/narrative', async (req, res) => {
      try {
        const result = await this.dataService.getExperimentNarratives(req.params.id);
        res.json(result);
      } catch (error) {
        console.error('获取实验叙事数据失败:', error);
        res.status(500).json({ success: false, error: error.message, data: [], count: 0 });
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

    // ============ 代币人工标注 API ============

    // 保存/更新代币标注
    this.app.post('/api/experiment/:experimentId/tokens/:address/judge', async (req, res) => {
      try {
        const { experimentId, address } = req.params;
        const { category, note } = req.body;

        // 验证 category
        const validCategories = ['fake_pump', 'no_user', 'low_quality', 'mid_quality', 'high_quality'];
        if (!category || !validCategories.includes(category)) {
          return res.status(400).json({ success: false, error: '无效的类别' });
        }

        const judgeData = {
          category,
          note: note || null,
          judge_at: new Date().toISOString()
        };

        const { error } = await this.dataService.supabase
          .from('experiment_tokens')
          .update({ human_judges: judgeData })
          .eq('experiment_id', experimentId)
          .eq('token_address', address);

        if (error) throw error;

        res.json({
          success: true,
          data: {
            token_address: address,
            human_judges: judgeData
          }
        });
      } catch (error) {
        console.error('保存代币标注失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 删除代币标注
    this.app.delete('/api/experiment/:experimentId/tokens/:address/judge', async (req, res) => {
      try {
        const { experimentId, address } = req.params;

        const { error } = await this.dataService.supabase
          .from('experiment_tokens')
          .update({ human_judges: null })
          .eq('experiment_id', experimentId)
          .eq('token_address', address);

        if (error) throw error;

        res.json({
          success: true,
          message: '标注已删除'
        });
      } catch (error) {
        console.error('删除代币标注失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取单个代币标注
    this.app.get('/api/experiment/:experimentId/tokens/:address/judge', async (req, res) => {
      try {
        const { experimentId, address } = req.params;

        const { data, error } = await this.dataService.supabase
          .from('experiment_tokens')
          .select('human_judges')
          .eq('experiment_id', experimentId)
          .eq('token_address', address)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            // 记录不存在，返回未标注
            return res.json({ success: true, data: null });
          }
          throw error;
        }

        res.json({
          success: true,
          data: data.human_judges
        });
      } catch (error) {
        console.error('获取代币标注失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ============ 叙事人工标注 API ============

    // 保存/更新叙事人工标注（token_address在请求体中）
    this.app.post('/api/experiment/:experimentId/narrative/judge', async (req, res) => {
      try {
        const { experimentId } = req.params;
        const { token_address, category, note } = req.body;

        if (!token_address) {
          return res.status(400).json({ success: false, error: '缺少token_address参数' });
        }

        // 验证 category
        const validCategories = ['fake_pump', 'no_user', 'low_quality', 'mid_quality', 'high_quality'];
        if (!category || !validCategories.includes(category)) {
          return res.status(400).json({ success: false, error: '无效的类别' });
        }

        const judgeData = {
          category,
          note: note || null,
          judge_at: new Date().toISOString()
        };

        const { error } = await this.dataService.supabase
          .from('experiment_tokens')
          .update({ human_judges: judgeData })
          .eq('experiment_id', experimentId)
          .eq('token_address', token_address);

        if (error) throw error;

        res.json({
          success: true,
          data: {
            token_address: token_address,
            human_judges: judgeData
          }
        });
      } catch (error) {
        console.error('保存叙事人工标注失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 删除叙事人工标注（token_address在请求体中）
    this.app.delete('/api/experiment/:experimentId/narrative/judge', async (req, res) => {
      try {
        const { experimentId } = req.params;
        const { token_address } = req.body;

        if (!token_address) {
          return res.status(400).json({ success: false, error: '缺少token_address参数' });
        }

        const { error } = await this.dataService.supabase
          .from('experiment_tokens')
          .update({ human_judges: null })
          .eq('experiment_id', experimentId)
          .eq('token_address', token_address);

        if (error) throw error;

        res.json({
          success: true,
          message: '标注已删除'
        });
      } catch (error) {
        console.error('删除叙事人工标注失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ============ API路由：Twitter功能 ============

    // 从代币描述提取推文
    this.app.post('/api/twitter/description/extract', async (req, res) => {
      try {
        const { description } = req.body;
        if (!description) {
          return res.status(400).json({ success: false, error: '缺少description参数' });
        }

        const tweets = this.twitterService.extractTweetsFromDescription(description);
        res.json({
          success: true,
          data: tweets
        });
      } catch (error) {
        console.error('从描述提取推文失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 从代币描述提取推文（含详情）
    this.app.post('/api/twitter/description/extract-detail', async (req, res) => {
      try {
        const { description } = req.body;
        if (!description) {
          return res.status(400).json({ success: false, error: '缺少description参数' });
        }

        const result = await this.twitterService.extractTweetsFromDescriptionWithDetails(description);
        res.json({
          success: true,
          data: result
        });
      } catch (error) {
        console.error('从描述提取推文详情失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 搜索代币地址的推文
    this.app.get('/api/twitter/token/:address/search', async (req, res) => {
      try {
        const { address } = req.params;
        const options = {
          minTweetCount: parseInt(req.query.minTweetCount) || 2,
          maxRetries: parseInt(req.query.maxRetries) || 3,
          timeout: parseInt(req.query.timeout) || 30000
        };

        const result = await this.twitterService.searchTokenAddress(address, options);
        res.json(result);
      } catch (error) {
        console.error('搜索代币地址推文失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 提取代币的Twitter特征
    this.app.get('/api/twitter/token/:address/extract', async (req, res) => {
      try {
        const { address } = req.params;
        const options = {
          minTweetCount: parseInt(req.query.minTweetCount) || 2,
          maxRetries: parseInt(req.query.maxRetries) || 3,
          timeout: parseInt(req.query.timeout) || 30000
        };

        const result = await this.twitterService.extractTokenTwitterFeatures(address, options);
        res.json(result);
      } catch (error) {
        console.error('提取代币Twitter特征失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取推文详情
    this.app.get('/api/twitter/tweet/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const result = await this.twitterService.getTweetDetail(id);
        res.json(result);
      } catch (error) {
        console.error('获取推文详情失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取用户信息
    this.app.get('/api/twitter/user/:handle', async (req, res) => {
      try {
        const { handle } = req.params;
        const result = await this.twitterService.getUserInfo(handle);
        res.json(result);
      } catch (error) {
        console.error('获取用户信息失败:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 获取代币的完整Twitter信息（包含描述推文和可选的地址搜索）
    this.app.get('/api/experiment/:id/tokens/:address/twitter', async (req, res) => {
      try {
        const { id, address } = req.params;
        const { searchAddress = 'false' } = req.query;

        // 获取代币数据
        const token = await this.dataService.getToken(id, address);
        if (!token) {
          return res.status(404).json({ success: false, error: '代币不存在' });
        }

        // 获取基础Twitter信息（包含描述推文）
        const result = await this.twitterService.getTokenTwitterInfo(token);

        // 如果需要搜索地址
        if (searchAddress === 'true') {
          try {
            const addressSearchResult = await this.twitterService.extractTokenTwitterFeatures(address, { minTweetCount: 1 });
            result.addressSearchResults = addressSearchResult;
          } catch (error) {
            result.addressSearchResults = { error: error.message };
          }
        }

        res.json({
          success: true,
          data: result
        });
      } catch (error) {
        console.error('获取代币Twitter信息失败:', error);
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

    // ============ 平台标签代币 API ============

    // 获取平台标签代币列表
    this.app.get('/api/platform/tokens', async (req, res) => {
      try {
        const { AveTokenAPI } = require('./core/ave-api');
        const config = require('../config/default.json');

        const { tag, chain = 'bsc', limit = 100, orderby = 'created_at' } = req.query;

        if (!tag) {
          return res.status(400).json({
            success: false,
            error: 'tag 参数是必需的'
          });
        }

        const apiKey = process.env.AVE_API_KEY;
        if (!apiKey) {
          return res.status(500).json({
            success: false,
            error: 'AVE_API_KEY 未配置'
          });
        }

        const aveApi = new AveTokenAPI(
          config.ave?.apiUrl || 'https://prod.ave-api.com',
          config.ave?.timeout || 30000,
          apiKey
        );

        const tokens = await aveApi.getPlatformTokens(tag, chain, parseInt(limit), orderby);

        res.json({
          success: true,
          tokens: tokens,
          count: tokens?.length || 0,
          requestParams: { tag, chain, limit, orderby }
        });
      } catch (error) {
        console.error('获取平台标签代币失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // ============ AVE 交易API测试端点 ============

    // 获取交换交易记录
    this.app.post('/api/ave-tx/swap', async (req, res) => {
      try {
        const { AveTxAPI } = require('./core/ave-api');
        const config = require('../config/default.json');

        const { apiKey, baseURL, pairId, limit = 10, sort = 'asc', fromTime = null, toTime = null } = req.body;

        const aveApi = new AveTxAPI(
          baseURL || config.ave?.apiUrl || 'https://prod.ave-api.com',
          config.ave?.timeout || 30000,
          apiKey || process.env.AVE_API_KEY
        );

        const transactions = await aveApi.getSwapTransactions(pairId, limit, fromTime, toTime, sort);

        res.json({
          success: true,
          data: {
            count: transactions.length,
            transactions: transactions
          }
        });
      } catch (error) {
        console.error('获取交换交易记录失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 获取流动性变化记录
    this.app.post('/api/ave-tx/liquidity', async (req, res) => {
      try {
        const { AveTxAPI } = require('./core/ave-api');
        const config = require('../config/default.json');

        const { apiKey, baseURL, pairId, limit = 10, type = 'all' } = req.body;

        const aveApi = new AveTxAPI(
          baseURL || config.ave?.apiUrl || 'https://prod.ave-api.com',
          config.ave?.timeout || 30000,
          apiKey || process.env.AVE_API_KEY
        );

        const transactions = await aveApi.getLiquidityTransactions(pairId, limit, null, null, 'asc', type);

        res.json({
          success: true,
          data: {
            count: transactions.length,
            transactions: transactions
          }
        });
      } catch (error) {
        console.error('获取流动性变化记录失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 获取地址交易记录
    this.app.post('/api/ave-tx/address', async (req, res) => {
      try {
        const { AveTxAPI } = require('./core/ave-api');
        const config = require('../config/default.json');

        const { apiKey, baseURL, walletAddress, chain, tokenAddress, pageSize = 50 } = req.body;

        const aveApi = new AveTxAPI(
          baseURL || config.ave?.apiUrl || 'https://prod.ave-api.com',
          config.ave?.timeout || 30000,
          apiKey || process.env.AVE_API_KEY
        );

        const result = await aveApi.getAddressTransactions(walletAddress, chain, tokenAddress, null, null, pageSize);

        res.json({
          success: true,
          data: {
            count: result.transactions.length,
            hasMore: result.has_more,
            nextCursor: result.next_cursor,
            transactions: result.transactions
          }
        });
      } catch (error) {
        console.error('获取地址交易记录失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 搜索代币 (searchTokens)
    this.app.post('/api/ave-token/search', async (req, res) => {
      try {
        const { AveTokenAPI } = require('./core/ave-api');
        const config = require('../config/default.json');

        const { apiKey, baseURL, keyword, chain = null, limit = 50, orderby = null } = req.body;

        if (!keyword) {
          return res.status(400).json({
            success: false,
            error: '搜索关键词不能为空'
          });
        }

        const finalApiKey = apiKey || process.env.AVE_API_KEY;
        const finalBaseURL = baseURL || config.ave?.apiUrl || 'https://prod.ave-api.com';

        const tokenAPI = new AveTokenAPI(finalBaseURL, 30000, finalApiKey);

        const tokens = await tokenAPI.searchTokens(keyword, chain, limit, orderby);

        res.json({
          success: true,
          data: {
            keyword,
            chain,
            count: tokens.length,
            tokens
          }
        });
      } catch (error) {
        console.error('搜索代币失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // AVE TX 测试页面
    this.app.get('/ave-tx-test', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/ave-tx-test.html'));
    });

    // ============ 钱包分析 API ============

    // 查询钱包信息
    this.app.post('/api/wallet/query', async (req, res) => {
      try {
        const { AveWalletAPI } = require('./core/ave-api');
        const config = require('../config/default.json');

        const { walletAddress, chain } = req.body;

        if (!walletAddress) {
          return res.status(400).json({
            success: false,
            error: '钱包地址不能为空'
          });
        }

        if (!chain) {
          return res.status(400).json({
            success: false,
            error: '区块链不能为空'
          });
        }

        const finalApiKey = process.env.AVE_API_KEY;
        const finalBaseURL = config.ave?.apiUrl || 'https://prod.ave-api.com';

        const walletAPI = new AveWalletAPI(finalBaseURL, 30000, finalApiKey);

        // 并行获取钱包信息和代币列表
        const [walletInfo, tokens] = await Promise.all([
          walletAPI.getWalletInfo(walletAddress, chain),
          walletAPI.getWalletTokens(walletAddress, chain, 'balance_usd', 'desc')
        ]);

        res.json({
          success: true,
          data: {
            walletInfo,
            tokens,
            raw: { walletInfo, tokens }
          }
        });

      } catch (error) {
        console.error('钱包查询失败:', error);
        res.status(500).json({
          success: false,
          error: error.message || '查询失败'
        });
      }
    });

    // ============ 代币最早交易 API ============

    // 获取代币最早交易记录
    this.app.post('/api/token-early-trades', async (req, res) => {
      try {
        const { AveTokenAPI } = require('./core/ave-api');
        const { AveTxAPI } = require('./core/ave-api');
        const config = require('../config/default.json');

        const { apiKey, baseURL, tokenAddress, chain, limit = 300, timeWindowMinutes = 3 } = req.body;

        if (!tokenAddress) {
          return res.status(400).json({
            success: false,
            error: '代币地址不能为空'
          });
        }

        if (!chain) {
          return res.status(400).json({
            success: false,
            error: '区块链不能为空'
          });
        }

        // 使用提供的配置或默认配置
        const finalApiKey = apiKey || process.env.AVE_API_KEY;
        const finalBaseURL = baseURL || config.ave?.apiUrl || 'https://prod.ave-api.com';

        // 构建 tokenId
        const tokenId = `${tokenAddress}-${chain}`;

        // 1. 获取代币详情
        const tokenApi = new AveTokenAPI(finalBaseURL, config.ave?.timeout || 30000, finalApiKey);
        const tokenDetail = await tokenApi.getTokenDetail(tokenId);

        // 2. 获取 platform 和 launch_at
        const { token, pairs } = tokenDetail;

        // 从数据库查询代币平台信息
        let platform = null;
        try {
          const { data: tokenRecord } = await this.dataService.supabase
            .from('experiment_tokens')
            .select('platform')
            .eq('token_address', tokenAddress)
            .eq('chain', chain)
            .limit(1)
            .maybeSingle();

          platform = tokenRecord?.platform || null;
          console.log(`📊 [最早交易] 从数据库查询 platform: ${platform}`);
        } catch (dbError) {
          console.log(`📊 [最早交易] 数据库查询失败: ${dbError.message}`);
        }

        // 如果数据库中没有，从 token 对象获取（AVE API 可能返回）
        if (!platform && token.platform) {
          platform = token.platform;
        }

        // 如果仍然没有，尝试从 pair 地址推测
        if (!platform) {
          let mainPair = token.main_pair;
          if (!mainPair && pairs && pairs.length > 0) {
            mainPair = pairs[0].pair;
          }
          // 检查 pair 后缀
          if (mainPair) {
            if (mainPair.endsWith('_fo')) {
              platform = 'fourmeme';
            } else if (mainPair.endsWith('_iportal')) {
              platform = 'flap';
            }
          }
        }

        // 默认为 fourmeme
        if (!platform) {
          platform = 'fourmeme';
        }

        console.log(`📊 [最早交易] 最终确定的 platform: ${platform}`);

        // 根据平台构造内盘 pair
        let innerPair;
        if (platform === 'fourmeme') {
          innerPair = `${tokenAddress}_fo`;
        } else if (platform === 'flap') {
          innerPair = `${tokenAddress}_iportal`;
        } else {
          // 未知平台，使用 main_pair
          let mainPair = token.main_pair;
          if (!mainPair && pairs && pairs.length > 0) {
            mainPair = pairs[0].pair;
          }
          if (!mainPair) {
            return res.status(400).json({
              success: false,
              error: '该代币没有交易对信息'
            });
          }
          innerPair = mainPair;
        }

        // 使用 launch_at 作为起始时间，获取代币创建后指定时间窗口内的交易
        const launchAt = token.launch_at || null;
        const fromTime = launchAt;
        const toTime = launchAt ? launchAt + (timeWindowMinutes * 60) : null;

        console.log(`📊 [最早交易] token=${tokenAddress}, chain=${chain}`);
        console.log(`   platform=${platform}`);
        console.log(`   launch_at=${launchAt}, created_at=${token.created_at}`);
        console.log(`   时间窗口: ${timeWindowMinutes}分钟`);
        console.log(`   innerPair=${innerPair}`);
        console.log(`   fromTime=${fromTime} (${fromTime ? toBeijingTime(fromTime) : 'null'})`);
        console.log(`   toTime=${toTime} (${toTime ? toBeijingTime(toTime) : 'null'})`);

        // 3. 获取最早交易记录（使用内盘 pair）
        const pairId = `${innerPair}-${chain}`;
        const txApi = new AveTxAPI(finalBaseURL, config.ave?.timeout || 30000, finalApiKey);

        // 获取交易记录（使用时间窗口，支持分页）
        // AVE API 从 toTime 向后回溯，所以如果返回300条，可能还有更早的交易
        const allTrades = [];
        const paginationLogs = []; // 记录每次分页查询的详情
        let currentToTime = toTime;
        let pageCount = 0;
        const MAX_PAGES = 10; // 安全限制，最多查询10次

        while (pageCount < MAX_PAGES) {
          const trades = await txApi.getSwapTransactions(
            pairId,
            300,        // limit - 每次最多300条
            fromTime,   // fromTime - 代币创建时间
            currentToTime,  // toTime - 当前查询的结束时间
            'asc'       // sort - 按时间升序
          );

          pageCount++;
          const logEntry = {
            page: pageCount,
            count: trades.length,
            toTime: currentToTime,
            toTimeFormatted: currentToTime ? toBeijingTime(currentToTime) : 'null'
          };
          paginationLogs.push(logEntry);
          console.log(`   第${pageCount}次查询: ${trades.length}条, toTime=${currentToTime} (${logEntry.toTimeFormatted})`);

          if (trades.length === 0) {
            // 没有更多数据了
            break;
          }

          allTrades.push(...trades);

          // 如果返回少于300条，说明已经取完所有数据
          if (trades.length < 300) {
            break;
          }

          // 返回了300条，可能还有更早的数据，继续向前查询
          // 新的 toTime = 当前结果第一条交易时间 - 1（向前1秒）
          logEntry.nextToTime = trades[0].time - 1;
          logEntry.nextToTimeFormatted = toBeijingTime(logEntry.nextToTime);
          currentToTime = trades[0].time - 1;

          // 安全检查：如果 toTime 已经早于 fromTime，停止查询
          if (currentToTime < fromTime) {
            console.log(`   ⚠️ 查询范围超出 fromTime，停止分页`);
            break;
          }
        }

        // 按时间排序确保顺序正确
        allTrades.sort((a, b) => a.time - b.time);

        const earlyTrades = allTrades;
        console.log(`   总共查询${pageCount}次，获取${earlyTrades.length}条交易记录`);
        if (earlyTrades.length > 0) {
          const firstTime = earlyTrades[0].time;
          const lastTime = earlyTrades[earlyTrades.length - 1].time;
          console.log(`   最早交易时间: ${firstTime} (${toBeijingTime(firstTime)})`);
          console.log(`   最晚交易时间: ${lastTime} (${toBeijingTime(lastTime)})`);
          console.log(`   代币 launch_at: ${launchAt} (${launchAt ? toBeijingTime(launchAt) : 'null'})`);
          console.log(`   代币 created_at: ${token.created_at} (${toBeijingTime(token.created_at)})`);
        } else {
          console.log(`   ⚠️ 没有查询到交易记录`);
          console.log(`   代币 launch_at: ${launchAt} (${launchAt ? toBeijingTime(launchAt) : 'null'})`);
        }

        // 如果进行了分页查询（多次API调用），返回所有获取的数据
        // 否则只返回前N条交易记录
        const limitedTrades = pageCount > 1 ? earlyTrades : earlyTrades.slice(0, limit);

        // 辅助函数：转换为北京时间字符串
        function toBeijingTime(timestamp) {
          if (!timestamp) return '-';
          const date = new Date(timestamp * 1000);
          const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
          return beijingTime.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').substring(0, 19);
        }

        res.json({
          success: true,
          data: {
            tokenInfo: tokenDetail,
            earlyTrades: limitedTrades,
            debug: {
              launchAt,
              createdAt: token.created_at,
              pairId,
              totalTrades: earlyTrades.length,
              returnedTrades: limitedTrades.length,
              firstTradeTime: limitedTrades.length > 0 ? limitedTrades[0].time : null,
              lastTradeTime: limitedTrades.length > 0 ? limitedTrades[limitedTrades.length - 1].time : null,
              timeWindowMinutes,
              pagination: {
                totalPages: pageCount,
                logs: paginationLogs
              },
              apiParams: {
                pairId,
                limit,
                timeWindowMinutes,
                fromTime: fromTime,
                fromTimeFormatted: fromTime ? toBeijingTime(fromTime) : 'null',
                toTime: toTime,
                toTimeFormatted: toTime ? toBeijingTime(toTime) : 'null',
                sort: 'asc'
              }
            }
          }
        });
      } catch (error) {
        console.error('获取代币最早交易失败:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 代币最早交易页面
    this.app.get('/token-early-trades', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/token-early-trades.html'));
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
