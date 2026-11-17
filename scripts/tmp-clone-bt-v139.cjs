// bt-v139 克隆脚本：bt-v138（T151 推迟臂已含 stallClose 40s/0.01+卖臂裁剪）config 为基底 + ladder v27（豁免臂 <10→<5 + DELAY_GATE 加豁免臂）
const { dbManager } = require('../src/services/dbManager.js');

const BASE = '341dd3af-fe17-430f-9fbb-490b4f4e42d0';
const NAME = 'bt-v139-ladder-v27';

async function main() {
  const c = await dbManager.getClient();
  const { data: base, error } = await c.from('experiments').select('*').eq('id', BASE).single();
  if (error) throw new Error(error.message);

  const cfg = JSON.parse(JSON.stringify(base.config)); // deep clone

  // 拉库最新 ladder（v27）
  const { data: libs, error: libErr } = await c.from('strategy_library')
    .select('id,name,side,version,legs')
    .eq('name', 'signal-source-ladder-v1')
    .order('version', { ascending: false })
    .limit(1);
  if (libErr) throw new Error(libErr.message);
  const ladder = libs[0];
  if (!ladder || ladder.version < 27) throw new Error(`库 ladder 版本 ${ladder?.version} < 27，先在 182 --commit`);

  // v27 门串校验：p1 腿 launchMinVsFloorPct < 5 恰 2 处（CLUSTER_GATE + DELAY_GATE）
  const p1 = ladder.legs.find(l => (l.name || '').includes('t0')) || ladder.legs[0];
  const hits = (p1.condition.match(/launchMinVsFloorPct < 5/g) || []).length;
  if (hits !== 2) throw new Error(`p1 腿 launchMinVsFloorPct < 5 出现 ${hits} 次（期望 2：盘型门+推迟门豁免臂）`);
  const noDelay = ladder.legs.find(l => l.condition.includes('launchBigBuyBnb'));
  if (!noDelay || !noDelay.condition.includes('OR launchMinVsFloorPct < 5')) {
    throw new Error('DELAY_GATE 豁免臂缺失');
  }

  // v27 腿 copy-in + 回测口径 cards:4
  const buyLegs = ladder.legs.map(l => ({ ...l, cards: 4 }));
  cfg.strategiesConfig.buyStrategies = buyLegs;
  cfg.strategiesConfig.libraryRefs['signal-source-ladder-v1'] = { libraryId: ladder.id, version: ladder.version };

  const insert = {
    experiment_name: NAME,
    trading_mode: 'backtest',  // ★回测实验必须 backtest——run-engine 按 DB 列分派引擎
    status: 'created',
    config: cfg,
  };
  const { data: created, error: insErr } = await c.from('experiments').insert(insert).select('id,experiment_name').single();
  if (insErr) throw new Error(insErr.message);
  console.log('created:', created.id, created.experiment_name);
  console.log('buyLegs:', buyLegs.length, '| ladder version:', ladder.version);
  console.log('p1 cond tail:', p1.condition.slice(-260));
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
