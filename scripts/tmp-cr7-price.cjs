const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
(async () => {
  const T = '0xe05dbebf96c62c377eb51d0c09e42e966c0f7777';
  // 1) BP 分析行（token 级全局表，看其它实验/时刻的判读与价格锚）
  const { data: bp, error: e1 } = await db.from('buy_point_analyses')
    .select('anchor_at,rule,assessment,exempt,digest').eq('token_address', T)
    .order('anchor_at', { ascending: true }).limit(10);
  if (e1) console.log('bp err', e1.message);
  else {
    console.log(`=== buy_point_analyses ${bp?.length ?? 0} 行 ===`);
    for (const r of bp || []) {
      const d = r.digest || {};
      console.log(`${r.anchor_at} | rule=${r.rule} assess=${JSON.stringify(r.assessment ?? null)} exempt=${JSON.stringify(r.exempt ?? null)} | curVs=${d.currentVsLaunchPct ?? d.curVsLaunchPct ?? '?'} minVs=${d.minVsLaunchPct ?? '?'}`);
    }
  }
  // 2) 全局信号（跨实验看此票生命周期价格）
  const { data: sigs, error: e2 } = await db.from('strategy_signals')
    .select('experiment_id,created_at,signal_type,executed,metadata').eq('token_address', T)
    .order('created_at', { ascending: true }).limit(30);
  if (e2) console.log('sig err', e2.message);
  else {
    console.log(`\n=== 全局信号 ${sigs?.length ?? 0} 条 ===`);
    for (const s of sigs || []) {
      const m = s.metadata || {};
      const price = m.price ?? m.currentPriceBnb ?? m.factorResults?.currentPriceBnb ?? '?';
      console.log(`${s.experiment_id?.slice(0, 8)} ${s.created_at} ${s.signal_type} ex=${s.executed} price=${price} curVs=${m.factorResults?.currentVsLaunchPct ?? '?'}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
