const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const c = await dbManager.getClient();
  const { data: tr } = await c.from('trades')
    .select('experiment_id,token_address,token_symbol,trade_direction,created_at')
    .ilike('token_address', '0x8cf171df%').limit(8);
  console.log(`trades 该前缀 ${tr ? tr.length : 0} 行:`);
  for (const t of tr || []) {
    const codes = [...t.token_address.slice(0, 14)].map((ch) => ch.charCodeAt(0)).join(',');
    console.log(`${(t.token_symbol || '?')} exp=${t.experiment_id.slice(0, 8)} ${t.trade_direction} ${t.created_at.slice(11, 19)} 前14字符码=${codes}`);
  }
  if (tr && tr[0]) {
    const addr = tr[0].token_address;
    console.log('\n用 trades 真身地址查 signals:');
    const { data: sg } = await c.from('strategy_signals')
      .select('experiment_id,created_at,signal_type,executed,status,er:metadata->>execution_reason')
      .eq('token_address', addr).order('created_at', { ascending: true }).limit(6);
    for (const s of sg || []) console.log(JSON.stringify({ e: s.experiment_id.slice(0, 8), t: s.created_at.slice(11, 19), ty: s.signal_type, ex: s.executed, st: s.status, er: s.er }));
    console.log(sg && sg.length ? '' : '(signals 仍 0 行)');
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err); process.exit(1); });
