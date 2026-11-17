// 一次性 clone（2026-11-15）：bt-v128 = v21 门（首两波+破发豁免）在 C 窗数据集上的单臂测试。
// 用户指令「只测试 8eddeb38（bt-v126）对应的数据集合即可，暂时不要测试之前的 A/B 窗」：
// 窗口/源与 bt-v126 逐位一致（v72 源 edbd5b38，11-04T14:00→23:59:59），载体=bt-v126 config
// +14 买腿门串尾 v20→v21 替换（与库 v21 逐字一致）。对照臂=v124 基线/v125 簇臂/v126 v20。
const { dbManager } = require('../src/services/dbManager.js');

const V20_TAIL = 'tokenAgeSec > 60)';
const V21_TAIL = 'tokenAgeSec > 60 OR launchConstVsPct <= 0)';

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*')
    .ilike('experiment_name', 'bt-v126-c-firstwave-gate%').limit(1);
  if (error || !data[0]) throw new Error('bt-v126 读取失败');
  if (!data[0].id.startsWith('8eddeb38') || data[0].status !== 'completed') throw new Error('bt-v126 形状断言失败');
  const cfg = JSON.parse(JSON.stringify(data[0].config));
  const b = cfg.backtest;
  if (b.startTime !== '2026-11-04T14:00:00Z' || b.endTime !== '2026-11-04T23:59:59Z'
    || b.sourceExperimentId !== 'edbd5b38-27db-4dd4-8205-4bebfa410ea6' || b.signalGateReal !== true || b.maxTickRows !== 3000000)
    throw new Error('C 窗回测段形状断言失败: ' + JSON.stringify({ s: b.startTime, e: b.endTime }));
  let hits = 0;
  for (const l of cfg.strategiesConfig.buyStrategies) {
    if (!l.condition.endsWith(V20_TAIL)) throw new Error('v20 门串尾断言失败: ' + (l.name || l.id));
    l.condition = l.condition.slice(0, -V20_TAIL.length) + V21_TAIL;
    hits++;
  }
  if (hits !== 14 || cfg.strategiesConfig.sellStrategies.length !== 16)
    throw new Error('腿数断言失败: ' + hits + '/' + cfg.strategiesConfig.sellStrategies.length);

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v128-c-v21-firstwave-exempt',
    experiment_description: 'bt-v128（2026-11-15 C 窗 v21 单臂）：v21=ladder v20 首两波门+T142 破发豁免臂（OR launchConstVsPct <= 0，ASTER 0x31e2…7777 案立法，库 22c1b28c version 21）。载体=bt-v126 config 逐位克隆+14 买腿门串尾 v20→v21 替换（与库 v21 逐字一致），窗口/源与 bt-v126 一致（v72 源 edbd5b38，11-04T14:00→23:59:59）——用户指令「只测试 8eddeb38 对应的数据集合，暂时不要测试之前的 A/B 窗」。预期：豁免臂救回 ASTER（v126 错杀 +0.1721）→ v128 vs v126 净增 ≈+0.17。',
    trading_mode: 'backtest',
    strategy_type: data[0].strategy_type,
    blockchain: data[0].blockchain,
    kline_type: data[0].kline_type,
    status: 'stopped',
    config: cfg,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error('insert 失败: ' + ie.message);
  console.log('bt-v128 NEW_ID=' + row.id);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
