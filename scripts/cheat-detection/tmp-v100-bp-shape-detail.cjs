// 一次性（182 跑）：v100 ba5e/c84a 买点 entry_shape 答案明细 + c84a 在 v95/v96 的成交锚对照。
const { dbManager } = require('../../src/services/dbManager.js');
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be';
const C84A = '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777';
const BA5E = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';

function dumpBp(tag, row) {
  const m = (row && row.metadata) || {};
  const bp = m.buyPoint || {};
  console.log(`\n[${tag}] ${row.created_at.slice(5, 19)} 腿=${(m.signalGate || {}).legId || '-'}`);
  console.log(`  status=${bp.status} rule=${bp.rule || '-'} level=${bp.level || '-'} exempt=${JSON.stringify(bp.exempt || null)}`);
  const d = bp.digest || bp.snapshotDigest || {};
  if (d.qualities) console.log(`  qualities=${JSON.stringify(d.qualities)}`);
  // answers 常见位置：bp.answers / d.answers
  const ans = bp.answers || d.answers;
  if (ans) {
    for (const [k, v] of Object.entries(ans)) {
      if (typeof v === 'object' && v) console.log(`  ${k}: ${v.bucket || v.choice || JSON.stringify(v).slice(0, 120)}${v.prob !== undefined ? ' p=' + v.prob : ''}`);
      else console.log(`  ${k}: ${v}`);
    }
  } else console.log('  （无 answers，keys=' + Object.keys(bp).join(',') + ' / digest keys=' + Object.keys(d).join(',').slice(0, 200) + ')');
}

async function main() {
  const sb = await dbManager.getClient();
  const { data: s100 } = await sb.from('strategy_signals')
    .select('created_at,token_address,metadata').eq('experiment_id', V100).in('token_address', [C84A, BA5E]).order('created_at');
  for (const r of s100 || []) {
    const bp = (r.metadata || {}).buyPoint;
    if (!bp || !bp.status) continue;
    dumpBp('v100 ' + r.token_address.slice(0, 6), r);
  }
  // v95/v96 c84a 成交信号（对照当时 entry_shape）
  for (const [tag, exp] of [['v95', V95], ['v96', V96]]) {
    const { data: rows } = await sb.from('strategy_signals')
      .select('created_at,metadata,token_address').eq('experiment_id', exp).eq('token_address', C84A).order('created_at').limit(6);
    console.log(`\n===== ${tag} c84a 信号 ${ (rows || []).length } 行 =====`);
    for (const r of rows || []) {
      const bp = (r.metadata || {}).buyPoint || {};
      const sg = (r.metadata || {}).signalGate || {};
      const q = (bp.digest || {}).qualities || {};
      console.log(`${r.created_at.slice(5, 19)} 腿=${sg.legId || '-'} bp=${bp.status || '-'} rule=${bp.rule || '-'} shape=${q.entry_shape || '-'} pattern=${q.market_pattern || '-'} act=${q.activity_level || '-'}`);
    }
  }
  // c84a/ba5e 创建时刻（t0 锚距开盘多久）
  const { data: ev } = await sb.from('wss_events').select('block_time,token_address').eq('kind', 'token_create').in('token_address', [C84A, BA5E]).limit(4);
  for (const e of ev || []) console.log(`create ${e.token_address.slice(0, 8)}: ${e.block_time}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
