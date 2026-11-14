// 一次性（182 跑，只读）：bt-v100 信号元数据取证——
// ①idx191（signal 6ef037d6）cheatCheck 段 sbw/levels/anchors（burst 拒向）
// ②idx192（signal 0c7bdc4d）价格锚核实：curVs 用的 launch 是常量还是 T130 地板（首买价 4.1271e-9）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');

async function main() {
  const sb = await dbManager.getClient();
  const { data: sigs, error: e } = await sb.from('strategy_signals')
    .select('id,created_at,signal_type,metadata')
    .in('id', ['6ef037d6-5318-4d3e-846f-90fb08bfb160', '0c7bdc4d-dd7f-463c-ab3e-9e19d2752fe3']);
  if (e) throw new Error(e.message);
  for (const s of sigs) {
    const md = s.metadata || {};
    console.log('=== signal', s.id.slice(0, 8), s.created_at, s.signal_type, '| md keys:', Object.keys(md).join(','));
    if (s.id.startsWith('6ef037d6')) {
      const cc = md.cheatCheck || {};
      console.log('cheat grade=', cc.grade, 'exempt=', JSON.stringify(cc.exempt), 'levels=', JSON.stringify(cc.levels));
      console.log('anchors(burst)=', JSON.stringify(cc.anchors && { gap: cc.anchors.burstMaxGapSec, buy: cc.anchors.burstWaveBuyBnb, wallets: cc.anchors.burstWaveWallets, exitVs: cc.anchors.burstExitVsLaunchPct }));
      console.log('buckets=', JSON.stringify(cc.buckets));
    } else {
      console.log('price=', md.price, 'curVs(vs launch 从因子)=', md.factorResults && md.factorResults.currentVsLaunchPct, '| FR keys 有无:', md.factorResults ? Object.keys(md.factorResults).filter(k => k.includes('aunch') || k.includes('irstBuy')).join(',') : '无 factorResults');
      if (md.buyPoint) console.log('bp anchors launch 族=', JSON.stringify({ launch: md.buyPoint.anchors && md.buyPoint.anchors.launchPriceBnb, firstBuy: md.buyPoint.anchors && md.buyPoint.anchors.firstBuyRel, curVs: md.buyPoint.anchors && md.buyPoint.anchors.curVsLaunchPct, minVs: md.buyPoint.anchors && md.buyPoint.anchors.minVsLaunchPct }));
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
