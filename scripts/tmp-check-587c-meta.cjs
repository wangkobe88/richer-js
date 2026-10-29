// 临时排查：0x587c61b4…7777 卖出行完整 metadata + ticks 价格轨迹（小结果读取）
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', 'config', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

(async () => {
  const TOKEN = '0x587c61b4a5052b7e5e0563be61b9be0a0aa27777';

  // 1) 卖出行完整 metadata
  const { data: trades } = await db
    .from('trades')
    .select('id,trade_direction,metadata')
    .eq('token_address', TOKEN)
    .order('created_at');
  for (const t of trades || []) {
    console.log('=== trade', t.trade_direction, t.id);
    console.log(JSON.stringify(t.metadata, null, 1).slice(0, 3000));
  }

  // 2) 该票 ticks 价格轨迹（买入前后各取几十条，看崩盘形状）
  const { data: ticks, error } = await db
    .from('wss_price_ticks')
    .select('bnb_price,price,block_time,experiment_id')
    .eq('token_address', TOKEN)
    .order('block_time', { ascending: true })
    .range(0, 500);
  if (error) { console.error('ticks ERR', error.message); }
  if (ticks && ticks.length) {
    console.log('=== ticks total(sample):', ticks.length);
    // 每 20 条采样打印
    ticks.forEach((tk, i) => {
      if (i % 20 === 0 || i === ticks.length - 1) {
        console.log(i, tk.block_time, tk.bnb_price, tk.price, 'exp=', tk.experiment_id?.slice(0, 8) ?? 'NULL');
      }
    });
  } else {
    console.log('=== no ticks');
  }
})();
