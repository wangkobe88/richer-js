require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSpecificToken() {
  const experimentId = '95ad2fb4-2bb6-471b-8343-0adaba81a50e';
  const tokenAddress = '0x84a5cd2f111f8a8fd9a9a3008e508342ca3a4444';

  console.log('========================================');
  console.log(`实验: ${experimentId}`);
  console.log(`代币: ${tokenAddress}`);
  console.log('========================================\n');

  // 1. 查询代币基本信息
  const { data: token, error: tokenError } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .single();

  if (tokenError) {
    console.log('代币查询错误:', tokenError.message);
    return;
  }

  console.log('代币信息:');
  console.log(`  Symbol: ${token.token_symbol || '(null)'}`);
  console.log(`  状态: ${token.status}`);
  console.log(`  发现时间: ${token.discovered_at}`);
  console.log(`  创建者: ${token.creator_address || '(null)'}`);
  console.log('');

  // 2. 查询该代币的所有时序数据（信号）
  const { data: timeSeries, error: tsError } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('timestamp', { ascending: true });

  if (tsError) {
    console.log('时序数据查询错误:', tsError.message);
    return;
  }

  console.log(`时序数据总数: ${timeSeries?.length || 0}\n`);

  if (!timeSeries || timeSeries.length === 0) {
    console.log('没有找到时序数据');
    return;
  }

  // 3. 显示所有时序数据点的价格和因子
  console.log('价格趋势:');
  console.log('----------------------------------------');
  timeSeries.forEach((ts, i) => {
    const factors = ts.factor_values || {};
    const prices = ts.price_data || {};
    console.log(`${i + 1}. 时间: ${ts.timestamp}`);
    console.log(`   状态: ${ts.status}`);
    console.log(`   价格: $${prices.price || 'N/A'}`);
    console.log(`   因子: age=${factors.age || 'N/A'}min, earlyReturn=${factors.earlyReturn || 'N/A'}%, holders=${factors.holders || 'N/A'}`);
    console.log(`   价格数据: ${JSON.stringify(prices)}`);
    console.log('');
  });

  // 4. 分析价格趋势
  console.log('价格趋势分析:');
  console.log('----------------------------------------');
  const prices = timeSeries.map(ts => ts.price_data?.price).filter(p => p !== undefined && p !== null);

  if (prices.length > 0) {
    let upCount = 0;
    let downCount = 0;
    let flatCount = 0;

    for (let i = 1; i < prices.length; i++) {
      if (prices[i] > prices[i - 1]) upCount++;
      else if (prices[i] < prices[i - 1]) downCount++;
      else flatCount++;
    }

    console.log(`初始价格: $${prices[0]}`);
    console.log(`最终价格: $${prices[prices.length - 1]}`);
    console.log(`最高价格: $${Math.max(...prices)}`);
    console.log(`最低价格: $${Math.min(...prices)}`);
    console.log('');
    console.log(`上涨次数: ${upCount}`);
    console.log(`下跌次数: ${downCount}`);
    console.log(`持平次数: ${flatCount}`);
    console.log('');

    // 5. 查找购买信号
    console.log('购买信号分析:');
    console.log('----------------------------------------');
    const buySignals = timeSeries.filter(ts => ts.status === 'buy' || ts.action === 'buy');

    if (buySignals.length > 0) {
      buySignals.forEach((signal, i) => {
        const factors = signal.factor_values || {};
        const prices = signal.price_data || {};
        console.log(`购买信号 ${i + 1}:`);
        console.log(`  时间: ${signal.timestamp}`);
        console.log(`  价格: $${prices.price || 'N/A'}`);
        console.log(`  因子: age=${factors.age || 'N/A'}min, earlyReturn=${factors.earlyReturn || 'N/A'}%, holders=${factors.holders || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('没有找到购买信号');

      // 显示是否有monitoring状态的数据
      const monitoringSignals = timeSeries.filter(ts => ts.status === 'monitoring');
      if (monitoringSignals.length > 0) {
        console.log('\n找到监控状态的时序数据:');
        monitoringSignals.forEach((ts, i) => {
          const factors = ts.factor_values || {};
          const prices = ts.price_data || {};
          console.log(`  ${i + 1}. 时间: ${ts.timestamp}, 价格: $${prices.price || 'N/A'}`);
          console.log(`     因子: age=${factors.age || 'N/A'}min, earlyReturn=${factors.earlyReturn || 'N/A'}%`);
        });
      }
    }
  }
}

checkSpecificToken().catch(console.error);
