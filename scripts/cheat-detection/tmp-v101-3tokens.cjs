// 一次性：三票补充细节——recentDip5 三键 + cheat act/sbw 桶 + 豁免详情
const { dbManager } = require('../../src/services/dbManager.js');
const V101 = 'bbd6e464-f8db-46c3-93b4-6638e53d72dc';
const TOKENS = [
  ['28ad', '0x28ad2c7d08d83a85467bd4afcfd673dfce564444'],
  ['c84a', '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777'],
  ['ba5e', '0xba5ed45b42479e0a75316de7bf990ec90a3e4444'],
];
async function main() {
  const client = await dbManager.getClient();
  for (const [name, addr] of TOKENS) {
    const { data: sigs } = await client.from('strategy_signals')
      .select('created_at,reason,metadata')
      .eq('experiment_id', V101).eq('token_address', addr)
      .order('created_at', { ascending: true }).limit(40);
    console.log(`\n===== ${name} =====`);
    for (const s of sigs || []) {
      if (!s.reason || s.reason.includes('卖出')) continue;
      const m = s.metadata || {};
      const ch = m.cheatCheck || {}, bp = m.buyPoint || {};
      const an = bp.anchors || {};
      const lv = ch.levels || {};
      const rd = { chg: an.recentDip5ChgPct, recov: an.recentDip5RecovPct, secAgo: an.recentDip5SecAgo };
      console.log(`[${s.created_at.slice(11, 19)}] cheat=${ch.status}/${ch.grade || '-'} act=${ch.activityLevel || lv.activity_level || '?'} sbw=${lv.stall_burst_wave || '?'} 豁免=${ch.exempt ? JSON.stringify(ch.exempt).slice(0, 90) : '-'}拒豁=${ch.exemptDenied || '-'}`);
      console.log(`   recentDip5=${JSON.stringify(rd)} nearBuyMed=${an.nearWinBuyMedianBnb ?? '?'} bigBuy30=${an.nearWinBigBuyBnb ?? '?'} sell30=${an.nearWinSellBnb ?? '?'}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
