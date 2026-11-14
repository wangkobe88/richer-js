// 一次性（182 跑）：bt-v95 建实验前置侦查——查 bt-v94 配置与最近实验
const { dbManager } = require('../../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const { data: recent, error: e1 } = await c.from('experiments')
    .select('id,experiment_name,status,created_at').order('created_at', { ascending: false }).limit(12);
  if (e1) throw new Error(e1.message);
  console.log('== 最近实验 ==');
  for (const e of recent) console.log(e.id, '|', e.experiment_name, '|', e.status, '|', String(e.created_at).slice(0, 16));
  const { data: v94, error: e2 } = await c.from('experiments')
    .select('id,experiment_name,config').eq('id', '85cbad14-696f-49b2-baa4-a5407df4a2d2');
  if (e2) throw new Error(e2.message);
  if (!v94 || !v94.length) { console.log('bt-v94 id 无行'); process.exit(0); }
  const cfg = v94[0].config || {};
  const bt = cfg.backtest || {};
  console.log('== bt-v94', v94[0].experiment_name, '==');
  console.log('backtest keys:', Object.keys(bt).join(','));
  console.log('src:', bt.srcExperimentId || bt.sourceExperimentId || bt.baseExperimentId || '?');
  console.log('window:', bt.startTime || bt.from || '?', '→', bt.endTime || bt.to || '?');
  console.log('signalGateReal:', bt.signalGateReal, '| maxTickRows:', bt.maxTickRows);
  const fw = cfg.fourmemeWs || {};
  console.log('buySignalMaxPerToken:', fw.buySignalMaxPerToken, '| cheat.enabled:', !!(fw.cheatCheck && fw.cheatCheck.enabled), '| bp.enabled:', !!(fw.buyPointCheck && fw.buyPointCheck.enabled));
  console.log('platform:', cfg.platform, '| libRefs:', JSON.stringify((cfg.strategiesConfig && cfg.strategiesConfig.libraryRefs) || []));
  process.exit(0);
})().catch((x) => { console.error('FATAL', x.message); process.exit(1); });
