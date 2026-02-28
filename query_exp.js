const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function query() {
  const expId = '8b9b2b82-ff93-4f58-9d37-c9e81fc9fa9b';

  // 获取交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('trade_direction, token_address, token_symbol, created_at')
    .eq('experiment_id', expId)
    .order('created_at', { ascending: true });

  const buyTokens = new Set(trades?.filter(t => t.trade_direction === 'buy').map(t => t.token_address.toLowerCase()) || []);
  const sellTokens = new Set(trades?.filter(t => t.trade_direction === 'sell').map(t => t.token_address.toLowerCase()) || []);

  // 获取所有时序数据代币
  let allTsTokens = [];
  let page = 0;
  while (page < 200) {
    const from = page * 1000;
    const to = from + 999;
    const { data } = await supabase
      .from('experiment_time_series_data')
      .select('token_address')
      .eq('experiment_id', expId)
      .range(from, to);
    if (!data || data.length === 0) break;
    allTsTokens = allTsTokens.concat(data.map(t => t.token_address.toLowerCase()));
    if (data.length < 1000) break;
    page++;
  }
  const tsTokens = new Set(allTsTokens);

  // 找出有买入且有时序数据的代币
  const boughtWithTs = [...buyTokens].filter(addr => tsTokens.has(addr));
  
  // 分类：有卖出 vs 只买未卖
  const soldWithTs = boughtWithTs.filter(addr => sellTokens.has(addr));
  const onlyBuyWithTs = boughtWithTs.filter(addr => !sellTokens.has(addr));

  console.log('=== 有时序数据的买入代币分析 ===\n');
  console.log(`有时序数据且已卖出: ${soldWithTs.length} 个`);
  console.log(`有时序数据但只买未卖: ${onlyBuyWithTs.length} 个\n`);

  // 分析只买未卖的代币的价格走势
  if (onlyBuyWithTs.length > 0) {
    console.log('=== 只买未卖的代币价格分析 ===\n');
    
    for (const addr of onlyBuyWithTs) {
      // 获取代币符号和买入时间
      const buyTrade = trades?.find(t => t.token_address.toLowerCase() === addr && t.trade_direction === 'buy');
      const symbol = buyTrade?.token_symbol || addr.slice(0,10);
      const buyTime = buyTrade?.created_at;

      // 获取时序价格数据
      const { data: prices } = await supabase
        .from('experiment_time_series_data')
        .select('price_usd, timestamp')
        .eq('experiment_id', expId)
        .eq('token_address', addr)
        .order('timestamp', { ascending: true });

      if (prices && prices.length > 1) {
        const priceValues = prices.filter(p => p.price_usd).map(p => parseFloat(p.price_usd));
        if (priceValues.length >= 2) {
          const max = Math.max(...priceValues);
          const min = Math.min(...priceValues);
          const maxDrawdown = max > 0 ? ((min - max) / max * 100) : 0;
          
          console.log(`${symbol}:`);
          console.log(`  时序数据: ${prices.length} 条 (${prices[0].timestamp} ~ ${prices[prices.length-1].timestamp})`);
          console.log(`  价格点: ${priceValues.length} 个`);
          console.log(`  最大回撤: ${maxDrawdown.toFixed(1)}%`);
          console.log(`  买入时间: ${buyTime}`);
          console.log(`  ${maxDrawdown <= -20 ? '⚠️ 达到-20%阈值但未卖出' : '✓ 未达到-20%阈值'}\n`);
        }
      }
    }
  }

  // 分析已卖出的代币
  if (soldWithTs.length > 0) {
    console.log('\n=== 已卖出的代币价格分析（前5个）===\n');
    
    for (const addr of soldWithTs.slice(0, 5)) {
      const buyTrade = trades?.find(t => t.token_address.toLowerCase() === addr && t.trade_direction === 'buy');
      const sellTrade = trades?.find(t => t.token_address.toLowerCase() === addr && t.trade_direction === 'sell');
      const symbol = buyTrade?.token_symbol || addr.slice(0,10);
      
      const { data: prices } = await supabase
        .from('experiment_time_series_data')
        .select('price_usd')
        .eq('experiment_id', expId)
        .eq('token_address', addr);

      const priceValues = prices?.filter(p => p.price_usd).map(p => parseFloat(p.price_usd)) || [];
      const maxDrawdown = priceValues.length >= 2 ? 
        ((Math.min(...priceValues) - Math.max(...priceValues)) / Math.max(...priceValues) * 100) : 0;

      console.log(`${symbol}: 最大回撤 ${maxDrawdown.toFixed(1)}%`);
    }
  }
}

query().catch(console.error);
