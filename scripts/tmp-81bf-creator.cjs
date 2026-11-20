const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  for (const [name, t] of [['断脚蟹', '0x81bf04448ad0b72258ab5d9e0a1f77e59cdf7777'], ['panda', '0xdf0e577577a1a2df2a4728c7e238c964ae477777']]) {
    const { data } = await sb.from('wss_events').select('block_time,payload').eq('token_address', t).eq('kind', 'token_create').limit(1);
    const p = data?.[0]?.payload || {};
    console.log(`${name}: creator=${p.creator || p.creatorAddress || JSON.stringify(p).match(/creator[\"']?\s*[:=]\s*[\"']?(0x[0-9a-fA-F]+)/)?.[1] || '?'} payload键=${Object.keys(p).join(',')}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
