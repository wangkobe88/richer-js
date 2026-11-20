require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXPS = [
  ['v162w1003', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['v158w1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['v150w1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['v145w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
async function main() {
  const sb = dbManager.getClient();
  for (const [label, exp] of EXPS) {
    const { data: e } = await sb.from('experiments').select('experiment_name,config->platform,config->tradingMode,config->trading_mode').eq('id', exp).single();
    console.log(`${label}: platform=${e.platform} mode=${e.trading_mode || (e.config && e.tradingMode)}`);
  }
  // 433 票平台实测：抽每窗全部成交票的 ticks platform 分布
  for (const [label, exp] of EXPS) {
    const { data: trs } = await sb.from('trades').select('token_address').eq('experiment_id', exp).limit(2000);
    const toks = [...new Set((trs || []).map(t => t.token_address))];
    // 逐票查 platform（每票取 1 行）
    const plat = {};
    for (let i = 0; i < toks.length; i += 50) {
      const chunk = toks.slice(i, i + 50);
      const { data } = await sb.from('wss_price_ticks').select('token_address,platform').in('token_address', chunk).limit(1000);
      const seen = new Map();
      for (const r of data || []) if (!seen.has(r.token_address)) seen.set(r.token_address, r.platform || 'null');
      for (const [t, p] of seen) plat[p] = (plat[p] || 0) + 1;
    }
    console.log(`${label}: 成交票 ${toks.length}，tick platform 分布=${JSON.stringify(plat)}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
