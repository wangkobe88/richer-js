/**
 * 交易引擎模块导出
 */

const { ExperimentFactory } = require('./factories/ExperimentFactory');
const { Experiment, TradeSignal, Trade, TradeStatus } = require('./entities');
const { VirtualTradingEngine } = require('./implementations/VirtualTradingEngine');
const { LiveTradingEngine } = require('./implementations/LiveTradingEngine');
const { BacktestEngine } = require('./implementations/BacktestEngine');
const { TradingMode, EngineStatus, ITradingEngine } = require('./interfaces/ITradingEngine');

module.exports = {
  // Factory
  ExperimentFactory,

  // Entities
  Experiment,
  TradeSignal,
  Trade,
  TradeStatus,

  // Implementations
  VirtualTradingEngine,
  LiveTradingEngine,
  BacktestEngine,

  // Interfaces
  TradingMode,
  EngineStatus,
  ITradingEngine
};
