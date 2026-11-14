// 一次性 clone（182 跑）：bt-v87 → bt-v89（BP53+BP54+BP55 三改动对照 bt-v88 单变量）。
// 182 代码已 pull 至 c1165d5c（BP54 筹码门停用+BP55 pump 专属位置门退役）；
// config 原样复制（同窗口同 source=tick cache FRESH 复用）；insert 后 setsid 后台跑。
const { dbManager } = require('../src/services/dbManager.js');
const { execSync } = require('child_process');
const SRC = 'c84fc413-4928-45ca-9a55-b0791921820e';

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v89-完整窗口-BP54-BP56',
    experiment_description: 'BP54(筹码门停用)+BP55(pump 专属位置门退役)+BP56(BP53 ultra router 臂补价格腿 curVs≤+40) 三改动回测：commit 021da3bf。对照链 bt-v87 c84fc413 基线(BP50, 净 +1.0238/45 成交)→bt-v88 9b0b43c5(BP52+53, 净 -0.0354/61 成交; BP53 放行面 21 票≈-0.54, M4GA sbw=none 未买 -0.5152)→本实验(在 v88 基础上 +BP54/55/56)',
    trading_mode: 'backtest',
    strategy_type: e.strategy_type,
    blockchain: e.blockchain,
    kline_type: e.kline_type,
    status: 'stopped',
    config: e.config,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error(ie.message);
  console.log('NEW_ID=' + row.id);
  execSync(`cd ~/richer-js && setsid nohup node src/run-engine.js ${row.id} > /tmp/bt-v89.log 2>&1 < /dev/null &`, { stdio: 'inherit', shell: '/bin/bash' });
  console.log('已后台启动，日志 /tmp/bt-v89.log');
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
