const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function analyze() {
  const SOURCE = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";
  const HABIBI = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  const { data } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, timestamp, price_usd, factor_values')
    .eq('experiment_id', SOURCE)
    .eq('token_address', HABIBI)
    .order('timestamp', { ascending: true })
    .limit(25);

  if (data) {
    console.log('=== Habibi 价格上涨时 highestPrice 的变化 ===\n');
    let lastPrice = 0;
    data.forEach((d, i) => {
      const price = parseFloat(d.price_usd);
      const fv = d.factor_values || {};
      const fvHighest = fv.highestPrice || 0;
      const time = new Date(d.timestamp).toLocaleTimeString();

      if (price !== lastPrice) {
        const idx = (i + 1).toString().padStart(2, ' ');
        console.log(`[${idx}] ${time} price=${price.toFixed(6)} fv.highestPrice=${fvHighest.toFixed(6)}`);
        lastPrice = price;
      }
    });
  }
}
analyze().catch(console.error);
