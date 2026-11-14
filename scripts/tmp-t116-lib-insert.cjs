// 临时脚本：strategy_library 入库 gmgn-entry-exit v1（T116 接线；dry-run 默认，--commit 执行 INSERT）
const path = require('path');
const { validateLegs, StrategyLibraryService } = require(path.join(__dirname, '../src/web/services/StrategyLibraryService.js'));

const COMMIT = process.argv.includes('--commit');

const LEGS = [
  {
    cards: 'all',
    priority: 6,
    condition: 'realHoldDuration >= 180 AND gmgnEntryChecked == 1 AND gmgnEntryPresent == 0',
    cooldownSec: null,
    description:
      'T116 GMGN 进场验证卖臂（2026-11-04）：持仓 180s 查一次 GMGN getTokenInfo wallet_tags_stat 三类在场数（smart_wallets/whale_wallets/renowned_wallets），三类全零=无聪明钱/鲸鱼/KOL 接力 → 全部清仓。探针实证 GMGN 对 0.3-1.0min 票 tags 已完整填充（18 秒票也 populate）=无「数据滞后退化成无脑全清」风险。write-once per 持仓轮（单向判定不翻案）；unknown（API 失败/超时/未索引/key 缺失/冷却/tags 三键残缺）fail-open 不投影 → gmgnEntryChecked==1 恒 false 不误卖；清仓自清理+再买入重置双保险+st 实例同一性竞态防线；回测零接线（因子恒 null 天然不触发）。「在场口径」自洽：进过已走=计 0=该卖形状。插位 pump-imbalance-exit(5) 之后；maxExecutions 刻意不设（卖出失败每轮重试直到清仓）；bypass=false 走 3.5s+5tick 双门确认。随 enabled 同开关带 T116b 买点观察帧（买入成功点另查一次落 signal metadata gmgnEntryObs 纯观察不进门，与 180s 检查点构成两帧对照）。详档 docs/交易策略改进与Case台账.md T116',
    bypassDebounce: false,
  },
];

(async () => {
  const check = validateLegs('sell', LEGS);
  console.log('validateLegs:', JSON.stringify(check));
  if (!check.valid) { console.error('❌ 校验失败'); process.exit(1); }

  const svc = new StrategyLibraryService();
  if (!COMMIT) {
    console.log('\n[dry] 未写库——加 --commit 执行 INSERT');
    // 防重：先查重名
    const { dbManager } = require(path.join(__dirname, '../src/services/dbManager.js'));
    const client = await dbManager.getClient();
    const { data } = await client.from('strategy_library').select('id,version').eq('name', 'gmgn-entry-exit');
    console.log('重名检查:', data && data.length ? JSON.stringify(data) : '无（可入库）');
    process.exit(0);
  }
  const row = await svc.create({ name: 'gmgn-entry-exit', description: '', side: 'sell', legs: LEGS });
  console.log('✅ 已入库:', JSON.stringify(row, null, 2));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
