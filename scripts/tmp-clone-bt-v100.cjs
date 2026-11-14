// 一次性 clone（182 跑）：bt-v96 → bt-v100（T133 四条+BP69 回测，用户 11-10 指令
// 「这几件事情全部搞定后，请回测」）：
// ① 买腿整组替换为库 v17（14 腿：t0 6 笔+maxTriggers 2+全腿 actTotalBnb >= 0.1+十一臂 28.5）
//    ——从部署后 strategy_library 读回快照 copy-in（validateLegs 已过）
// ② 加两新卖腿（famous-entry-exit + low-zone-stall-exit，库 INSERT 条目读回）
// ③ buySignalMaxPerToken 13 → 15（t0 maxTriggers 2 + 其余 13 腿各 1 = 最坏 15 信号/票）
// ④ cheat/BP minTicks 走服务 DEFAULTS=6（代码层 T133，config 无显式键=自动吃到）
// 其余 config 原样（同窗同 source=tick cache FRESH 复用；signalGateReal/cheatCheck/
// buyPointCheck 均已在位断言确认）；克隆后改动断言不一致即 throw。
const { dbManager } = require('../src/services/dbManager.js');
const { execSync } = require('child_process');
const SRC = 'e582e873-7f1a-44a5-b50f-0fca576847be'; // bt-v96

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  const cfg = JSON.parse(JSON.stringify(e.config));
  const sc = cfg.strategiesConfig;

  // 前置断言：bt-v96 基线形状
  if (sc.buyStrategies.length !== 13) throw new Error(`基线买腿数异常：${sc.buyStrategies.length}`);
  if (!sc.buyStrategies[0].condition.includes('tradeCount >= 9')) throw new Error('基线 t0 腿形状异常（应 v15 9 笔档）');
  if (cfg.fourmemeWs.buySignalMaxPerToken !== 13) throw new Error('基线信号帽数异常');
  if (cfg.backtest.signalGateReal !== true) throw new Error('基线 signalGateReal 缺失');
  if (!cfg.fourmemeWs.cheatCheck || cfg.fourmemeWs.cheatCheck.enabled !== true) throw new Error('基线 cheatCheck 缺失');
  if (!cfg.fourmemeWs.buyPointCheck || cfg.fourmemeWs.buyPointCheck.enabled !== true) throw new Error('基线 buyPointCheck 缺失');
  if (cfg.fourmemeWs.cheatCheck.minTicks !== undefined) throw new Error('cheatCheck 显式 minTicks 在场（预期走 DEFAULTS）');
  if (cfg.fourmemeWs.buyPointCheck.minTicks !== undefined) throw new Error('buyPointCheck 显式 minTicks 在场（预期走 DEFAULTS）');
  const sellBefore = sc.sellStrategies.length;

  // ① 买腿整组替换：库 v17 读回
  const { data: libBuy, error: eb } = await c.from('strategy_library').select('name,version,legs').eq('name', 'signal-source-ladder-v1').limit(1);
  if (eb) throw new Error(eb.message);
  if (!libBuy[0] || libBuy[0].version !== 17) throw new Error(`库 v17 读回失败：${libBuy[0] && libBuy[0].version}`);
  sc.buyStrategies = JSON.parse(JSON.stringify(libBuy[0].legs));
  const t0 = sc.buyStrategies[0];
  if (sc.buyStrategies.length !== 14) throw new Error(`v17 腿数异常：${sc.buyStrategies.length}`);
  if (!t0.condition.includes('tradeCount >= 6 AND buyVolumeBnb >= 1 AND holdersExDust >= 4 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1')) throw new Error(`v17 t0 腿形状异常：${t0.condition}`);
  if (t0.signalGate.maxTriggers !== 2) throw new Error(`v17 t0 maxTriggers 异常：${t0.signalGate.maxTriggers}`);
  for (const l of sc.buyStrategies) {
    if (!(l.condition || '').includes('actTotalBnb >= 0.1')) throw new Error(`v17 腿缺 actTotalBnb 门：${l.condition}`);
    if ((l.condition || '').includes('<= 27.5')) throw new Error(`v17 腿残留 27.5：${l.condition}`);
  }

  // ② 两新卖腿读回（INSERT 条目 version=1）
  const { data: libSells, error: es } = await c.from('strategy_library').select('name,version,legs').in('name', ['famous-entry-exit', 'low-zone-stall-exit']);
  if (es) throw new Error(es.message);
  const byName = Object.fromEntries(libSells.map((r) => [r.name, r]));
  if (!byName['famous-entry-exit'] || !byName['low-zone-stall-exit']) throw new Error('两卖腿库条目读回失败');
  if (!byName['famous-entry-exit'].legs[0].condition.includes('sinceEntryFamousNearLaunchBuys >= 1')) throw new Error('famous-entry-exit 腿形状异常');
  if (!byName['low-zone-stall-exit'].legs[0].condition.includes('currentVsLaunchPct > 40 AND currentVsLaunchPct <= 80 AND actTotalBnb < 0.1')) throw new Error('low-zone-stall-exit 腿形状异常');
  sc.sellStrategies.push(JSON.parse(JSON.stringify(byName['famous-entry-exit'].legs[0])));
  sc.sellStrategies.push(JSON.parse(JSON.stringify(byName['low-zone-stall-exit'].legs[0])));
  if (sc.sellStrategies.length !== sellBefore + 2) throw new Error('卖腿追加数异常');

  // ③ 信号帽 13 → 15
  cfg.fourmemeWs.buySignalMaxPerToken = 15;

  // libraryRefs 更新（provenance）：ladder v15→v17 + 两新条目
  const refLadder = (sc.libraryRefs || []).find((r) => r.name === 'signal-source-ladder-v1');
  if (!refLadder || refLadder.version !== 15) throw new Error('libraryRefs ladder 条目异常');
  refLadder.version = 17;
  sc.libraryRefs.push({ name: 'famous-entry-exit', version: byName['famous-entry-exit'].version });
  sc.libraryRefs.push({ name: 'low-zone-stall-exit', version: byName['low-zone-stall-exit'].version });

  console.log(`改动核验：buy=${sc.buyStrategies.length}（t0 maxTriggers=${t0.signalGate.maxTriggers}）sell=${sc.sellStrategies.length} 帽=15 refs=${sc.libraryRefs.map((r) => r.name + ':v' + r.version).join(',')}`);

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v100-完整窗口-库v17-T133四条-统一门285',
    experiment_description: 'bt-v100（T133 用户 11-10 四条指令回测）基底 bt-v96 e582e873（BP58 二修题面，+0.9421/57）：① 买腿整组换库 v17——t0 6 笔+maxTriggers 2（首次 Jev 拒后再判一次，单仓语义防双买）+全 14 腿 actTotalBnb >= 0.1 低活跃度不买+十一臂价格门 27.5→28.5；② 加两卖臂 famous-entry-exit（famous 在 near_launch 区间入场立即全清）+low-zone-stall-exit（low 区 +40~80 AND actTotalBnb < 0.1 立即全清）；③ buySignalMaxPerToken 13→15（t0 两次+13 腿各 1）；④ cheat/BP minTicks 走 DEFAULTS=6 代码层同线。BP69 统一门 28.5 同车。其余 config 原样（同窗同 source）',
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
  execSync(`cd ~/richer-js && setsid nohup node src/run-engine.js ${row.id} > /tmp/bt-v100.log 2>&1 < /dev/null &`, { stdio: 'inherit', shell: '/bin/bash' });
  console.log('已后台启动，日志 /tmp/bt-v100.log');
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
