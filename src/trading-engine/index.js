/**
 * 交易引擎模块导出（BSC four.meme：WSS 事件驱动引擎 + tick 回测）
 */

const { ExperimentFactory } = require('./factories/ExperimentFactory');
const { Experiment, TradeSignal, Trade, TradeStatus } = require('./entities');
const { FourMemeWssTradingEngine } = require('./implementations/FourMemeWssTradingEngine');
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
  FourMemeWssTradingEngine,
  BacktestEngine,

  // Interfaces
  TradingMode,
  EngineStatus,
  ITradingEngine
};
