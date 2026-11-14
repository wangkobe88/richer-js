// 一次性 clone（182 跑）：bt-v102 → bt-v103（T135 ladder v18：t0/t0a 最早臂加
// tokenAgeSec >= 15——bt-v102 因子分析立法「好，加。然后回测」）。
//   ① buyStrategies 从库拉 signal-source-ladder-v1 最新快照（v18，copy-in），
//      每腿 cards:4（=bt-v102 每笔 0.2 BNB 同口径；库 legs 不带 cards）；
//   ② 卖腿=bt-v102 原样（已删「收益臂-50%」，100% 臂在）；
//   ③ 其余 config 原样（同窗 11-05 00:00~13:45、source=c6efed13、
//      signalGateReal/alwaysRecheck/buySignalMaxPerToken 15 不动）。
// 断言：库版本=18 ∧ 14 腿 ∧ t0/t0a condition 含年龄门 ∧ 全腿 cards=4 ∧
//       卖腿含 100% 臂不含 50% 臂。
// 启动=挂等待器：bt-v102 进程退出后 30s 内自动 setsid 启动（一阶段一实验纪律）。
const { dbManager } = require('../src/services/dbManager.js');
const { execSync } = require('child_process');
const SRC = 'c961a49d-2294-4152-9649-07ca13e4fd95'; // bt-v102

async function main() {
  const c = await dbManager.getClient();
  // 库拉 v18 最新
  const { data: lib, error: le } = await c.from('strategy_library')
    .select('id,name,side,version,legs').eq('name', 'signal-source-ladder-v1');
  if (le || !lib || !lib.length) throw new Error('库条目拉取失败: ' + (le && le.message));
  if (lib[0].version !== 18) throw new Error(`库版本断言失败：期望 18 实得 ${lib[0].version}`);
  const legs = JSON.parse(JSON.stringify(lib[0].legs));
  if (legs.length !== 14) throw new Error(`腿数断言失败：${legs.length}`);
  const t0 = legs.find((l) => l.priority === 1), t0a = legs.find((l) => l.priority === 2);
  if (!t0 || !t0a) throw new Error('t0/t0a 定位失败');
  for (const [l, n] of [[t0, 't0'], [t0a, 't0a']]) {
    if (!/tokenAgeSec >= 15/.test(l.condition || '')) throw new Error(`${n} 年龄门断言失败: ${l.condition}`);
  }
  for (const l of legs) l.cards = 4;
  if (legs.some((l) => l.cards !== 4)) throw new Error('cards=4 断言失败');

  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  const cfg = JSON.parse(JSON.stringify(e.config));
  const sc = cfg.strategiesConfig;
  const hasP50 = sc.sellStrategies.some((l) => (l.condition || '').trim() === 'profitPercent > 50');
  const hasP100 = sc.sellStrategies.some((l) => (l.condition || '').trim() === 'profitPercent > 100');
  if (hasP50) throw new Error('50% 臂残留断言失败');
  if (!hasP100) throw new Error('100% 臂缺失断言失败');
  sc.buyStrategies = legs;

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v103-ladder-v18-t0年龄15门',
    experiment_description: 'bt-v103（T135 立法回测，11-11 用户裁定「好，加。然后回测」）：ladder v18——t0/t0a 最早臂加 tokenAgeSec >= 15（bt-v102 因子分析：买点年龄分桶单调，age<15s 全体腿 36 票净 -0.25=止血 24 票 -0.70 vs 误伤 12 票 +0.45；15s 内走完 6~9 笔=开盘 bot 抢速盘）。基底 bt-v102 c961a49d（BP74/题集 BP58 + 删收益 50 臂 + 买 4 卡）同窗同源：buyStrategies 换库 signal-source-ladder-v1 v18 快照（14 腿全 cards:4），卖腿 17 条原样（100% 臂在 50% 臂删），窗 11-05 00:00~13:45 source=c6efed13',
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
  // 等待器：bt-v102 退出后自动启动（外层 setsid 立即返回，内层 exec 接管）
  execSync(
    `cd ~/richer-js && setsid nohup bash -c 'while pgrep -f "run-engine.js ${SRC}" >/dev/null; do sleep 30; done; exec setsid node src/run-engine.js ${row.id} > /tmp/bt-v103.log 2>&1' > /tmp/bt-v103-wait.log 2>&1 < /dev/null &`,
    { stdio: 'inherit', shell: '/bin/bash' }
  );
  console.log('等待器已挂：bt-v102 退出后 30s 内自动启动，日志 /tmp/bt-v103.log');
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
