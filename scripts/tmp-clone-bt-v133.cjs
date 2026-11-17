// 一次性 clone（2026-11-15）：bt-v133 = bt-v132 同窗重跑 + T144 活跃度门（FP2）
const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').ilike('experiment_name', 'bt-v132-window-factor-prebuy-v2').limit(1);
  if (error || !data[0]) throw new Error('bt-v132 读取失败');
  if (!data[0].id.startsWith('b67b7318') || data[0].status !== 'completed') throw new Error('bt-v132 形状断言失败');
  const cfg = JSON.parse(JSON.stringify(data[0].config));
  const b = cfg.backtest;
  if (b.sourceExperimentId !== undefined || b.startTime !== '2026-11-03T15:00:00.000Z' || b.endTime !== '2026-11-04T14:00:00.000Z') throw new Error('窗口断言失败');
  if (!(cfg.fourmemeWs?.buyPointCheck?.factorCheck?.enabled === true)) throw new Error('factorCheck 断言失败');
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v133-window-act-gate-fp2',
    experiment_description: 'bt-v133（2026-11-15 T144 对拍）：bt-v132 config 逐位克隆（同窗 [11-03T15:00Z→11-04T14:00Z] 时间范围通道+factorCheck.enabled），唯一变量=代码 T144 活跃度门（FP2：judgeActivityLevel low 四臂收紧版+ultra 两臂+burst 语境/尾段激活双豁免，BP68 act 题整题退役；d2f1a0b1+b57640c4）。预扫描预期：机械 act 拒 504 行省 cheat 真烧 339 次+BP 9 次≈1.9 万 token/窗；Newly-blocked 5 票 +0.017 近零（Go Brrrrr/duanju 双豁免）。用户指令「回测一下，还是使用 b67b7318 同窗口数据」。',
    trading_mode: 'backtest', strategy_type: data[0].strategy_type, blockchain: data[0].blockchain, kline_type: data[0].kline_type, status: 'stopped', config: cfg,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error('insert 失败: ' + ie.message);
  console.log('bt-v133 NEW_ID=' + row.id);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
