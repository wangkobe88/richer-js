#!/usr/bin/env node
/**
 * 时序快照机制移除防线（2026-10-15 用户裁定「代码全停，表保留」）
 *
 * experiment_time_series_data 停写：引擎 30s N+1 写与每票全量 buildFactorMap 消失，
 * 表与历史数据保留。本测试锁源码口径零残留，防回流：
 *   1) 引擎侧写入链（interval/方法/lazy require/配置键）
 *   2) web 侧读链（时序 API/observer 页/策略分析页/压缩清理端点）
 *   3) FactorBuilder slim 构建器（signal 快照 buildFactorValuesForTimeSeries 刻意保留）
 *   4) 前端图表消费链（signals 页 Holder 图 / trades 页时序价格线图）
 *   5) 保留侧反证：组合快照 interval（portfolio_snapshots 表独立保留）仍在
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const noFile = p => !fs.existsSync(path.join(ROOT, p));

console.log('A 节：引擎侧写入链零残留');
{
  const files = [
    'src/trading-engine/implementations/FourMemeWssTradingEngine.js',
    'src/trading-engine/implementations/BacktestEngine.js',
    'src/trading-engine/core/AbstractTradingEngine.js',
  ];
  for (const f of files) {
    const src = read(f);
    check(`A1 ${path.basename(f)}: _recordTimeSeriesSnapshot/_shouldRecordTimeSeries/ExperimentTimeSeriesService 零残留`,
      () => {
        for (const pat of ['_recordTimeSeriesSnapshot', '_shouldRecordTimeSeries', 'ExperimentTimeSeriesService']) {
          if (src.includes(pat)) throw new Error(`残留: ${pat}`);
        }
      });
    check(`A2 ${path.basename(f)}: timeSeriesIntervalMs/timeSeriesActiveWindowMs 配置键零残留`,
      () => {
        if (src.includes('timeSeriesIntervalMs') || src.includes('timeSeriesActiveWindowMs')) {
          throw new Error('残留旧配置键');
        }
      });
  }
}
{
  const src = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
  check('A3 组合快照 interval 保留（portfolio_snapshots 独立于时序表，反证防误删）',
    () => {
      if (!/this\._intervals\.portfolioSnapshot = setInterval/.test(src)) throw new Error('组合快照 interval 缺失');
      if (!/portfolioSnapshotIntervalMs/.test(src)) throw new Error('portfolioSnapshotIntervalMs 配置读取缺失');
    });
}

console.log('B 节：FactorBuilder 构建器口径');
{
  const src = read('src/trading-engine/core/FactorBuilder.js');
  check('B1 buildSlimFactorValues（时序表专用 slim）零残留', () => {
    if (src.includes('buildSlimFactorValues')) throw new Error('slim 构建器残留');
  });
  check('B2 buildFactorsFromTimeSeries（web 时序回放专用）零残留', () => {
    if (src.includes('buildFactorsFromTimeSeries')) throw new Error('web 回放构建器残留');
  });
  check('B3 buildFactorValuesForTimeSeries 刻意保留（signal metadata trendFactors 快照链）', () => {
    if (!/function buildFactorValuesForTimeSeries\(/.test(src)) throw new Error('signal 快照构建器被误删');
    if (!/buildFactorValuesForTimeSeries,/.test(src)) throw new Error('module.exports 缺 signal 快照导出');
  });
}

console.log('C 节：web 服务与页面文件已删');
{
  check('C1 ExperimentTimeSeriesService.js 已删', () => {
    if (!noFile('src/web/services/ExperimentTimeSeriesService.js')) throw new Error('文件仍存在');
  });
  check('C2 StrategyAnalysisService.js 已删（核心输入=时序表，随链移除）', () => {
    if (!noFile('src/web/services/StrategyAnalysisService.js')) throw new Error('文件仍存在');
  });
  check('C3 observer 页整链已删（html+js）', () => {
    if (!noFile('src/web/templates/experiment_observer.html')) throw new Error('html 仍存在');
    if (!noFile('src/web/static/js/experiment_observer.js')) throw new Error('js 仍存在');
  });
  check('C4 strategy_analysis 页整链已删（html+js）', () => {
    if (!noFile('src/web/templates/strategy_analysis.html')) throw new Error('html 仍存在');
    if (!noFile('src/web/static/js/strategy_analysis.js')) throw new Error('js 仍存在');
  });
}

console.log('D 节：web-server 路由零残留');
{
  const src = read('src/web-server.js');
  check('D1 时序/压缩/清理/策略分析/observer 路由字符串零残留', () => {
    for (const pat of [
      '/api/experiment/time-series',
      'compress-time-series',
      'cleanup-tokens',
      '/api/experiment/strategy-analysis',
      '/api/experiment/strategies',
      'experiment_observer',
      'strategy_analysis',
    ]) {
      if (src.includes(pat)) throw new Error(`残留路由: ${pat}`);
    }
  });
}

console.log('E 节：前端消费链零残留');
{
  const signals = read('src/web/static/js/experiment_signals.js');
  // 2026-10-15 Holder 走势图按用户裁定恢复（ticks 重建版，数据源=/api/tokens/holder-series，
  // 见 _test_holder_series_rebuild.cjs）——此处只锁时序表依赖零回流，不再锁 holder 重建链
  check('E1 signals 页时序表 API 依赖零残留（Holder 图已改 ticks 重建源）', () => {
    for (const pat of ['fetchTimeSeriesData', '/api/experiment/time-series']) {
      if (signals.includes(pat)) throw new Error(`残留: ${pat}`);
    }
  });
  const signalsHtml = read('src/web/templates/experiment_signals.html');
  check('E2 signals 页 html holder-chart 容器在（ticks 重建版恢复）且不引用时序端点', () => {
    if (!signalsHtml.includes('id="holder-chart-wrapper"')) throw new Error('holder-chart 容器缺失（走势图被误删）');
    if (signalsHtml.includes('time-series')) throw new Error('时序端点引用残留');
  });
  const trades = read('src/web/static/js/experiment_trades.js');
  // 2026-10-15 trades 页价格线图按用户裁定恢复（ticks 重建版，数据源=/api/tokens/price-series，
  // 见 _test_price_series_rebuild.cjs）——此处只锁时序表依赖零回流，不再锁价格线重建链
  check('E3 trades 页时序表 API 依赖零残留（价格线图已改 ticks 重建源）+ K线链保留', () => {
    for (const pat of ['fetchTimeSeriesData', '/api/experiment/time-series']) {
      if (trades.includes(pat)) throw new Error(`残留: ${pat}`);
    }
    if (!/initTradeKlineChart/.test(trades)) throw new Error('trades K线链被误删');
  });
  const exps = read('src/web/static/js/experiments.js');
  check('E4 experiments 页压缩/清理按钮与模态链零残留', () => {
    for (const pat of ['compressTimeSeries', 'executeCompress', 'cleanupTokens', 'compress-time-series', 'data-action="compress"', 'data-action="cleanup"']) {
      if (exps.includes(pat)) throw new Error(`残留: ${pat}`);
    }
  });
  const expsHtml = read('src/web/templates/experiments.html');
  check('E5 experiments 页 html 压缩模态框零残留', () => {
    if (expsHtml.includes('compress-modal') || expsHtml.includes('compress-threshold-btn')) throw new Error('压缩模态框残留');
  });
  check('E6 前端 9 处入口链接零悬空（observer/strategy-analysis）', () => {
    const linkFiles = [
      'src/web/static/js/experiment_tokens.js',
      'src/web/static/js/experiment_token_returns.js',
      'src/web/static/js/monitor.js',
      'src/web/static/js/experiment_position_analysis.js',
      'src/web/static/js/experiments.js',
      'src/web/static/js/experiment_signal_stats.js',
      'src/web/static/js/experiment_narrative.js',
      'src/web/static/js/experiment_detail.js',
      'src/web/templates/experiment_detail.html',
      'src/web/templates/experiment_position_analysis.html',
    ];
    for (const f of linkFiles) {
      const src = read(f);
      if (/\/observer/.test(src)) throw new Error(`${f}: observer 链接残留`);
      if (/strategy-analysis/.test(src)) throw new Error(`${f}: strategy-analysis 链接残留`);
    }
  });
}

console.log('F 节：config 键口径');
{
  const cfg = JSON.parse(read('config/default.json'));
  check('F1 fourmemeWs/flapWs: 旧时序键删净 + portfolioSnapshotIntervalMs 在', () => {
    for (const sec of [cfg.fourmemeWs, cfg.flapWs]) {
      if ('timeSeriesIntervalMs' in sec) throw new Error('fourmemeWs/flapWs 残留 timeSeriesIntervalMs');
      if ('timeSeriesActiveWindowMs' in sec) throw new Error('fourmemeWs/flapWs 残留 timeSeriesActiveWindowMs');
      if (!('portfolioSnapshotIntervalMs' in sec)) throw new Error('缺 portfolioSnapshotIntervalMs');
    }
  });
}

console.log('G 节：分析工具链零悬空调用');
{
  const dl = read('scripts/experiment-analysis/core/data-loader.js');
  check('G1 data-loader: getTimeSeries/getStrategyAnalysis 零残留', () => {
    if (dl.includes('getTimeSeries') || dl.includes('getStrategyAnalysis')) throw new Error('死 API 客户端方法残留');
  });
  const mo = read('scripts/experiment-analysis/analyzers/missed-opportunities-analyzer.js');
  check('G2 missed-opportunities: 时序深挖段已降级（analyzeWhyNoSignal 零残留）', () => {
    if (mo.includes('analyzeWhyNoSignal') || mo.includes('getStrategyAnalysis')) throw new Error('时序深挖链残留');
  });
  check('G3 死脚本已删（check_signal_coverage/detailed_missed_report）', () => {
    if (!noFile('scripts/experiment-analysis/check_signal_coverage.js')) throw new Error('check_signal_coverage.js 仍存在');
    if (!noFile('scripts/experiment-analysis/detailed_missed_report.js')) throw new Error('detailed_missed_report.js 仍存在');
  });
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
