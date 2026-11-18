// 一次性诊断：bt-v140 票 0x9aac…7777 为何没被 famous 因子门拦住
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x9aac702075981f263e699fd1413f340742107777';
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b'; // bt-v140

(async () => {
  const c = await dbManager.getClient();

  // 1) 实验行
  const { data: exp } = await c.from('experiments')
    .select('id,experiment_name,trading_mode,status,config').eq('id', EXP).limit(1);
  const e = exp[0];
  console.log(`实验: ${e.experiment_name} mode=${e.trading_mode} status=${e.status}`);
  const cfg = e.config || {};
  const sc = cfg.strategiesConfig || {};
  console.log(`买腿数=${(sc.buyStrategies||[]).length}（famous 条件引用=${(sc.buyStrategies||[]).some(l=>/famous/i.test(JSON.stringify(l)))}）`);

  // 2) 该 token 信号行
  const { data: sigs } = await c.from('strategy_signals')
    .select('id,signal_type,action,execution_status,created_at,metadata,strategy_id')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  console.log(`\n信号行数=${sigs.length}`);
  for (const s of sigs) {
    console.log(`\n=== signal ${s.id} ${s.signal_type}/${s.action} ${s.execution_status} ${s.created_at} strategy=${s.strategy_id} reason=${s.reason}`);
    const md = s.metadata || {};
    // 找 famous 相关键
    const findF = (o, path = '', out = []) => {
      if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o)) {
          const p = path ? `${path}.${k}` : k;
          if (/famous/i.test(k)) out.push([p, v]);
          if (v && typeof v === 'object') findF(v, p, out);
        }
      }
      return out;
    };
    const fkeys = findF(md);
    for (const [p, v] of fkeys) console.log(`  ${p} = ${JSON.stringify(v)}`);
    // 因子快照里的门相关值
    const snap = md.factorResults || md.factors || null;
    if (snap) {
      const keys = ['famousCopyWalletCircPct','copyWalletMaxHolderCircPct','sybilClusterHolderCircPct','currentVsLaunchPct','tradeCount','buyVolumeBnb','tokenAgeSec','cheatGrade','launchBundleClusterSize','launchFirstBlockWallets','launchFirstWaveWallets','launchMinVsFloorPct'];
      console.log('  -- factor snapshot --');
      for (const k of keys) if (k in snap) console.log(`     ${k} = ${snap[k]}`);
    }
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
