const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  // 0x4033b23ab8（超时后落库 rating=1）的 data_fetch_results：各平台耗时
  const { data, error } = await sb.from('token_narrative')
    .select('token_address,analyzed_at,data_fetch_results,url_extraction_result')
    .eq('token_address', '0x4033b23ab8').limit(1);
  if (error) { console.error('ERR', error.message); process.exit(1); }
  if (!data || !data.length) { console.log('no row'); process.exit(0); }
  const r = data[0];
  console.log('analyzed_at:', r.analyzed_at);
  const dfr = r.data_fetch_results;
  console.log('data_fetch_results keys:', dfr ? Object.keys(dfr) : null);
  console.log(JSON.stringify(dfr, null, 1).slice(0, 3000));
  process.exit(0);
})();
