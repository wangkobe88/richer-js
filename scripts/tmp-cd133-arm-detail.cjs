// CD133 追问：猴子币（两臂票）/眉眉/其它 A_strong 详情——digest 锚值+首析触发 tick 序位
const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
const { gradeObservation } = require(path.join(__dirname, '../src/market-analysis/cheat-grade.js'));

const TARGETS = {
  '0xe8e0c873': '猴子币·两臂票',
  '0xd827bc26': '猴子币②',
  '0x5a3f19b5': '眉眉①',
  '0xce9943e7': '眉眉②',
  '0xb94bffc4': '眉眉③',
  '0x78bcf8ed': '眉眉④E',
  '0x779bf578': '眉眉⑤G失载',
  '0x8a6f725e': '에코①',
  '0x320b1f30': '에코②',
  '0x43705ac9': '에코③',
  '0xec74ec6b': 'RAM①C261b',
  '0x5151d305': 'RAM②',
  '0x53e2ac46': 'RAM③',
};

async function fetchAll(client) {
  const all = []; let from = 0;
  while (true) {
    const res = await client.from('cheat_detection')
      .select('token_address, analyzed_at, verdict, snapshot_digest')
      .eq('source_experiment_id', 'e3d00085-b796-4973-91fc-05013c438488')
      .order('analyzed_at', { ascending: true })
      .range(from, from + 199);
    if (res.error) throw new Error(res.error.message);
    all.push(...(res.data || []));
    if (!res.data || res.data.length < 200) break;
    from += 200;
  }
  return all;
}

function brief(dig) {
  const a = dig.anchors || {}, act = dig.activity || {}, fam = dig.famous || {};
  const p = dig.phenomena || {}, ext = dig.extLevels || {};
  return [
    `phenomena: eq=${p.equal_amount_split} csb=${p.coordinated_sell_back} sd=${p.sell_dispersion} cr=${p.creator_front_run}`,
    `ext: bw=${ext.same_block_buy_wave} tier=${ext.amount_tiering} rat=${ext.insider_supply_sell} pump=${ext.slow_grind_pump} wash=${ext.wash_pair} sbw=${ext.stall_burst_wave} hold=${ext.holdings_balance}`,
    `act=${(dig.activityLevel||{}).bucket} dom=${(dig.bundledDominance||{}).bucket} 数值: ${act.ticksPerMin}笔/分 笔均${act.avgTradeBnb} 最大间隔${act.maxGapSec}s`,
    `锚: sbHold=${a.sameBlockHoldPct} eqHold=${a.equalBandHoldPct} bundleBuy=${a.bundleBuyPct} t1供=${a.top1HoldSupplyPct} top2=${a.top2HoldSupplyPct} t1∪簇=${a.t1PlusClusterSupplyPct} Δ首买=${a.top1Top2FirstBuyGapSec}s`,
    `锚: wash对=${a.washPairCount}/${a.washPairSellPct}% 纯卖=${a.noBuySellPct}% burst波=${a.burstWaveBuyBnb}B/${a.burstWaveWallets}户/gap${a.burstMaxGapSec}s`,
    `famous: dom=${fam.dominancePct}%(${fam.level}) folTop3=${fam.followerTop3Pct}% 集团买=${fam.groupBuyPct ?? '（digest不落）'}`,
  ].join('\n    ');
}

async function main() {
  const client = dbManager.getClient();
  const rows = await fetchAll(client);
  const byToken = new Map();
  for (const r of rows) {
    if (!byToken.has(r.token_address)) byToken.set(r.token_address, []);
    byToken.get(r.token_address).push(r);
  }

  // ① 猴子币两臂票：首析触发序位（该 token 分析时刻前 wss_price_ticks 行数）
  for (const [prefix, label] of Object.entries(TARGETS)) {
    const tok = [...byToken.keys()].find(t => t.startsWith(prefix));
    if (!tok) { console.log('未找到', label, prefix); continue; }
    const rs = byToken.get(tok);
    const first = rs[0], last = rs[rs.length - 1];
    const fd = first.snapshot_digest || {}, ld = last.snapshot_digest || {};
    console.log('==== ' + label + ' ' + tok + '（' + rs.length + ' 行，' + first.analyzed_at.slice(11,19) + ' → ' + last.analyzed_at.slice(11,19) + '）');
    if (label.includes('两臂票')) {
      const cnt = await client.from('wss_price_ticks')
        .select('id', { count: 'exact', head: true })
        .eq('token_address', tok)
        .lte('created_at', first.analyzed_at);
      console.log('  首析时刻（' + first.analyzed_at.slice(11,19) + '）token 全史 tick 行数 = ' + (cnt.count ?? '?') + '（含尘 tick；锚窗行数 tickCount=' + fd.tickCount + '，capped=' + fd.capped + '，watermark=' + fd.watermark + '）');
    }
    console.log('  首行 ' + (fd.grade || first.verdict) + '@' + (fd.gradeVersion || '?') + ' 留痕 ' + ((fd.gradeReasons||[]).map(x=>x.code).join('|') || '零留痕'));
    console.log('  末行 ' + (ld.grade || last.verdict) + '@' + (ld.gradeVersion || '?') + ' 留痕 ' + ((ld.gradeReasons||[]).map(x=>x.code).join('|') || '零留痕'));
    console.log('  末行观测:\n    ' + brief(ld));
    const g = gradeObservation({ phenomena: ld.phenomena, extLevels: ld.extLevels, activityLevel: ld.activityLevel, bundledDominance: ld.bundledDominance, anchors: ld.anchors },
      { famousLevel: (ld.famous||{}).level, famousFollowerTop3Pct: (ld.famous||{}).followerTop3Pct, famousGroupBuyPct: null, anchorSellCount: ld.anchorSellCount ?? null });
    console.log('  G11 重放: ' + g.grade + ' [' + ((g.reasons||[]).map(x=>x.code).join('|') || '零留痕放行') + ']\n');
  }

  // ② 全场面 A_strong 载体分布（末行观测 G11 重放）
  const dist = new Map(); let aStrong = 0;
  for (const [tok, rs] of byToken) {
    const ld = rs[rs.length-1].snapshot_digest || {};
    if (!ld.phenomena || !ld.anchors) continue;
    const g = gradeObservation({ phenomena: ld.phenomena, extLevels: ld.extLevels, activityLevel: ld.activityLevel, bundledDominance: ld.bundledDominance, anchors: ld.anchors },
      { famousLevel: (ld.famous||{}).level, famousFollowerTop3Pct: (ld.famous||{}).followerTop3Pct, famousGroupBuyPct: null, anchorSellCount: ld.anchorSellCount ?? null });
    const aHits = (g.reasons||[]).filter(x => x.code.startsWith('A_strong'));
    if (aHits.length) {
      aStrong++;
      for (const part of aHits[0].code.replace('A_strong:','').split('+')) dist.set(part, (dist.get(part)||0)+1);
    }
  }
  console.log('==== 全场面 A_strong 承载体分布（' + aStrong + ' 张票，按载体题计数）:');
  for (const [k, v] of [...dist.entries()].sort((a,b) => b[1]-a[1])) console.log('  ' + k + ': ' + v);
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
