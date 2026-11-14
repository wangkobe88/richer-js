// 创建回测模拟实验:8a51f2fd 绕过叙事门变体(cheat 门后处理剔除)
// 买腿改动仅两处:condition 删 rating 臂 + 删 narrativeTriggerCondition;其余(含 26 卖腿/卡牌/节流)bit 不变
const { randomUUID } = require('crypto');
const { dbManager } = require('../src/services/dbManager');
const SRC = '8a51f2fd-e467-4459-9004-18b9486ab567';
(async () => {
  const client = dbManager.getClient();
  const { data: src } = await client.from('experiments').select('config').eq('id', SRC).single();
  const cfg = JSON.parse(JSON.stringify(src.config));
  // 1) 买腿变体
  const leg = cfg.strategiesConfig.buyStrategies[0];
  const BEFORE = leg.condition;
  const RATING_ARM = '(narrativeRating == 2 OR narrativeRating == 3) AND ';
  if (!BEFORE.includes(RATING_ARM)) { console.error('rating 臂未找到,中止'); process.exit(1); }
  leg.condition = BEFORE.replace(RATING_ARM, '');
  delete leg.narrativeTriggerCondition;
  leg.description = '[SIM 绕过叙事] ' + String(leg.description || '').slice(0, 200);
  console.log('变体 condition:', leg.condition);
  console.log('trigger 字段已删:', leg.narrativeTriggerCondition === undefined);
  console.log('cheatCheckCondition 保留:', leg.cheatCheckCondition);
  console.log('gmgnCheckCondition 保留:', leg.gmgnCheckCondition);
  // 2) 删钱包段(回测无用)
  delete cfg.wallet;
  // 3) backtest 段(窗口=实验首日活跃窗 14:58→24:00 UTC)
  cfg.backtest = { sourceExperimentId: SRC, startTime: '2026-11-03T14:58:00Z', endTime: '2026-11-04T00:00:00Z' };
  const id = randomUUID();
  const row = {
    id,
    experiment_name: 'sim-8a51-bypass-narrative-v1',
    experiment_description: '模拟分析(非实盘):绕过叙事门,cheat 门后处理剔除;源=8a51f2fd 首日窗口 11-03 14:58→24:00 UTC;买腿=buy-v2 v56 删 rating 臂+删 trigger 字段,其余原样',
    status: 'created',
    config: cfg,
    trading_mode: 'backtest',
    blockchain: 'bsc',
    kline_type: cfg.kline_type || '1m',
  };
  const { error } = await client.from('experiments').insert(row);
  if (error) { console.error('INSERT ERR', error.message); process.exit(1); }
  console.log('CREATED sim experiment:', id);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
