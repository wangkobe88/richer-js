// 侦察：当前 live 实验卖腿配置 + 引擎级 stopLoss 段（单行小读取）
const { dbManager } = require('../src/services/dbManager.js');

(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db.from('experiments')
    .select('id,name,platform,mode,status,created_at,config')
    .eq('mode', 'live')
    .order('created_at', { ascending: false })
    .limit(2);
  if (error) throw error;
  for (const e of data) {
    console.log(`\n=== ${e.id} [${e.name}] platform=${e.platform} status=${e.status} created=${e.created_at}`);
    const legs = e.config?.strategiesConfig?.legs || [];
    for (const l of legs) {
      const meta = [`side=${l.side}`, l.bypassDebounce !== undefined ? `bypass=${l.bypassDebounce}` : '', l.cards !== undefined ? `cards=${JSON.stringify(l.cards)}` : ''].filter(Boolean).join(' ');
      console.log(`--- ${l.name || '(unnamed)'} ${meta}`);
      if (l.side === 'sell' && l.condition) console.log(`    ${l.condition}`);
    }
    const sl = e.config?.strategiesConfig?.stopLoss || e.config?.stopLoss;
    console.log('stopLoss 段:', sl ? JSON.stringify(sl) : '（无）');
    const pm = e.config?.strategiesConfig?.positionManagement || e.config?.positionManagement;
    console.log('positionManagement:', pm ? JSON.stringify(pm) : '（无）');
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
