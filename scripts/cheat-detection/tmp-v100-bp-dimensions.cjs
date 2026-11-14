// 一次性（182 跑）：v100/v96/v95 三代 c84a+ba5e 的 BP dimensions/assessment 判读对照。
const { dbManager } = require('../../src/services/dbManager.js');
const EXPS = {
  v95: '675c71a1-0e19-49b6-924b-facffc073afd',
  v96: 'e582e873-7f1a-44a5-b50f-0fca576847be',
  v100: 'ed113d10-8d0b-495d-b1f1-9b597f564c21',
};
const T = {
  c84a: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777',
  ba5e: '0xba5ed45b42479e0a75316de7bf990ec90a3e4444',
};
async function main() {
  const sb = await dbManager.getClient();
  for (const [tag, exp] of Object.entries(EXPS)) {
    for (const [tt, addr] of Object.entries(T)) {
      const { data: rows } = await sb.from('strategy_signals')
        .select('created_at,metadata').eq('experiment_id', exp).eq('token_address', addr).order('created_at').limit(10);
      for (const r of rows || []) {
        const bp = (r.metadata || {}).buyPoint;
        if (!bp || !bp.status) continue;
        const dim = bp.dimensions || {};
        const asm = bp.assessment || {};
        const shape = (dim.entry_shape && (dim.entry_shape.bucket || dim.entry_shape)) || '-';
        const shapeP = dim.entry_shape && dim.entry_shape.prob;
        console.log(`[${tag} ${tt}] ${r.created_at.slice(5, 19)} passed=${bp.passed} shape=${shape}${shapeP !== undefined ? ' p=' + shapeP : ''} pattern=${typeof dim.market_pattern === 'object' ? (dim.market_pattern.bucket || '-') : (dim.market_pattern || '-')} act=${typeof dim.activity_level === 'object' ? (dim.activity_level.bucket || '-') : (dim.activity_level || '-')} trend=${typeof dim.price_trend === 'object' ? (dim.price_trend.bucket || '-') : (dim.price_trend || '-')} holder=${typeof dim.holder_concentration === 'object' ? (dim.holder_concentration.bucket || '-') : (dim.holder_concentration || '-')} level=${typeof dim.price_level === 'object' ? (dim.price_level.bucket || '-') : (dim.price_level || '-')} 综判=${asm.level || '-'} rule=${asm.rule || bp.rule || '-'}`);
        if (tag === 'v100') console.log(`    dimensions keys=${Object.keys(dim).join(',')} | entry_shape 全文=${JSON.stringify(dim.entry_shape).slice(0, 400)}`);
      }
    }
  }
  // v95/v100 c84a 成交核对
  for (const [tag, exp] of [['v95', EXPS.v95], ['v96', EXPS.v96], ['v100', EXPS.v100]]) {
    const { data: tr } = await sb.from('trades').select('trade_direction,created_at')
      .eq('experiment_id', exp).eq('token_address', T.c84a).limit(6);
    console.log(`${tag} c84a 成交: ${(tr || []).map((x) => x.trade_direction + '@' + x.created_at.slice(5, 19)).join(' | ') || '无'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
