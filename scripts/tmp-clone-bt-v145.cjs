// 一次性 clone（182 跑）：bt-v144 → bt-v145（T175/AF1 前置活跃度门 A/B 对照）。
// 同窗同配置（23h win1103、ladder v28 十四腿+18 卖腿+门链全开+FP15 代码层），
// 唯一 config 差=fourmemeWs.cheatCheck.actFrontGate.enabled=true（AF1 分流：
// low/ultra∧非burst 拒、burst 豁免/high 跳过 cheat、mid 全链）；
// 代码层同时携带 T174b/FP15 burst 弱波大户合并口径——对照差=AF1 分流+FP15 合并。
// 对照基线=bt-v144（FP13 时代，净 +1.5591 / 951 信号 / 28 成交 / cheat 真调 232）。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = 'a869d119-c389-47e0-89ce-89e86114ad0e'; // bt-v144

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (e.trading_mode !== 'backtest') throw new Error('基底非 backtest？');
  const cfg = JSON.parse(JSON.stringify(e.config));
  if (!cfg.fourmemeWs?.buyPointCheck?.factorCheck?.enabled) throw new Error('基底断言失败：factorCheck 未开');
  if (!cfg.fourmemeWs?.cheatCheck?.enabled) throw new Error('基底断言失败：cheatCheck 未开');
  if (!cfg.backtest?.signalGateReal) throw new Error('基底断言失败：signalGateReal 未开');
  if (cfg.fourmemeWs?.cheatCheck?.actFrontGate) throw new Error('基底断言失败：actFrontGate 段已在场（重复克隆？）');
  if ((cfg.strategiesConfig.sellStrategies || []).length !== 18) throw new Error('基底断言失败：卖腿数≠18');
  if ((cfg.strategiesConfig.buyStrategies || []).length !== 14) throw new Error('基底断言失败：买腿数≠14');
  // 唯一差：AF1 前置门开启
  cfg.fourmemeWs.cheatCheck.actFrontGate = { enabled: true };
  cfg.name = 'bt-v145';
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v145-af1-actfront-23h-win1103',
    experiment_description: 'bt-v145（2026-11-18 T175/AF1 前置活跃度门 A/B：cheatCheck.actFrontGate.enabled=true——门链 FP→AF1（Jev 3 题分流）→cheat→BP；low/ultra∧非burst 拒、low/ultra∧burst 豁免跳 cheat、high∧wash≠strong 跳 cheat、mid 照走全链；config=bt-v144 原样同窗 23h win1103（cache FRESH），唯一 config 差=AF1 开启；代码层另携带 T174b/FP15 burst 弱波大户合并口径；对照基线=bt-v144 FP13 时代净 +1.5591）',
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
