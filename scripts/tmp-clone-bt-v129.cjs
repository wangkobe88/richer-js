// 一次性 clone（2026-11-15）：bt-v129 = v21 门·回测时间范围新通道（cfddf3da 双通道立法后首跑）。
// 用户指令「机制改成了使用时间窗口……选一个数据较为完整的窗口，再次回测，不要跟 A/B 两个窗重叠」：
// 新通道 config 形状=删 backtest.sourceExperimentId（触发「无源 id+双时刻」分支，token 宇宙从窗口内
// wss_events token_create 派生）；窗口 [11-03T15:00Z → 11-04T14:00Z] ≈23h——与 A 窗（11-02T12→
// 11-03T14:58Z）/B 窗（11-05T00→13:45Z）零重叠（与 C 窗 11-04T14:00 起也边界相接不重叠），
// v69→v72 四实验接力采集无空洞、窗口 token_create ≈6800 密度完整。
// 载体=bt-v128 config（v21 门=首两波+破发豁免，库 version 21 同形状）逐位克隆。
const { dbManager } = require('../src/services/dbManager.js');

const WIN = { startTime: '2026-11-03T15:00:00.000Z', endTime: '2026-11-04T14:00:00.000Z' };
const V21_TAIL = 'tokenAgeSec > 60 OR launchConstVsPct <= 0)';

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*')
    .ilike('experiment_name', 'bt-v128-c-v21-firstwave-exempt%').limit(1);
  if (error || !data[0]) throw new Error('bt-v128 读取失败');
  if (!data[0].id.startsWith('76ad229e') || data[0].status !== 'completed') throw new Error('bt-v128 形状断言失败');
  const cfg = JSON.parse(JSON.stringify(data[0].config));
  // 新通道：删 sourceExperimentId + 换窗口双时刻
  delete cfg.backtest.sourceExperimentId;
  cfg.backtest.startTime = WIN.startTime;
  cfg.backtest.endTime = WIN.endTime;
  if (cfg.backtest.signalGateReal !== true || cfg.backtest.maxTickRows !== 3000000)
    throw new Error('signalGateReal/maxTickRows 断言失败');
  if ('sourceExperimentId' in cfg.backtest) throw new Error('sourceExperimentId 未删除');
  let hits = 0;
  for (const l of cfg.strategiesConfig.buyStrategies) {
    if (!l.condition.endsWith(V21_TAIL)) throw new Error('v21 门串尾断言失败: ' + (l.name || l.id));
    hits++;
  }
  if (hits !== 14 || cfg.strategiesConfig.sellStrategies.length !== 16)
    throw new Error('腿数断言失败: ' + hits + '/' + cfg.strategiesConfig.sellStrategies.length);

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v129-window-v21-firstwave-exempt',
    experiment_description: 'bt-v129（2026-11-15 时间范围新通道首跑·v21 单臂）：回测 token 宇宙双通道立法（cfddf3da）后首个时间窗口实验——无 sourceExperimentId，token 集从窗口内 wss_events token_create 派生（缓存 scope=win-<start>_<end>）。窗口 [2026-11-03T15:00Z → 2026-11-04T14:00Z] ≈23h，与 A 窗（11-02T12→11-03T14:58Z）/B 窗（11-05T00→13:45Z）零重叠（用户指令），与 C 窗（11-04T14:00 起）边界相接不重叠；v69→v72 四实验接力采集无空洞、token_create ≈6800。策略=bt-v128 config 逐位克隆（v21 门=首两波扩展+T142 破发豁免 launchConstVsPct <= 0，库 version 21 同形状）。用户指令：选数据较完整窗口再次回测+钉结果。',
    trading_mode: 'backtest',
    strategy_type: data[0].strategy_type,
    blockchain: data[0].blockchain,
    kline_type: data[0].kline_type,
    status: 'stopped',
    config: cfg,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error('insert 失败: ' + ie.message);
  console.log('bt-v129 NEW_ID=' + row.id);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
