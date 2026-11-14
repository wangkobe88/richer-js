// 一次性查询：v70 六票生产 cheat_detection 全部行（grade 轨迹+题档位+锚+qv）——生产 vs 对拍不一致排查
const { dbManager } = require('../src/services/dbManager.js');

const TOKENS = {
  CD165: '0x7c1e61ce0caa3a74d0bd2a01c0d0690e79a57777',
  CD166: '0xea44b0c60475cca4ad0f86790735af115e3c7777',
  CD167: '0xe931945a412fee281789bb495434eb61deae7777',
  CD169: '0x65a4c2da0aa16945cdf610c012d71c5906017777',
  CD170: '0xdd42eec51757028333981d342d302807b3957777',
  CD172: '0xa3c24f0c1fee7840967a440e5c34b18369767777',
};

async function main() {
  const client = await dbManager.getClient();
  const { data, error } = await client
    .from('cheat_detection')
    .select('token_address,analyzed_at,question_version,anchor_tick_count,fail_reason,snapshot_digest')
    .in('token_address', Object.values(TOKENS))
    .order('analyzed_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  const byAddr = new Map(Object.entries(TOKENS).map(([k, v]) => [v, k]));
  for (const r of data || []) {
    const id = byAddr.get(r.token_address) || r.token_address.slice(0, 8);
    let grade = null, reasons = null, levels = null, anchors = {};
    try {
      const d = typeof r.snapshot_digest === 'string' ? JSON.parse(r.snapshot_digest) : (r.snapshot_digest || {});
      grade = d.grade ?? null; reasons = d.gradeReasons ?? null;
      levels = d.levels ?? d.observation?.levels ?? null;
      anchors = d.anchors ?? d.observation?.anchors ?? {};
    } catch { /* digest 解析失败照输出 */ }
    console.log(`${id} | ${r.analyzed_at} | qv=${r.question_version} | 锚=${r.anchor_tick_count} | grade=${grade}${r.fail_reason ? ' | fail=' + r.fail_reason : ''}`);
    if (reasons) console.log(`   reasons=${JSON.stringify(reasons)}`);
    if (levels) console.log(`   levels=${JSON.stringify(levels)}`);
    console.log(`   anchors: act=${anchors.activityLevel ?? '-'} bd=${anchors.bundledDominance ?? '-'} burstGap=${anchors.burstMaxGapSec ?? '-'} burstBuy=${anchors.burstWaveBuyBnb ?? '-'} burstW=${anchors.burstWaveWallets ?? '-'} noBuySell=${anchors.noBuySellPct ?? '-'} t1=${anchors.top1HoldSupplyPct ?? '-'} wash=${anchors.washPairCount ?? '-'}/${anchors.washPairSellPct ?? '-'}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
