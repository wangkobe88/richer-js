const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const tokenAddress = '0x46745a3d173e8dc0903095add3e2d5224b3c4444';
  const experimentId = '0c616581-aa7f-4fcf-beed-6c84488925fb';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  if (!signals || signals.length === 0) {
    console.log('没有找到买入信号');
    return;
  }

  for (const signal of signals) {
    const f = signal.metadata || {};
    console.log('代币:', signal.token_symbol);
    console.log('信号时间:', signal.created_at);
    console.log('');
    console.log('趋势因子:');
    console.log('  trendCV:', f.trendCV?.toFixed(4) || 'N/A', '(需要 > 0.005)');
    console.log('  trendDirectionCount:', f.trendDirectionCount || 'N/A', '(需要 >= 2)');
    console.log('  trendStrengthScore:', f.trendStrengthScore?.toFixed(2) || 'N/A', '(需要 >= 30)');
    console.log('  trendTotalReturn:', f.trendTotalReturn?.toFixed(2) || 'N/A', '% (需要 >= 5)');
    console.log('');
    console.log('基础因子:');
    console.log('  tvl:', f.tvl || 'N/A', '(需要 >= 3000)');
    console.log('  txVolumeU24h:', f.txVolumeU24h || 'N/A', '(需要 >= 3500)');
    console.log('  holders:', f.holders || 'N/A', '(需要 >= 30)');
    console.log('');

    const trendCV = f.trendCV || 0;
    const trendDirectionCount = f.trendDirectionCount || 0;
    const trendStrengthScore = f.trendStrengthScore || 0;
    const trendTotalReturn = f.trendTotalReturn || 0;
    const tvl = f.tvl || 0;
    const txVolumeU24h = f.txVolumeU24h || 0;
    const holders = f.holders || 0;

    const pass = trendCV > 0.005 && trendDirectionCount >= 2 && trendStrengthScore >= 30 && trendTotalReturn >= 5 && tvl >= 3000 && txVolumeU24h >= 3500 && holders >= 30;
    console.log('满足条件:', pass ? '是' : '否');

    if (!pass) {
      console.log('');
      console.log('未满足的条件:');
      if (trendCV <= 0.005) console.log('  - trendCV <= 0.005');
      if (trendDirectionCount < 2) console.log('  - trendDirectionCount < 2');
      if (trendStrengthScore < 30) console.log('  - trendStrengthScore < 30');
      if (trendTotalReturn < 5) console.log('  - trendTotalReturn < 5%');
      if (tvl < 3000) console.log('  - tvl < 3000');
      if (txVolumeU24h < 3500) console.log('  - txVolumeU24h < 3500');
      if (holders < 30) console.log('  - holders < 30');
    }
  }
})();
