const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function check() {
  const SOURCE = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";
  const HABIBI = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  const { data } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp, price_usd, factor_values')
    .eq('experiment_id', SOURCE)
    .eq('token_address', HABIBI)
    .order('timestamp', { ascending: true })
    .limit(15);

  if (data && data.length > 0) {
    console.log('=== Habibi 价格历史 ===');
    let maxPrice = 0;
    let maxPriceFromFv = 0;

    data.forEach((d, i) => {
      const price = parseFloat(d.price_usd);
      const fv = d.factor_values || {};
      const fvHighest = fv.highestPrice || 0;

      if (price > maxPrice) maxPrice = price;
      if (fvHighest > maxPriceFromFv) maxPriceFromFv = fvHighest;

      const idx = (i + 1).toString().padStart(2, ' ');
      const time = new Date(d.timestamp).toLocaleTimeString();
      console.log(`[${idx}] ${time} price=${price.toFixed(6)} fv.highestPrice=${fvHighest.toFixed(6)}`);
    });

    console.log('\n=== 最高价对比 ===');
    console.log('实际数据最高价:', maxPrice.toFixed(6));
    console.log('factor_values中最高价:', maxPriceFromFv.toFixed(6));

    // 计算loop 228时的drawdown
    const loop228Price = data[7]?.price_usd ? parseFloat(data[7].price_usd) : 0;
    const drawdownUsingActual = ((loop228Price - maxPrice) / maxPrice) * 100;
    const drawdownUsingFv = ((loop228Price - maxPriceFromFv) / maxPriceFromFv) * 100;

    console.log('\n=== loop 228 drawdownFromHighest ===');
    console.log('使用实际最高价:', drawdownUsingActual.toFixed(2) + '%');
    console.log('使用fv最高价:', drawdownUsingFv.toFixed(2) + '%');
    console.log('fv.drawdownFromHighest:', (data[7]?.factor_values?.drawdownFromHighest || 0).toFixed(2) + '%');
  }
}
check().catch(console.error);
