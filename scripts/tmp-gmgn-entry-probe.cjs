// T116 探针：GMGN getTokenInfo 对新票（分钟级）wallet_tags_stat 是否已填充
// 取最近 token_create 若干票 + dump wallet_tags_stat 全字段（找 whale 类字段）
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  // wss_events 低频表（token_create/graduation/quote_set），order id desc limit 轻
  const { data: evs, error } = await c.from('wss_events')
    .select('token_address, platform, block_time, payload')
    .eq('kind', 'token_create')
    .order('id', { ascending: false })
    .limit(8);
  if (error) throw error;
  if (!evs || !evs.length) { console.log('无 token_create 行'); await dbManager.close?.(); return; }

  const apiKey = process.env.GMGN_API_KEY;
  if (!apiKey) throw new Error('GMGN_API_KEY 缺失');
  const { GMGNTokenAPI } = require('../src/core/gmgn-api');
  const api = new GMGNTokenAPI({ apiKey, timeout: 8000 });
  await api.init();

  let dumpedKeys = false;
  for (const ev of evs.slice(0, 6)) {
    const addr = ev.token_address;
    const ageMin = ev.block_time ? (Date.now() - new Date(ev.block_time).getTime()) / 60000 : null;
    let line = `${addr} ${ev.platform} age=${ageMin ? ageMin.toFixed(1) : '?'}min`;
    try {
      const info = await api.getTokenInfo('bsc', addr);
      if (!info) { console.log(`${line} → 未索引(null)`); continue; }
      if (!dumpedKeys) {
        dumpedKeys = true;
        console.log('[top-level keys]', Object.keys(info).join(','));
        if (info.pool) console.log('[pool keys]', Object.keys(info.pool).join(','));
      }
      const tags = info.wallet_tags_stat || null;
      console.log(`${line} → tags=${tags ? JSON.stringify(tags) : 'MISSING'} vc=${info.visiting_count ?? '?'} holders=${info.holder_count ?? '?'}`);
    } catch (e) {
      console.log(`${line} → ERROR ${e.message}`);
    }
  }
  await dbManager.close?.();
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
