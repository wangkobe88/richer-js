// 一次性 clone（182 跑）：bt-v96 → bt-v97（三变量实验配置改动，用户 11-10 指令）：
// ① t0a 腿 buyVolumeBnb >= 1 → >= 1.2；② 删 pump-imbalance-exit 卖腿（realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90）+libraryRefs 条目；
// ③ cheatCheck.gate.alwaysRecheck true → false（CD389 每信号重判退回 CD381 粘滞形态——重检只在 recheckCondition 命中的有限买入臂）。
// config 其余原样复制（同窗同 source=tick cache FRESH 复用）；克隆后改动断言不一致即 throw。
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

  // ① t0a 量门 1 → 1.2（整串替换防前缀误伤）
  const NEW_COND = 'tradeCount >= 9 AND buyVolumeBnb >= 1.2 AND holdersExDust >= 6 AND currentVsLaunchPct <= 27.5';
  const t0a = sc.buyStrategies.filter((l) => l.priority === 1 && (l.condition || '').includes('tradeCount >= 9'));
  if (t0a.length !== 1) throw new Error(`t0a 腿定位失败：命中 ${t0a.length} 条`);
  t0a[0].condition = NEW_COND;

  // ② 删 pump-imbalance-exit 卖腿（唯一含 sinceEntryNetBuyRatio 的腿）+ libraryRefs 条目
  const before = sc.sellStrategies.length;
  sc.sellStrategies = sc.sellStrategies.filter((l) => !(l.condition || '').includes('sinceEntryNetBuyRatio'));
  if (sc.sellStrategies.length !== before - 1) throw new Error(`卖腿删除数异常：${before} → ${sc.sellStrategies.length}`);
  const refsBefore = sc.libraryRefs.length;
  sc.libraryRefs = sc.libraryRefs.filter((r) => r.name !== 'pump-imbalance-exit');
  if (sc.libraryRefs.length !== refsBefore - 1) throw new Error(`libraryRefs 删除数异常：${refsBefore} → ${sc.libraryRefs.length}`);

  // ③ alwaysRecheck 退回粘滞
  cfg.fourmemeWs.cheatCheck.gate.alwaysRecheck = false;

  // 改动断言
  if (!t0a[0].condition.includes('buyVolumeBnb >= 1.2 AND')) throw new Error('t0a 改后断言失败');
  if (sc.sellStrategies.some((l) => (l.condition || '').includes('sinceEntryNetBuyRatio'))) throw new Error('卖腿残留断言失败');
  if (sc.libraryRefs.some((r) => r.name === 'pump-imbalance-exit')) throw new Error('libraryRefs 残留断言失败');
  if (cfg.fourmemeWs.cheatCheck.gate.alwaysRecheck !== false) throw new Error('alwaysRecheck 断言失败');
  console.log(`改动核验：buyStrategies=${sc.buyStrategies.length}（t0a=…${t0a[0].condition.slice(0, 60)}…）sellStrategies=${sc.sellStrategies.length} libraryRefs=${sc.libraryRefs.length} alwaysRecheck=false`);

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v97-完整窗口-t0a量门1.2-删pump失衡卖臂-cheat粘滞退回',
    experiment_description: 'bt-v97（用户 11-10 三变量指令）基底 bt-v96 e582e873（BP58 二修题面，+0.9421/57）：① t0a 腿 buyVolumeBnb 1→1.2；② 删 pump-imbalance-exit 卖腿（T113 sinceEntryNetBuyRatio >= 90 全清臂）+libraryRefs；③ cheatCheck.gate.alwaysRecheck true→false——CD389 每信号重判退回 CD381 粘滞形态（cheat 拉黑/healthy 版本秒回，重检只在 recheckCondition 命中的有限买入臂=早臂族 unhealthy∨almost_launch+NL 三臂 almost_launch）。其余 config 原样（同窗同 source）',
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
  execSync(`cd ~/richer-js && setsid nohup node src/run-engine.js ${row.id} > /tmp/bt-v97.log 2>&1 < /dev/null &`, { stdio: 'inherit', shell: '/bin/bash' });
  console.log('已后台启动，日志 /tmp/bt-v97.log');
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
