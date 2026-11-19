#!/usr/bin/env node
// 正式克隆工具（2026-11-19 立，T167c 会话用户裁定「标准克隆模板默认带上 factorCheck」）：
// 整包复制基底实验 config + 门链标准段确保（factorCheck/cheatCheck/actFrontGate/buyPointCheck
// 缺则补 enabled:true——FP 族/CD/AF1/BP 四门在克隆产物永远在位）+ signalGate 买腿 cards:4
// 自动补（bt-v149 作废教训）+ trading_mode 陷阱断言（克隆脚本 trading-mode-trap memory）。
// 只建行不启动（启动走 182 main.js start-experiment）；--dry 打印注入计划不写库。
//
// 用法：
//   node scripts/clone-experiment.cjs --src <expId> --name <新实验名> [--desc "..."] [--dry]
//                                     [--no-gates]（跳过门链注入，纯整包复制）
// 示例：
//   node scripts/clone-experiment.cjs --src c73b62be-... --name bt-v155-xxx-36h-win1012 --dry
const { dbManager } = require('../src/services/dbManager');

function arg(k) {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const src = arg('src');
  const name = arg('name');
  const desc = arg('desc');
  const dry = process.argv.includes('--dry');
  const noGates = process.argv.includes('--no-gates');
  if (!src || !name) { console.error('用法: --src <expId> --name <名> [--desc ..] [--dry] [--no-gates]'); process.exit(1); }

  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', src).limit(1);
  if (error) throw new Error(error.message);
  if (!data.length) throw new Error('基底实验不存在: ' + src);
  const e = data[0];
  const cfg = JSON.parse(JSON.stringify(e.config));
  const mode = e.trading_mode;
  const changes = [];

  if (!noGates) {
    // 门链标准段：注入到平台主段（both/fourmeme→fourmemeWs；flap→flapWs；gang→gangWs）
    const plat = cfg.platform || 'fourmeme';
    const sec = plat === 'flap' ? 'flapWs' : plat === 'gang' ? 'gangWs' : 'fourmemeWs';
    cfg[sec] = cfg[sec] || {};
    // ① FP 因子门（T143/T167c——用户裁定「factorCheck 一直都需要打开」）
    cfg[sec].buyPointCheck = cfg[sec].buyPointCheck || {};
    if (cfg[sec].buyPointCheck.enabled !== true) { cfg[sec].buyPointCheck.enabled = true; changes.push(sec + '.buyPointCheck.enabled=true'); }
    cfg[sec].buyPointCheck.factorCheck = cfg[sec].buyPointCheck.factorCheck || {};
    if (cfg[sec].buyPointCheck.factorCheck.enabled !== true) { cfg[sec].buyPointCheck.factorCheck.enabled = true; changes.push(sec + '.buyPointCheck.factorCheck.enabled=true'); }
    // ② cheat 门 + AF1 前置门（灰度布尔显式开——缺省 false 防回归）
    cfg[sec].cheatCheck = cfg[sec].cheatCheck || {};
    if (cfg[sec].cheatCheck.enabled !== true) { cfg[sec].cheatCheck.enabled = true; changes.push(sec + '.cheatCheck.enabled=true'); }
    cfg[sec].cheatCheck.actFrontGate = cfg[sec].cheatCheck.actFrontGate || {};
    if (cfg[sec].cheatCheck.actFrontGate.enabled !== true) { cfg[sec].cheatCheck.actFrontGate.enabled = true; changes.push(sec + '.cheatCheck.actFrontGate.enabled=true'); }
    // ③ signalGate 买腿 cards:4 自动补（bt-v149 作废教训：换库腿漏 cards=卡牌阶梯退化）
    const sc = cfg.strategiesConfig || cfg.strategy || {};
    for (const l of (sc.buyStrategies || [])) {
      if (l.signalGate && l.cards !== 4) { l.cards = 4; changes.push('买腿[' + (l.name || 'leg') + '] cards→4'); }
    }
  }

  // trading_mode 陷阱断言（memory clone-script-trading-mode-trap）：基底啥模式产物就啥模式
  if (mode === 'backtest') {
    if (!cfg.backtest) throw new Error('回测基底缺 backtest 段');
    if (!cfg.backtest.startTime || !cfg.backtest.endTime) throw new Error('回测基底缺 startTime/endTime（缺一 fail-fast 拒启）');
  }

  console.log('基底:', e.experiment_name, '| mode:', mode, '| platform:', cfg.platform);
  console.log('窗口:', cfg.backtest ? cfg.backtest.startTime + ' ~ ' + cfg.backtest.endTime : '(非回测)');
  const sc2 = cfg.strategiesConfig || cfg.strategy || {};
  console.log('腿: buy=' + ((sc2.buyStrategies || []).length) + ' sell=' + ((sc2.sellStrategies || []).length));
  console.log('注入/修正 ' + changes.length + ' 处' + (changes.length ? '：\n  - ' + changes.join('\n  - ') : '（基底已全在位零改动）'));

  if (dry) { console.log('[dry] 未写库'); process.exit(0); }
  const row = {
    id: crypto.randomUUID(),
    experiment_name: name,
    experiment_description: desc || ('克隆自 ' + e.experiment_name + '（' + src + '），门链标准段经 clone-experiment.cjs 确保' + (changes.length ? '：' + changes.join('；') : '（基底已全在位）')),
    trading_mode: mode,
    strategy_type: e.strategy_type,
    blockchain: e.blockchain,
    kline_type: e.kline_type,
    status: 'stopped',
    config: { ...cfg, name },
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error(ie.message);
  console.log('NEW_ID=' + row.id);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
