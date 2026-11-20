// 2bdf98ab 全部 T189 卖出票：买信号 sbw 判定 + 卖后走势
const { dbManager } = require('../src/services/dbManager');
const EXP = '2bdf98ab-d85f-40fa-84b5-d79099e1006c';
async function main() {
  const sb = dbManager.getClient();
  const { data: sells } = await sb.from('strategy_signals').select('token_address,created_at,metadata,reason')
    .eq('experiment_id', EXP).eq('signal_type', 'SELL').like('reason', 'burst%').order('created_at');
  console.log('T189 sells:', (sells || []).length);
  const toks = [...new Set((sells || []).map(s => s.token_address))];
  const { data: buys } = await sb.from('strategy_signals').select('token_address,created_at,metadata')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').in('token_address', toks.length ? toks : ['__none__']).order('created_at');
  const buyMeta = new Map();
  for (const b of buys || []) {
    const m = b.metadata || {};
    const lv = m.cheatCheck?.levels || {};
    buyMeta.set(b.token_address, { at: b.created_at, sbw: lv.stallBurstWave ?? null, grade: m.cheatCheck?.grade ?? null, act: m.actFrontGate?.act ?? null, afSbw: m.actFrontGate?.sbw ?? null });
  }
  for (const s of sells || []) {
    const b = buyMeta.get(s.token_address) || {};
    const info = s.metadata?.burstCooldownInfo || {};
    console.log(s.token_address.slice(0, 10), '| sell@', s.created_at?.slice(11, 19),
      '| sbw=', b.sbw, 'afSbw=', b.afSbw, 'grade=', b.grade, 'act=', b.act,
      '| w1=', info.w1Bnb, 'w2=', info.w2Bnb, 'crew=', info.crewSize, info.batch ? 'batch=' + info.batch : '');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
