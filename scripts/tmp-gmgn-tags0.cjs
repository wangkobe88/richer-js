require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const r = await sb.from('gmgn_wallet_profiles').select('*').limit(2);
  console.log('cols:', Object.keys(r.data[0]).join(','));
  console.log('sample row:', JSON.stringify(r.data[0], null, 1).slice(0, 800));
  // tags 分布
  let after = null, tagCount = new Map(), n = 0, hasTags = 0;
  while (true) {
    let q = sb.from('gmgn_wallet_profiles').select('address,tags,stats_period,buy_count,token_num,winrate,realized_profit').order('address').limit(1000);
    if (after) q = q.gt('address', after);
    const { data } = await q;
    if (!data || !data.length) break;
    for (const row of data) {
      n++;
      const t = row.tags || [];
      if (t.length) hasTags++;
      for (const x of t) tagCount.set(x, (tagCount.get(x) || 0) + 1);
    }
    after = data[data.length - 1].address;
    if (data.length < 1000) break;
  }
  console.log(`\n总钱包 ${n}，带标签 ${hasTags}（${(hasTags / n * 100).toFixed(0)}%）`);
  const top = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log('tag Top25:', top.map(([t, c]) => `${t}:${c}`).join(' '));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
