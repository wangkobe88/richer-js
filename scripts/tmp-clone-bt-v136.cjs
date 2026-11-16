// bt-v136 克隆脚本：4dddbcf8（bt-v135，已含全部就地修复）config 为基底 + ladder v23（T149 年龄臂换锚）
const { dbManager } = require('../src/services/dbManager.js');

const BASE = '4dddbcf8-ccc3-4e39-b203-bf138e05edd8';
const NAME = 'bt-v136-postreview-v23';

async function main() {
  const c = await dbManager.getClient();
  const { data: base, error } = await c.from('experiments').select('*').eq('id', BASE).single();
  if (error) throw new Error(error.message);

  const cfg = JSON.parse(JSON.stringify(base.config)); // deep clone

  // 拉库最新 ladder（v23）
  const { data: libs, error: libErr } = await c.from('strategy_library')
    .select('id,name,side,version,legs')
    .eq('name', 'signal-source-ladder-v1')
    .order('version', { ascending: false })
    .limit(1);
  if (libErr) throw new Error(libErr.message);
  const ladder = libs[0];
  if (!ladder || ladder.version < 23) throw new Error(`库 ladder 版本 ${ladder?.version} < 23，先在 182 --commit`);
  if (!ladder.legs.every(l => (l.condition || '').includes('sinceFirstTradeSec > 45'))) {
    throw new Error('库 ladder 腿未含 sinceFirstTradeSec > 45 门串');
  }

  // v23 腿 copy-in + 回测口径 cards:4（库腿不带 cards——回测卡牌形状与 bt-v135 一致）
  const buyLegs = ladder.legs.map(l => ({ ...l, cards: 4 }));
  cfg.strategiesConfig.buyStrategies = buyLegs;
  cfg.strategiesConfig.libraryRefs['signal-source-ladder-v1'] = { libraryId: ladder.id, version: ladder.version };

  const insert = {
    experiment_name: NAME,
    trading_mode: 'backtest',  // ★回测实验必须 backtest——run-engine 按 DB 列分派引擎，误写 virtual=实时虚拟盘（bt-v135 事故：15:31 起误跑 28min 烧实时叙事 API）
    status: 'created',
    config: cfg,
  };
  const { data: created, error: insErr } = await c.from('experiments').insert(insert).select('id,experiment_name').single();
  if (insErr) throw new Error(insErr.message);
  console.log('created:', created.id, created.experiment_name);
  console.log('buyLegs:', buyLegs.length, '| cards:', buyLegs.map(l => l.cards).join(','));
  console.log('ladder version:', ladder.version);
  console.log('p1 cond tail:', buyLegs[0].condition.slice(-140));
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
