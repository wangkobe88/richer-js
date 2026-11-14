// 一次性 clone（182 跑）：bt-v89 → bt-v90（quote 盘 FL 常量锚单变量对照）。
// 182 代码已 pull 至 242f5769（T127 续：resolveLaunchPriceBnb flap 分支恒 FL 常量——
// 182 实证 11/11 有成交 quote 盘首 tick=常量 1.00x，赵公主案 38.5% 实为 +107.3% 引出）；
// config 原样复制（同窗口同 source=tick cache FRESH 复用）；insert 后 setsid 后台跑。
const { dbManager } = require('../src/services/dbManager.js');
const { execSync } = require('child_process');
const SRC = 'b7941b0c-b758-4bff-8dce-8818249caae7';

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v90-完整窗口-quote常量锚',
    experiment_description: 'T127 续（quote 盘发行价锚同 FL 常量）回测：commit 242f5769。对照链 bt-v87 c84fc413 基线(BP50, 净 +1.0238/45 成交)→bt-v88 9b0b43c5(BP52+53, 净 -0.0354/61 成交)→bt-v89 b7941b0c(BP54/55/56+D3.63, 净 +0.9261/73 成交)→本实验(在 v89 基础上唯一变量=quote 盘 curVs 分母 FL 常量化；182 实证 11/11 quote 盘首 tick=FL 1.00x，赵公主 0x5793b7ea 案 38.5%→107.3% 翻拒 pattern_gate 已单锚对拍)',
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
  execSync(`cd ~/richer-js && setsid nohup node src/run-engine.js ${row.id} > /tmp/bt-v90.log 2>&1 < /dev/null &`, { stdio: 'inherit', shell: '/bin/bash' });
  console.log('已后台启动，日志 /tmp/bt-v90.log');
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
