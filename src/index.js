#!/usr/bin/env node

/**
 * richer-js - Main Entry Point
 *
 * Automated trading engine for fourmeme tokens based on data-driven strategy
 */

require('dotenv').config({ path: './config/.env' });
const fs = require('fs');
const path = require('path');

// Load configuration
const configPath = path.join(__dirname, '../config/default.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Initialize logger
const Logger = require('./services/logger');
const logger = new Logger(config.logging);

// Initialize core components
const TokenPool = require('./core/token-pool');
const StrategyEngine = require('./core/strategy-engine');
const DecisionMaker = require('./core/decision-maker');

// Initialize collectors and monitors
const FourmemeCollector = require('./collectors/fourmeme-collector');
const KlineMonitor = require('./monitors/kline-monitor');

class RicherJs {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.running = false;
    }

    /**
     * Initialize all components
     */
    initialize() {
        this.logger.info('========================================');
        this.logger.info('richer-js 交易引擎启动');
        this.logger.info('========================================');

        // Check API key
        if (!process.env.AVE_API_KEY) {
            this.logger.error('AVE_API_KEY 未设置，请在 config/.env 中配置');
            process.exit(1);
        }

        // Initialize token pool
        this.tokenPool = new TokenPool(this.logger);
        this.logger.info('代币监控池已初始化');

        // Initialize strategy engine
        this.strategyEngine = new StrategyEngine(this.config, this.logger);
        this.logger.info('策略引擎已初始化', {
            buyTime: `${this.config.strategy.buyTimeMinutes}分钟`,
            earlyReturnRange: `${this.config.strategy.earlyReturnMin}-${this.config.strategy.earlyReturnMax}%`
        });

        // Initialize decision maker
        this.decisionMaker = new DecisionMaker(
            this.config,
            this.logger,
            this.tokenPool,
            this.strategyEngine
        );
        this.logger.info('决策器已初始化');

        // Initialize collector
        this.collector = new FourmemeCollector(
            this.config,
            this.logger,
            this.tokenPool
        );

        // Initialize monitor
        this.monitor = new KlineMonitor(
            this.config,
            this.logger,
            this.tokenPool
        );

        this.logger.info('所有组件初始化完成');
    }

    /**
     * Start the trading engine
     */
    start() {
        if (this.running) {
            this.logger.warn('交易引擎已在运行');
            return;
        }

        this.running = true;

        // Start collector
        this.collector.start();

        // Start monitor
        this.monitor.start();

        // Set up decision processing interval
        this.decisionInterval = setInterval(() => {
            this.processDecisions();
        }, this.config.monitor.decisionCheckInterval);

        // Set up cleanup interval (every minute)
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60000);

        // Set up stats logging interval (every 5 minutes)
        this.statsInterval = setInterval(() => {
            this.logStats();
        }, 5 * 60 * 1000);

        // Handle graceful shutdown
        this.setupShutdownHandlers();

        this.logger.info('交易引擎已启动');
        this.logger.info('');
    }

    /**
     * Process decisions for all tokens
     */
    processDecisions() {
        try {
            const summary = this.decisionMaker.processDecisions();

            // Check timeouts
            this.decisionMaker.checkTimeouts();

            // Log summary if there are decisions
            if (summary.buyDecisions > 0 || summary.sellDecisions > 0) {
                this.logger.info('决策处理完成', {
                    buyDecisions: summary.buyDecisions,
                    sellDecisions: summary.sellDecisions,
                    holdDecisions: summary.holdDecisions
                });
            }

        } catch (error) {
            this.logger.error('决策处理失败', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    /**
     * Clean up old tokens
     */
    cleanup() {
        try {
            const removed = this.tokenPool.cleanup();
            if (removed.length > 0) {
                this.logger.debug(`清理 ${removed.length} 个过期代币`);
            }
        } catch (error) {
            this.logger.error('清理失败', {
                error: error.message
            });
        }
    }

    /**
     * Log statistics
     */
    logStats() {
        const poolStats = this.tokenPool.getStats();
        const collectorStats = this.collector.getStats();
        const monitorStats = this.monitor.getStats();

        this.logger.info('========================================');
        this.logger.info('运行统计', {
            pool: poolStats,
            collector: {
                totalCollected: collectorStats.totalCollected,
                totalAdded: collectorStats.totalAdded,
                lastCollection: collectorStats.lastCollectionTime
            },
            monitor: {
                totalUpdates: monitorStats.totalUpdates,
                successfulUpdates: monitorStats.successfulUpdates,
                lastUpdate: monitorStats.lastUpdateTime
            }
        });
        this.logger.info('========================================');
    }

    /**
     * Set up shutdown handlers
     */
    setupShutdownHandlers() {
        const shutdown = (signal) => {
            this.logger.info(`收到 ${signal} 信号，正在关闭...`);
            this.stop();
            process.exit(0);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    }

    /**
     * Stop the trading engine
     */
    stop() {
        if (!this.running) {
            return;
        }

        this.running = false;

        // Clear intervals
        if (this.decisionInterval) {
            clearInterval(this.decisionInterval);
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }

        // Stop collector
        this.collector.stop();

        // Stop monitor
        this.monitor.stop();

        // Log final stats
        this.logStats();

        this.logger.info('交易引擎已停止');
    }
}

// Main execution
if (require.main === module) {
    const app = new RicherJs(config, logger);
    app.initialize();
    app.start();
}

module.exports = RicherJs;
