// 一次性 clone（182 跑）：bt-v150 → bt-v151（T184 聪明钱涌入备选策略独立回测）。
// 同窗 36h（10-12T00:00~10-13T12:00）+同 maxTickRows，策略整体替换为 smart-inflow-relay v1：
//   买腿 1 条：smartInflowReady == 1（T184 涌入事件：≥3 实体 600s strict 接力 ∧ 链额≤5B），
//             cards:1、buyPhase:first（每票只买首个事件）；
//   卖腿 1 条：realHoldDuration >= 60 全清 bypass（研究 60s 快出参数组：famous +1.37B/
//             SM +1.57B/UNION +3.06B 的复现载体）；
//   stopLoss：priceStopPercent -20（研究 SL20 参数）+ scanIntervalSec 10（断流票扫描兜底）；
//   独立纯净：删 cheatCheck/buyPointCheck/factorSellFilter/stallClose/门链全段——
//   不与现行 ladder 体系混淆（用户指令「做单独的回测测试」）。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = '8ebaccce-62c6-4209-a2a0-40f361c49bf9'; // bt-v150

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (e.trading_mode !== 'backtest') throw new Error('基底非 backtest？');
  const cfg = JSON.parse(JSON.stringify(e.config));
  // 基底断言
  if (cfg.backtest.startTime !== '2026-10-12T00:00:00.000Z' || cfg.backtest.endTime !== '2026-10-13T12:00:00.000Z') {
    throw new Error('基底断言失败：窗口非预期');
  }
  if (cfg.backtest.maxTickRows !== 3000000) throw new Error('基底断言失败：maxTickRows');
  if (cfg.strategiesConfig.buyStrategies.length !== 14) throw new Error('基底断言失败：非 bt-v150 十四腿？');

  // ── 策略整体替换 ──
  cfg.strategiesConfig = {
    buyStrategies: [{
      cards: 1,
      action: 'buy',
      buyPhase: 'first',
      priority: 1,
      condition: 'smartInflowReady == 1',
      cooldownSec: null,
      description: 'smart-inflow-buy v1（T184 聪明钱涌入备选策略，2026-11-18 涌入研究立法）：famous∪smartmoney 名单实体接力事件（≥3 实体 600s 窗 strict 接力 ∧ 链额≤5B ∧ 镜像簇合并），事件后 60s ready 保持窗内首买一次；研究 UNION 140 票 60s∧SL20% +3.06B/36h。独立回测腿——不与 ladder 体系混用',
    }],
    sellStrategies: [{
      cards: 'all',
      priority: 1,
      condition: 'realHoldDuration >= 60',
      cooldownSec: null,
      description: 'smart-inflow-exit-60s v1（快出腿）：成交起 60s 全清 bypass 立即路径——研究形状=快进吃脉冲（峰时 p50 约 30s、末值中位 -45%），持有不动必被收割；断流票由扫描兜底评估',
      bypassDebounce: true,
    }],
    libraryRefs: [],
  };

  // ── 独立纯净化：删门链/机制段 ──
  delete cfg.cheatCheck;
  delete cfg.buyPointCheck;
  delete cfg.stallClose;
  delete cfg.backtest.signalGateReal;
  const fw = cfg.fourmemeWs || {};
  for (const k of ['cheatCheck', 'buyPointCheck', 'factorSellFilter', 'accountHealthCheck',
    'gmgnEntryCheck', 'observationSignals', 'narrativeRetry', 'corpusEnrich', 'onlineProfile',
    'factorParams', 'buySignalCooldownTicks', 'sellDebounceMinTicks']) {
    delete fw[k];
  }
  cfg.fourmemeWs = fw; // 保留 live 段与 buySignalCooldownMs/MaxPerToken（全局节流默认行为）

  // ── 卡牌/仓位/止损 ──
  cfg.positionManagement = { perCardBNB: 0.2 }; // 1 卡=0.2B（对齐研究模拟每票 0.2B）
  cfg.stopLoss = { priceStopPercent: -20, scanIntervalSec: 10 };

  cfg.name = 'bt-v151';
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v151-smart-inflow-relay1-36h-win1012',
    experiment_description: 'bt-v151（T184 聪明钱涌入备选策略独立回测，2026-11-18 用户指令「设计一个策略回测试试，做单独的回测不要跟当前策略混淆」）：基于 bt-v150 同窗 36h（10-12T00:00~10-13T12:00）同 maxTickRows 300 万，策略整体替换为 smart-inflow-relay v1——买腿 smartInflowReady==1（FA T184 涌入状态机：famous∪smartmoney 实体 ≥3 个 600s strict 接力 ∧ 链额≤5B，事件后 60s 保持窗，buyPhase:first 每票首事件一次）、卖腿 realHoldDuration>=60 全清 bypass、止损 -20%/扫描 10s。无门链（cheat/BP/factorCheck 全关）=研究模拟口径纯净复现，对照=研究数字 UNION 140 票 +3.06B（famous-only 50 票 +1.37B、SM-only 51 票 +1.57B）。⚠smartmoney 名单 2026-11-17 起累积用于 10 月窗口有前视风险（GMGN 标签含事后盈利画像），跨窗验证前不入现行体系',
    trading_mode: 'backtest',
    strategy_type: e.strategy_type,
    blockchain: e.blockchain,
    kline_type: e.kline_type,
    status: 'stopped',
    config: cfg,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error(ie.message);
  console.log('NEW_ID=' + row.id);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
