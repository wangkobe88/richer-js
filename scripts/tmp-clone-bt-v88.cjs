// 一次性 clone（182 跑）：bt-v87 → bt-v88（BP53 ④ultra 散户入口豁免单变量对照）。
// config 原样复制（backtest.sourceExperimentId 不变=tick cache 同基底 FRESH 复用）；
// insert 后 setsid 后台 run-engine。
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
    experiment_name: 'bt-v88-完整窗口-BP53-ultraRouter豁免',
    experiment_description: 'BP53 ④ultra 散户入口豁免（routerBuyPct60≥30 放行+同盖 act ultra 臂）单变量验证：唯一变量=commit 03c110b0（mapper-only，相对 bt-v87）；对照 bt-v87 c84fc413 净 +1.0238/45 成交；B1 口径 21 票④∧router≥30 放行面（bt-v87 首拒锚 Σ+5min=+0.080 打平）',
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
  execSync(`cd ~/richer-js && setsid nohup node src/run-engine.js ${row.id} > /tmp/bt-v88.log 2>&1 < /dev/null &`, { stdio: 'inherit', shell: '/bin/bash' });
  console.log('已后台启动，日志 /tmp/bt-v88.log');
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
