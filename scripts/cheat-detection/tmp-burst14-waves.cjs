// 一次性（182 跑，只读）：族三 burst 14 票信号 metadata 波形状取证——
// 每票抽 cheatCheck.anchors 波族（gap/buy/wallets/exitVs/startVs）+ levels.sbw + grade/exempt
// + 活跃度族 spanSec/tickCount/idlePct（判定「跨度太长到下跌期」的波→锚点时距证据）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');

const IDS = [
  ['19', '5c953aeb-70a6-47b3-aa52-0c3943df267d'],
  ['62', '258ae2a7-2d42-4ae6-9352-5e37e9f1954a'],
  ['63', '49786f0b-5a4b-4a08-b216-67605584c1b4'],
  ['69', '3b2d3161-4f83-4dda-9e76-c7a2fa202515'],
  ['72', '3f858dea-15ad-4df6-82d5-70932493f11c'],
  ['81', '215f9bff-2f98-4094-8da1-2860fe3b9440'],
  ['96', '4d8d73f9-e73e-401e-aa1a-9097284d5eb6'],
  ['123', '473b37c1-9c61-4bc0-a017-60111fb00413'],
  ['124', '18c18419-fd22-4ad1-bdaa-24175c8f370a'],
  ['130', '1e24d257-b729-4454-9d03-5cd9eb487150'],
  ['170', '300d26d4-98cc-4fcc-88ea-0672a39d71c8'],
  ['174', '14c57c46-9557-4572-a1e3-2d8a9dfcadf2'],
  ['179', '25f06452-ad05-4454-afd7-8fa9a9464ff5'],
  ['191', '6ef037d6-5318-4d3e-846f-90fb08bfb160'],
];

async function main() {
  const sb = await dbManager.getClient();
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('id,created_at,metadata')
    .in('id', IDS.map((x) => x[1]));
  if (error) throw new Error(error.message);
  const byId = new Map(sigs.map((s) => [s.id, s]));
  const rows = [];
  for (const [idx, id] of IDS) {
    const s = byId.get(id);
    if (!s) { console.log(idx, 'SIGNAL NOT FOUND'); continue; }
    const md = s.metadata || {};
    const cc = md.cheatCheck || {};
    const an = (cc.anchors) || {};
    const act = cc.activityLevel || (cc.buckets && cc.buckets.activityLevel);
    rows.push({
      idx,
      grade: cc.grade,
      sbw: cc.levels && cc.levels.stallBurstWave,
      exempt: cc.exempt ? cc.exempt.code : (cc.exemptDenied || null),
      gap: an.burstMaxGapSec, buy: an.burstWaveBuyBnb, wallets: an.burstWaveWallets,
      exitVs: an.burstExitVsLaunchPct, startVs: an.burstWaveStartVsLaunchPct,
      act, spanSec: an.spanSec, ticks: an.tickCount, idlePct: an.idlePct,
      curVs: an.curVsLaunchPct, minVs: an.minVsLaunchPct,
      win30BuyN: an.win30BuyN, win30SellN: an.win30SellN,
    });
  }
  console.log('idx | grade | sbw | 豁免码 | gap | 波B | 波钱包 | exitVs | act | spanSec | ticks | idle% | curVs | minVs | w30买/卖');
  for (const r of rows) {
    console.log([r.idx, r.grade, r.sbw, r.exempt, r.gap, r.buy, r.wallets, r.exitVs, r.act, r.spanSec, r.ticks, r.idlePct, r.curVs, r.minVs, (r.win30BuyN ?? '-') + '/' + (r.win30SellN ?? '-')].join(' | '));
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
