// bt-v135 克隆脚本：bt-v134 同窗口 + v22 库 + FP4 因子门 + bundle-wave-exit + roster v8
const { dbManager } = require('../src/services/dbManager.js');

const BASE = '19ef6433-0c92-47ff-a6fd-9f6bea745b8d';
const NAME = 'bt-v135-postreview-fp4';

async function main() {
  const c = await dbManager.getClient();
  const { data: base, error } = await c.from('experiments').select('*').eq('id', BASE).single();
  if (error) throw new Error(error.message);

  const cfg = JSON.parse(JSON.stringify(base.config)); // deep clone
  // 改名
  // 重建库引用快照（copy-in 从库读最新版——v22 ladder + bundle-wave-exit + famous-entry-exit v2）
  const { data: libs, error: libErr } = await c.from('strategy_library')
    .select('id,name,side,version,legs,description')
    .in('name', ['signal-source-ladder-v1','famous-entry-exit','bundle-wave-exit','peak-protect-exit','mcap-arc-fullclose','pump-imbalance-exit'])
    .order('version', { ascending: false });
  if (libErr) throw new Error(libErr.message);

  // per name 取最新版
  const bestByName = {};
  for (const l of libs || []) {
    if (!bestByName[l.name] || l.version > bestByName[l.name].version) bestByName[l.name] = l;
  }

  // 重建 strategiesConfig.libraryRefs + buyStrategies + sellStrategies
  const buyLegs = bestByName['signal-source-ladder-v1'] ? bestByName['signal-source-ladder-v1'].legs : [];
  const sellLegs = [];
  for (const n of ['famous-entry-exit','bundle-wave-exit','peak-protect-exit','mcap-arc-fullclose','pump-imbalance-exit']) {
    if (bestByName[n]) sellLegs.push(...bestByName[n].legs);
  }

  cfg.strategiesConfig = cfg.strategiesConfig || {};
  cfg.strategiesConfig.libraryRefs = Object.fromEntries(
    Object.entries(bestByName).map(([n, l]) => [n, { libraryId: l.id, version: l.version }])
  );
  cfg.strategiesConfig.buyStrategies = buyLegs;
  cfg.strategiesConfig.sellStrategies = sellLegs;

  // 开因子门（FP4：PVP + act + famous 两法 + CD 四臂 + CD412 极端砸盘）
  cfg.buyPointCheck = cfg.buyPointCheck || {};
  cfg.buyPointCheck.factorCheck = { enabled: true };

  // 确认 cheat/BP 门也开
  cfg.cheatCheck = cfg.cheatCheck || {};
  cfg.cheatCheck.enabled = true;
  cfg.buyPointCheck.enabled = true;

  // 实验名
  const insert = {
    experiment_name: NAME,
    trading_mode: 'virtual',
    status: 'created',
    config: cfg,
  };
  const { data: created, error: insErr } = await c.from('experiments').insert(insert).select('id,experiment_name').single();
  if (insErr) throw new Error(insErr.message);
  console.log('created:', created.id, created.experiment_name);
  console.log('buyLegs:', buyLegs.length, 'sellLegs:', sellLegs.length);
  console.log('libRefs:', Object.keys(cfg.strategiesConfig.libraryRefs));
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
