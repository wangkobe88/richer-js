const { dbManager } = require('../src/services/dbManager');
(async () => {
  const c = dbManager.getClient();
  // bt-v153 的 factorSellFilter 配置现状（回测侧 recoveryHold 是否会生效）
  const { data } = await c.from('experiments').select('*,config').eq('id', 'd3453504-03d5-480c-89e0-483db930361c').single();
  const fsf = data.config.fourmemeWs?.factorSellFilter;
  console.log('bt-v153 factorSellFilter:', JSON.stringify(fsf));
  // 生产 running 虚拟实验有无 factorSellFilter
  const { data: running } = await c.from('experiments').select('id,experiment_name,status,config').eq('status', 'running').limit(5);
  for (const e of running || []) {
    console.log('running:', e.experiment_name, '| fsf:', JSON.stringify(e.config?.fourmemeWs?.factorSellFilter ?? null));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
