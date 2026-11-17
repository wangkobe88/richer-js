// C 窗 v20 挡票 FA 形状取证（2026-11-15，182 跑）：ASTER/BEAGLE/驴党/ZCASHERS 四票
// 在 v124 基线的首 BUY 信号 metadata 因子快照——launchFirstBlockWallets/Wave/簇/age 离阈值多远。
const { dbManager } = require('../src/services/dbManager.js');

const TOKENS = [
  ['ASTER', '0x31e2037870d82ba8b634287f972ec926373a7777'],
  ['BEAGLE', '0xa2713f130c9de5114a7b60a20b249ee9887a7777'],
  ['驴党', '0x34eb3b2fd45af11af4d9edbac5beb1fb40c87777'],
  ['ZCASHERS', '0x6665210299b7612d72804ed250c35d8f45f67777'],
];

async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('id,experiment_name').limit(500);
  const v124 = exps.find((e) => e.id.startsWith('cd40fc2a')).id;
  for (const [sym, addr] of TOKENS) {
    const { data: sig, error } = await c.from('strategy_signals')
      .select('created_at,executed,metadata')
      .eq('experiment_id', v124).eq('token_address', addr).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).limit(1);
    if (error) throw new Error(sym + ': ' + error.message);
    if (!sig || !sig[0]) { console.log(`${sym}: v124 无 BUY 信号行`); continue; }
    const m = sig[0].metadata || {};
    const f = m.factorResults || m.factors || m.factorSnapshot || null;
    const pick = (o) => o ? {
      f0: o.launchFirstBlockWallets, wave: o.launchFirstWaveWallets,
      clu: o.launchBundleClusterSize, age: o.tokenAgeSec, tc: o.tradeCount,
      curVs: o.currentVsLaunchPct, firstB: o.launchFirstBlockBuySharePct,
    } : null;
    console.log(`${sym} 首信号 ${sig[0].created_at} exec=${sig[0].executed}`);
    console.log('  metadata 顶层键:', Object.keys(m).join(','));
    const v = pick(f);
    if (v) console.log('  FA:', JSON.stringify(v));
    else {
      // 深找一层
      for (const [k, val] of Object.entries(m)) {
        if (val && typeof val === 'object' && ('launchFirstWaveWallets' in val || 'launchBundleClusterSize' in val)) {
          console.log(`  [${k}]:`, JSON.stringify(pick(val)));
        }
      }
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
