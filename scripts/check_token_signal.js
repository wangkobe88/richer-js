const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const tokenAddress = '0x46745a3d173e8dc0903095add3e2d5224b3c4444';
  const experimentId = 'c8b25316-c9cf-4f5b-a7ba-36dbc99f4148';

  // 查找这个代币的买入信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  console.log(`=== 代币 ${tokenAddress} 的买入信号 ===\n`);

  if (!signals || signals.length === 0) {
    console.log('没有找到买入信号');
    
    // 检查是否有任何信号
    const { data: allSignals } = await supabase
      .from('strategy_signals')
      .select('*')
      .eq('experiment_id', experimentId)
      .eq('token_address', tokenAddress)
      .order('created_at', { ascending: true })
      .limit(5);

    if (allSignals && allSignals.length > 0) {
      console.log('\n所有信号:');
      for (const s of allSignals) {
        console.log(`  ${s.action} | ${s.created_at}`);
        console.log(`  metadata:`, JSON.stringify(s.metadata, null, 2).substring(0, 500));
      }
    }
    return;
  }

  console.log(`找到 ${signals.length} 个买入信号\n`);

  for (const signal of signals) {
    console.log(`--- 信号 ${signal.id.substring(0, 8)}... ---`);
    console.log(`创建时间: ${signal.created_at}`);
    console.log(`动作: ${signal.action}`);
    console.log(`置信度: ${signal.confidence}`);
    console.log(`原因: ${signal.reason}`);

    if (signal.metadata) {
      console.log('\n因子值:');
      const factors = signal.metadata;
      
      // 重要的因子
      const keyFactors = ['age', 'riseSpeed', 'earlyReturn', 'fdv', 'tvl', 'holders', 'marketCap'];
      for (const key of keyFactors) {
        if (factors[key] !== undefined) {
          console.log(`  ${key}: ${factors[key]}`);
        }
      }

      console.log('\n完整metadata:');
      console.log(JSON.stringify(signal.metadata, null, 2).substring(0, 1000));
    }
    console.log('');
  }

  // 获取时序数据，查看价格变化
  const { data: timeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp, loop_count, price_usd, factor_values')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('timestamp', { ascending: true })
    .limit(20);

  if (timeSeries && timeSeries.length > 0) {
    console.log('\n=== 时序数据（前20条）===');
    for (const ts of timeSeries) {
      const price = parseFloat(ts.price_usd) || 0;
      const factors = ts.factor_values || {};
      const riseSpeed = factors.riseSpeed || 0;
      const earlyReturn = factors.earlyReturn || 0;
      
      console.log(`${ts.loopCount}轮 | 价格: $${price.toExponential(2)} | riseSpeed: ${riseSpeed.toFixed(1)} | earlyReturn: ${earlyReturn.toFixed(1)}%`);
    }
  }
})();
