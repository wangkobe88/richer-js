// 一次性 clone（2026-11-15）：bt-v127 = v21 门（首两波+破发豁免）长窗单臂测试。
// 用户指令「找一个时间跨度足够长的（源），暂时不做对比回测，就测试 V20 的策略（现行=v21）」。
// 载体=bt-v123 config（v115 系策略集）+14 买腿门串尾 v20→v21 替换（与库 v21 逐字一致）；
// 窗口=v65 源（aed2091d，10-29T14:33→10-30T14:22 ≈23.8h，8218 token，最长单一覆盖，
// 与 A/B/C 三窗零重叠）。
const { dbManager } = require('../src/services/dbManager.js');

const SRC_ID = 'aed2091d-f22f-4660-ae62-42f48a9048de';
const WIN = { startTime: '2026-10-29T14:33:00Z', endTime: '2026-10-30T14:22:00Z' };
const V20_TAIL = 'tokenAgeSec > 60)';
const V21_TAIL = 'tokenAgeSec > 60 OR launchConstVsPct <= 0)';

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*')
    .ilike('experiment_name', 'bt-v123-b-firstwave-gate-rerun%').limit(1);
  if (error || !data[0]) throw new Error('bt-v123 读取失败');
  if (!data[0].id.startsWith('f454a704') || data[0].status !== 'completed') throw new Error('bt-v123 形状断言失败');
  const cfg = JSON.parse(JSON.stringify(data[0].config));
  const b = cfg.backtest;
  if (b.startTime !== '2026-11-05T00:00:00Z' || b.endTime !== '2026-11-05T13:45:10Z'
    || b.sourceExperimentId !== 'c6efed13-ce9d-41b0-89a5-8ca8b029a609' || b.signalGateReal !== true || b.maxTickRows !== 3000000)
    throw new Error('回测段形状断言失败');
  let hits = 0;
  for (const l of cfg.strategiesConfig.buyStrategies) {
    if (!l.condition.endsWith(V20_TAIL)) throw new Error('v20 门串尾断言失败: ' + (l.name || l.id));
    l.condition = l.condition.slice(0, -V20_TAIL.length) + V21_TAIL;
    hits++;
  }
  if (hits !== 14 || cfg.strategiesConfig.sellStrategies.length !== 16)
    throw new Error('腿数断言失败: ' + hits + '/' + cfg.strategiesConfig.sellStrategies.length);
  Object.assign(b, WIN, { sourceExperimentId: SRC_ID });

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v127-long-v21-firstwave-exempt',
    experiment_description: 'bt-v127（2026-11-15 长窗 v21 单臂）：v21=ladder v20 首两波门+T142 破发豁免臂（OR launchConstVsPct <= 0，ASTER 案立法，库 22c1b28c 部署 version 21）。载体=bt-v123 config 逐位克隆+14 买腿门串尾 v20→v21 替换（与库 v21 逐字一致）。窗口=v65 源（aed2091d）全窗 10-29T14:33→10-30T14:22 ≈23.8h/8218 token——最长单一源覆盖，与 A 窗（11-02~03）/B 窗（11-05 上午）/C 窗（11-04 下午）三窗零重叠。用户指令：长跨度源+单臂不对比。',
    trading_mode: 'backtest',
    strategy_type: data[0].strategy_type,
    blockchain: data[0].blockchain,
    kline_type: data[0].kline_type,
    status: 'stopped',
    config: cfg,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error('insert 失败: ' + ie.message);
  console.log('bt-v127 NEW_ID=' + row.id);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
