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

/**
 * Web服务器类
 */
class RicherJsWebServer {
  constructor() {
    this.app = express();
    this.port = process.env.WEB_PORT || 3000;
    this.setupMiddleware();
    this.setupRoutes();
    this.initializeServices();
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

    // 静态文件服务
    this.app.use('/static', express.static(path.join(__dirname, 'web/static')));
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

    // 实验详情页面
    this.app.get('/experiment/:id', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/experiment_detail.html'));
    });

    // 信号页面
    this.app.get('/experiment/:id/signals', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/experiment_signals.html'));
    });

    // 交易页面
    this.app.get('/experiment/:id/trades', (req, res) => {
      res.sendFile(path.join(__dirname, 'web/templates/experiment_trades.html'));
    });

    // ============ API路由：实验管理 ============

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
          initial_balance
        } = req.body;

        // 构建实验配置
        const config = {
          name: experiment_name,
          description: experiment_description,
          blockchain: blockchain || 'bsc',
          kline_type: kline_type || '1m',
          virtual: {
            initialBalance: parseFloat(initial_balance) || 100
          }
        };

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
