// 一次性（182 跑）：读 bt-v98 c84a/147d/0432/米 BUY 信号 metadata.buyPoint——看 v98 锚窗真实痕迹锚
const { dbManager } = require('../../src/services/dbManager.js');
const V98 = 'fe029df4-cd1f-490c-bfaf-f945feed287b';
const ADDRS = ['0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', '0x147d75f133130713c803d35a046da9b7c19effff', '0x04323e04c5f48587951c2d974b7f1b007b6e7777', '0x338a510c6c7abd4c714d74225086542270427777'];
async function main() {
  const c = await dbManager.getClient();
  for (const addr of ADDRS) {
    const { data, error } = await c.from('strategy_signals').select('id,created_at,metadata')
      .eq('experiment_id', V98).eq('signal_type', 'BUY').eq('token_address', addr)
      .order('created_at', { ascending: true }).limit(2);
    if (error) throw error;
    if (!data || !data.length) { console.log(`${addr.slice(0, 8)} v98 无 BUY 信号`); continue; }
    for (const s of data) {
      const bp = (s.metadata && (s.metadata.buyPoint || s.metadata.buyPointCheck)) || null;
      if (!bp) { console.log(`${addr.slice(0, 8)} ${s.created_at.slice(11, 19)} 无 buyPoint 段`); continue; }
      const dims = bp.dimensions ? Object.entries(bp.dimensions).map(([k, v]) => `${k}:${v && v.bucket}${v && v.prob != null ? '(' + Number(v.prob).toFixed(2) + ')' : ''}`) : [];
      const an = bp.anchors || {};
      console.log(`${addr.slice(0, 8)} ${s.created_at.slice(11, 19)} status=${bp.status} rule=${bp.rule || ''} 综=${bp.assessment && bp.assessment.bucket}`);
      console.log(`   dims=[${dims.join(' ')}]`);
      console.log(`   anchors: curVs=${an.currentVsLaunchPct} minVs=${an.minVsLaunchPct} athVs=${an.athVsLaunchPct} famousDom=${an.famousDominationPct} groupBuy=${an.famousGroupBuyPct} anchorTicks=${an.anchorTickCount ?? bp.anchorTickCount}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
