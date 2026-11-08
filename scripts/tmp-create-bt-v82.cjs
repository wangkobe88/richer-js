// 一次性：克隆 bt-v81（a5b43ad1）为 bt-v82 完整重跑——config 整包原样（copy-in 快照），
// 仅 experiment_name/description/config.name 标注区分；status 走 DB 默认初值。
// 背景：bt-v81 运行于 CD380 首版（moderate 档+wash 三键臂）代码；其后两轮用户裁定修正
// （3f1a79a2 三臂统一 strong 档 / eb772c4a wash 臂收窄仅 washPair 同区块刷量）落地后重跑，
// 对拍豁免/exemptDenied 分布与六判例拦截、盈亏变化。重跑同 ID 会追加 created_at 相同
// （虚拟时钟）的信号行不可区分 → 沿用克隆新实验先例。
// 用法：node scripts/tmp-create-bt-v82.cjs [--commit]
const { dbManager } = require('../src/services/dbManager.js');

const SRC = 'a5b43ad1-78b0-450e-bd9d-3dde74fbf713';
const NAME = 'bt-v82-完整窗口-CD380修正复跑-strong档-wash仅同块对敲';
const DESC_SUFFIX = ' | 本行=bt-v81 完全相同配置克隆重跑（2026-11-08）：bt-v81 运行于 CD380 首版（moderate 档+wash 三键臂），本实验在 CD380 两轮修正（三臂统一 strong 档+wash 臂收窄仅 washPair 同区块刷量）代码下跑完整窗口（cheat/BP persist 引擎注入隔离照旧）';

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
  if (error) throw ins.error;
  console.log('新实验:', ins.data.id, 'status=', ins.data.status, 'created_at=', ins.data.created_at);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
