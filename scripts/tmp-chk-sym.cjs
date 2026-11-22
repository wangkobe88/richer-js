const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('config/.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY);
(async () => {
  const tok = '0x4ad6d591cc00705a5aff0d372a2f256ec8327777';
  const { data: ct } = await sb.from('case_collection_tokens').select('token_meta').eq('collection_id', '781083cd-d1b3-4189-a990-d9b02ab657b2').eq('token_address', tok).maybeSingle();
  const m = ct?.token_meta || {};
  console.log('正式形状键:', Object.keys(m).join(','));
  console.log('payload.symbol:', m.payload?.symbol, '| payload.name:', m.payload?.name, '| blockTimeIso:', m.blockTimeIso, '| platform:', m.platform);
})().catch(e => { console.error(e.message); process.exit(1); });
