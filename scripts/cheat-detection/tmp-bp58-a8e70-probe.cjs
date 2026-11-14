// 一次性探针（182 跑）：bt-v95（675c71a1）四票 BP 判定详情——用户质疑：a8e70 应为 pvp？28ad/c84a 为何 crash？
const { dbManager } = require('../../src/services/dbManager.js');

const EXP = '675c71a1-0e19-49b6-924b-facffc073afd';
const TOKENS = [
  { tag: 'a8e70-质疑pvp', addr: '0xa8e70ca07b68a07683c963513a26f2fa91647777' },
  { tag: '28ad-质疑crash', addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444' },
  { tag: 'c84a-质疑crash', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777' },
];

async function main() {
  const client = await dbManager.getClient();
  for (const t of TOKENS) {
    const { data: sigs, error: sigErr } = await client.from('strategy_signals')
      .select('id,created_at,signal_type,metadata')
      .eq('experiment_id', EXP).eq('token_address', t.addr)
      .order('id', { ascending: false }).limit(10);
    if (sigErr) { console.log(`\n### ${t.tag} 查询错误: ${sigErr.message}`); continue; }
    console.log(`\n### ${t.tag} ${(sigs || []).length} 条信号`);
    for (const s of sigs || []) {
      const md = s.metadata || {};
      const bp = md.buyPoint || null;
      if (!bp) { console.log(`== ${s.created_at} ${s.signal_type} 无BP段`); continue; }
      const a = bp.assessment || {}, d = bp.dimensions || {}, an = bp.anchors || {};
      const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
      console.log(`== ${s.created_at} ${s.signal_type} 综=${a.bucket}(${a.rule}) pattern=${dim('market_pattern')} entry=${dim('entry_shape')} act=${dim('activity_level')} heat=${dim('market_heat')} holder=${dim('holder_concentration')}`);
      console.log(`   锚: curVs=${an.currentVsLaunchPct} curVsAth=${an.currentVsAthPct} chg30=${an.chg30Pct} chg10=${an.chg10Pct} chg5=${an.chg5Pct} nUp5=${an.nearMaxUp5Pct} nDn5=${an.nearMaxDn5Pct} minGap=${an.curVsMinGapPct} ticks=${an.anchorTickCount} v=${bp.questionVersion || '?'}`);
      const ex = bp.exempt || null;
      if (ex) console.log(`   exempt: ${JSON.stringify(ex)}`);
    }
    const { data: trs } = await client.from('trades')
      .select('trade_type,input_amount,output_amount,success,executed_at')
      .eq('experiment_id', EXP).eq('token_address', t.addr).order('id', { ascending: true }).limit(50);
    const ok = (trs || []).filter((r) => r.success);
    if (ok.length) {
      const inB = ok.filter((r) => r.trade_type === 'buy').reduce((a, r) => a + Number(r.input_amount || 0), 0);
      const outB = ok.filter((r) => r.trade_type === 'sell').reduce((a, r) => a + Number(r.output_amount || 0), 0);
      console.log(`   trades: ${ok.length} 笔 净=${(outB - inB).toFixed(4)}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
