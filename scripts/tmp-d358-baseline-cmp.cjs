// 一次性：D3.56/D3.57 基线 vs D3.58 八票档位对比（182 跑）
const runs = [
  ['D3.56(06:00Z)', '/home/ubuntu/richer-js/scripts/cheat-detection/data/cd-run-2026-11-04T06-00-28-449Z.json'],
  ['D3.57(07:12Z)', '/home/ubuntu/richer-js/scripts/cheat-detection/data/cd-run-2026-11-04T07-12-46-622Z.json'],
  ['D3.58(10:27Z)', '/home/ubuntu/richer-js/scripts/cheat-detection/data/cd-run-2026-11-04T10-27-34-767Z.json'],
];
const want = ['CD160', 'CD161', 'CD162', 'CD163', 'CD167', 'CD169', 'CD179', 'CD183'];
const EXPECT = { CD160: 'cheat', CD161: 'unhealthy', CD162: 'healthy', CD163: 'unhealthy', CD167: 'healthy', CD169: 'healthy', CD179: 'unhealthy', CD183: 'unclear' };

function pick(r) {
  const lv = (r.interp && r.interp.extLevels) || {};
  const ph = (r.interp && r.interp.phenomena) || {};
  const an = r.anchors || {};
  const stall = an.postStallSpanSec != null ? ` 段=${an.postStallSpanSec}s/eq簇${an.postStallEqualClusterPct}%/新${an.postStallFreshBuyerPct}%` : '';
  return `grade=${r.grade} eq=${ph.equal_amount_split} sb=${ph.coordinated_sell_back} sd=${ph.sell_dispersion} sbw=${lv.stall_burst_wave} tier=${lv.amount_tiering} pump=${lv.slow_grind_pump} hold=${lv.holdings_balance} act=${lv.activity_level}${stall} ${(r.gradeReasons || []).join(';')}`;
}

for (const [tag, f] of runs) {
  const d = require(f);
  console.log(`== ${tag} ==`);
  for (const id of want) {
    const r = d.results.find(x => x.caseId === id);
    console.log(` ${id} (expect=${EXPECT[id]}): ` + (r ? pick(r) : '(不在本 run)'));
  }
}
