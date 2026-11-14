// 一次性 clone（182 跑）：bt-v94 → bt-v95（BP58 点位性质+异常盘面识别+统一门 27.5 单题集变量对照）。
// 182 代码已 pull 至 992a20d9（BP52 题集：entry_shape 新题四桶贴顶必要条件版+market_pattern 四桶改制+
// NORMAL_ENTRY_LAUNCH_PCT=27.5+五桶退役五豁免臂随删）；config 原样复制（同窗同 source=tick cache FRESH 复用）；
// 七票定向对拍已达（三砸盘+苍蝇 crash entry_gate 拒/YiYi 位置门+spike 双拒/米+施工鸭 normal_dip 放行）。
const { dbManager } = require('../src/services/dbManager.js');
const { execSync } = require('child_process');
const SRC = '85cbad14-696f-49b2-baa4-a5407df4a2d2'; // bt-v94

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v95-完整窗口-BP58点位性质-异常盘面识别-统一门27.5',
    experiment_description: 'BP58（题集 BP52）回测：commit 992a20d9。对照链 bt-v92 0514e1bc(-0.1063/24 成交)→bt-v94 85cbad14(+0.6074/58 成交, CD391/392/393/T130 四改)→本实验(在 v94 基础上唯一变量=BP 题集 BP51→BP52：entry_shape 点位性质新题 crash/spike/normal_dip/flat 四桶+market_pattern 改制异常盘面识别四桶+五桶退役 LEGACY 并域+统一位置门 40→27.5+五豁免臂随删 ultra 恢复无条件拦)；七票对拍已拒 5 放 2 达成',
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
  execSync(`cd ~/richer-js && setsid nohup node src/run-engine.js ${row.id} > /tmp/bt-v95.log 2>&1 < /dev/null &`, { stdio: 'inherit', shell: '/bin/bash' });
  console.log('已后台启动，日志 /tmp/bt-v95.log');
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
