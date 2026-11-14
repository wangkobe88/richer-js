// 一次性：创建 bt-v80 完整窗口回测实验——bt-v79 基础上两改（2026-11-07 用户裁定）：
//   ① 卡牌买入形状修正：买腿 cards=4 + perCardBNB 0.001→0.05（每笔 0.2 BNB）
//      ——bt-v79（及 v74 live 原配置）买腿无 cards 字段=默认 1 卡，持 1 卡时
//      任何「卖 1 卡」腿 min(1,1)=清光，卡牌阶梯退化成整仓倒（31 卖全部
//      before:1→after:0 零票多卖实证）；4 卡下「卖 1 卡」=25% 仓位，阶梯生效
//   ② 买腿换库 ladder v9（version 10）：NL 三臂加 tradeCount>=10 tick 数源头门
//      （FA tickCount≡tradeCount 恒等，锚窗必过 minTicks=8）
// 卖腿=v74 16 腿卡牌阶梯（bt-v79 已带）；BP10/CD379/窗口/节流全部继承。
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const crypto = require('crypto');

const BT79 = '1b1f9ee3-0e9a-4fda-82de-121e968be45b';

(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  const { data: s79, error: e1 } = await db.from('experiments').select('config').eq('id', BT79).limit(1);
  if (e1) throw new Error('读 bt79: ' + e1.message);
  const cfg = JSON.parse(JSON.stringify(s79[0].config));

  // 库最新 ladder（v9=version 10）copy-in，全腿加 cards:4
  const { data: lib, error: e2 } = await db.from('strategy_library')
    .select('id,name,version,legs').eq('name', 'signal-source-ladder-v1')
    .order('version', { ascending: false }).limit(1);
  if (e2) throw new Error('读库: ' + e2.message);
  if (!lib.length || lib[0].version < 10) throw new Error(`库版本预期 >=10 实得 ${lib[0] && lib[0].version}`);
  const legs = JSON.parse(JSON.stringify(lib[0].legs));
  for (const b of legs) {
    b.cards = 4;
    const cond = b.condition || '';
    if (/^tradeCount >= 10 AND buyVolumeBnb >= (1\.5|2|2\.5)/.test(cond)) continue; // NL v9 带 tick 门
  }
  const nlN = legs.filter((b) => /currentVsLaunchPct/.test(b.condition || '')).length;
  if (legs.length !== 10) throw new Error(`买腿预期 10 实得 ${legs.length}`);
  if (nlN !== 3) throw new Error(`NL 臂预期 3 实得 ${nlN}`);
  const tickGateN = legs.filter((b) => /currentVsLaunchPct/.test(b.condition) && /tradeCount >= 10/.test(b.condition)).length;
  if (tickGateN !== 3) throw new Error(`NL tick 门预期 3 实得 ${tickGateN}`);
  if (legs.some((b) => b.cards !== 4)) throw new Error('买腿 cards=4 校验失败');
  cfg.strategiesConfig.buyStrategies = legs;

  // 卡牌单卡金额 0.05（用户裁定「单卡 0.05 BNB好了，买入 4 卡」→ 每笔 0.2 BNB）
  if (!(cfg.positionManagement && cfg.positionManagement.perCardBNB)) throw new Error('positionManagement.perCardBNB 缺失');
  cfg.positionManagement.perCardBNB = 0.05;

  const sells = (cfg.strategiesConfig.sellStrategies || []);
  if (sells.length !== 16) throw new Error(`卖腿预期 16 实得 ${sells.length}`);

  cfg.name = 'bt-v80-完整窗口-ladder-v9-NLtick门-单卡0.05买4卡';
  cfg.description = 'T122/CD379/BP10 + 卡牌形状修正：2026-11-05 完整窗口（00:00:00Z→13:45:10Z）回测'
    + '（对照 bt-v78/bt-v79），在 bt-v79（v74 全量 16 卖腿+BP10 数据不足拒）基础上两改：'
    + '①卡牌买入形状——买腿 cards=4 + perCardBNB 0.05（每笔 0.2 BNB；bt-v79 买腿无 cards=1 卡，'
    + '「卖 1 卡」即清光，31 卖全 before:1→after:0 零票多卖=阶梯退化实证）；'
    + '②买腿换库 ladder v9（version 10）：NL 三臂加 tradeCount>=10（FA tickCount≡tradeCount，'
    + '锚窗必过 minTicks=8，封堵 bt-v78 53/114 insufficient_ticks 漏网主源头）；'
    + 'backtest.signalGateReal 门链真调；缓存复用；基座 config=bt-v79 1b1f9ee3 / '
    + '买腿源=库 signal-source-ladder-v1 version 10';

  const id = crypto.randomUUID();
  const { error: e3 } = await db.from('experiments').insert({
    id, experiment_name: cfg.name, experiment_description: cfg.description,
    trading_mode: 'backtest', status: 'created', config: cfg,
    blockchain: 'bsc', strategy_type: 'signal_gate',
  });
  if (e3) throw new Error('INSERT: ' + e3.message);
  console.log('INSERTED bt-v80:', id);
  console.log('买腿', legs.length, '(全 cards=4, NL tick 门', tickGateN + ') | 卖腿', sells.length,
    '| perCardBNB=', cfg.positionManagement.perCardBNB, '| window:', cfg.backtest.startTime, '→', cfg.backtest.endTime);
  for (const b of legs) console.log(`  p${b.priority} cards=${b.cards} | ${b.condition}`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
