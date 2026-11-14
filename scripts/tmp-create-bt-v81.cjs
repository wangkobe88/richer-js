// 一次性：克隆 bt-v80（7a8ac18a）为 bt-v81 完整重跑——config 整包原样（copy-in 快照），
// 仅 experiment_name/description/config.name 标注区分；status 走 DB 默认初值。
// 背景：bt-v80 首跑 20%（15000/74821）中断 + 运行于 pre-BP40/CD380/BP41 代码；
// 重跑同 ID 会追加 created_at 相同（虚拟时钟）的信号行不可区分 → 用户裁定克隆新实验跑。
// 用法：node scripts/tmp-create-bt-v81.cjs [--commit]
const { dbManager } = require('../src/services/dbManager.js');

const SRC = '7a8ac18a-8002-4b8c-ba14-f5a71cda5677';
const NAME = 'bt-v81-完整窗口-ladder-v9-NLtick门-单卡0.05买4卡-BP41';
const DESC_SUFFIX = ' | 本行=bt-v80 完全相同配置克隆重跑（2026-11-07）：bt-v80 首跑 20%（15000/74821 tick）中断且运行于 pre-BP40/CD380/BP41 代码，本实验在 BP41 mapper 机械门+CD380 三不臂代码下跑完整窗口（cheat/BP persist 引擎注入隔离照旧）';

(async () => {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw error;
  const row = data[0];
  if (!row) throw new Error('源实验不存在');
  const desc = row.experiment_description + DESC_SUFFIX;
  const payload = {
    experiment_name: NAME,
    experiment_description: desc,
    trading_mode: row.trading_mode,
    strategy_type: row.strategy_type,
    blockchain: row.blockchain,
    kline_type: row.kline_type,
    config: { ...row.config, name: NAME, description: desc },
  };
  console.log('payload keys:', Object.keys(payload).join(', '));
  console.log('name:', payload.experiment_name);
  console.log('config.backtest:', JSON.stringify(payload.config.backtest));
  console.log('买腿数:', payload.config.strategiesConfig.buyStrategies.length,
    '| 卖腿数:', payload.config.strategiesConfig.sellStrategies.length);
  if (!process.argv.includes('--commit')) {
    console.log('[dry] 加 --commit 真正 INSERT');
    process.exit(0);
  }
  const ins = await c.from('experiments').insert(payload).select('id,status,created_at').single();
  if (ins.error) throw ins.error;
  console.log('新实验:', ins.data.id, 'status=', ins.data.status, 'created_at=', ins.data.created_at);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
