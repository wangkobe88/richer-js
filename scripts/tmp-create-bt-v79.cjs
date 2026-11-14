// 一次性：创建 bt-v79 完整窗口回测实验——bt-v78 基础上两改（2026-11-07 用户裁定）：
//   ① 卖腿换 v74 live 全量 16 腿卡牌阶梯（bt-v78 只抄了 3 条全清臂=任何退出
//      都整仓倒；live 是「1 卡/2 卡/全清」混合逐步卖出——止损双腿/毕业两档/
//      止盈卡牌阶梯/回撤族），perCardBNB=0.001 不变
//   ② BP10 翻案：insufficient_ticks 数据不足=挡住（bp_gate_insufficient_ticks
//      拒，不再放行；例票 0x18cf6407 anchorTickCount=3 放行买入 15s 后止损）
// 买腿/窗口/豁免/节流帽全部同 bt-v78（ladder v8 十腿+CD379 活跃度豁免）。
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const crypto = require('crypto');

const BT78 = '3172f028-56e7-4301-9d7b-b2e9c8cb5735';
const V74 = '7cb423af-9505-47c6-a200-79f77139908a';

(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  const { data: s78, error: e1 } = await db.from('experiments').select('config').eq('id', BT78).limit(1);
  if (e1) throw new Error('读 bt78: ' + e1.message);
  const cfg = JSON.parse(JSON.stringify(s78[0].config));

  const { data: s74, error: e2 } = await db.from('experiments').select('config').eq('id', V74).limit(1);
  if (e2) throw new Error('读 v74: ' + e2.message);
  const v74cfg = s74[0].config;
  const sells = JSON.parse(JSON.stringify((v74cfg.strategiesConfig && v74cfg.strategiesConfig.sellStrategies) || []));
  if (sells.length !== 16) throw new Error(`v74 卖腿预期 16 实得 ${sells.length}`);
  for (const s of sells) {
    if (s.cards === undefined) throw new Error(`v74 卖腿缺 cards: ${s.condition}`);
    if (s.bypassDebounce === undefined) s.bypassDebounce = false;
  }
  // 卡牌分布 sanity：1 卡/2 卡/全清混合
  const dist = {};
  for (const s of sells) dist[String(s.cards)] = (dist[String(s.cards)] || 0) + 1;
  console.log('v74 卖腿卡牌分布:', JSON.stringify(dist));

  cfg.strategiesConfig.sellStrategies = sells;
  if (!(cfg.positionManagement && cfg.positionManagement.perCardBNB > 0)) {
    throw new Error('perCardBNB 缺失——卡牌机制未开，卖腿 cards 无效');
  }
  const buyN = (cfg.strategiesConfig.buyStrategies || []).length;
  if (buyN !== 10) throw new Error(`买腿预期 10 实得 ${buyN}`);

  cfg.name = 'bt-v79-完整窗口-ladder-v8十腿-豁免-v74全量卖腿-BP10数据不足拒';
  cfg.description = 'T122/CD379/BP10：2026-11-05 完整窗口（00:00:00Z→13:45:10Z）回测（对照 bt-v77 七腿/bt-v78），'
    + '在 bt-v78（ladder v8 十腿 NL 三臂+cheat 门活跃度豁免）基础上两改：'
    + '①卖腿换 v74 live 全量 16 腿卡牌阶梯（1 卡/2 卡/全清混合逐步卖出——bt-v78 只带 3 条全清臂'
    + '任何退出整仓倒，用户裁定参考 live 卡牌设置）；'
    + '②BP10 翻案：insufficient_ticks 数据不足=挡住拒单不放行（例票 0x18cf6407 '
    + 'anchorTickCount=3 放行买入 15s 后止损）；backtest.signalGateReal 门链真调；'
    + '缓存复用（无 forceRefresh）；基座 config=bt-v78 3172f028 / 卖腿源=v74 7cb423af';

  const id = crypto.randomUUID();
  const { error: e3 } = await db.from('experiments').insert({
    id, experiment_name: cfg.name, experiment_description: cfg.description,
    trading_mode: 'backtest', status: 'created', config: cfg,
    blockchain: 'bsc', strategy_type: 'signal_gate',
  });
  if (e3) throw new Error('INSERT: ' + e3.message);
  console.log('INSERTED bt-v79:', id);
  console.log('买腿', buyN, '| 卖腿', sells.length, '| window:', cfg.backtest.startTime, '→', cfg.backtest.endTime);
  sells.sort((a, b) => (a.priority || 0) - (b.priority || 0));
  for (const s of sells) console.log(`  p${s.priority} cards=${JSON.stringify(s.cards)} cd=${s.cooldownSec} maxEx=${s.maxExecutions !== undefined ? s.maxExecutions : '-'} | ${(s.condition || '').slice(0, 80)}`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
