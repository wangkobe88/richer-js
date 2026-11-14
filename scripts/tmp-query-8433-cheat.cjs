// 一次性查询：0x84331f9f0546ef8896ceb5451ad86e63fb7f7777 生产 cheat 行与信号（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x84331f9f0546ef8896ceb5451ad86e63fb7f7777';
const EXP = 'f0898589-58f1-4101-a648-0dc9cad41f3a';

async function main() {
  const client = await dbManager.getClient();

  const { data: rows, error: e1 } = await client
    .from('cheat_detection')
    .select('id,verdict,fail_reason,question_version,anchor_tick_count,source_experiment_id,analyzed_at,snapshot_digest')
    .eq('token_address', ADDR)
    .order('analyzed_at', { ascending: true })
    .limit(50);
  if (e1) throw e1;
  console.log(`cheat_detection 共 ${rows ? rows.length : 0} 行`);
  for (const r of rows || []) {
    console.log(`\n=== #${r.id} qv=${r.question_version} verdict=${r.verdict} fail=${r.fail_reason ?? '-'} at=${r.analyzed_at} anchor=${r.anchor_tick_count ?? '-'} ===`);
    const d = typeof r.snapshot_digest === 'string' ? JSON.parse(r.snapshot_digest) : r.snapshot_digest;
    if (d) {
      console.log(`grade=${d.grade ?? '-'} reasons=${JSON.stringify(d.gradeReasons)}`);
      console.log(`levels: ${JSON.stringify(d.levels)}`);
      const a = d.anchors || {};
      const keys = ['pumpStablePoints','pumpStableSpanSec','pumpStableR2','pumpStableSlopePctPerMin','pumpRisePerBuyBnb','pumpSellTickCountPct','burstMaxGapSec','burstWaveBuyBnb','burstWaveWallets','noBuySellPct','sbHoldPct','eqHoldPct'];
      console.log('anchors:', keys.map(k => k + '=' + (a[k] ?? '-')).join(' '));
      console.log(`activity: ${JSON.stringify(d.activity)}`);
    }
  }

  const { data: sigs, error: e2 } = await client
    .from('strategy_signals')
    .select('id,signal_type,action,created_at,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e2) throw e2;
  console.log(`\nstrategy_signals 共 ${sigs ? sigs.length : 0} 行`);
  for (const s of sigs || []) {
    const cc = s.metadata && s.metadata.cheatCheck;
    console.log(`#${s.id} ${s.signal_type} ${s.action} at=${s.created_at} cheatCheck=${cc ? JSON.stringify({status: cc.status, grade: cc.grade, reasons: cc.gradeReasons, cached: cc.cached, qv: cc.gradeVersion}) : '-'}`);
  }
  await dbManager.close?.();
}

main().catch(e => { console.error(e); process.exit(1); });
