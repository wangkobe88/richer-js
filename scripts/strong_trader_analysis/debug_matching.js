const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 获取被过滤的代币
  const { data: notExecuted } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, metadata')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .eq('executed', false);

  const filteredByRatio = [];
  const seen = new Set();
  notExecuted?.forEach(s => {
    const ratio = s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio;
    if (ratio !== undefined && ratio !== null && ratio >= 5 && !seen.has(s.token_address)) {
      seen.add(s.token_address);
      filteredByRatio.push({
        address: s.token_address,
        symbol: s.token_symbol,
        ratio: ratio
      });
    }
  });

  console.log('去重后被过滤的代币数:', filteredByRatio.length);
  console.log('\n前3个:');
  filteredByRatio.slice(0, 3).forEach(t => console.log('  ' + t.symbol + ': ' + t.address));

  // 获取原始实验的 trades
  const { data: trades } = await supabase
    .from('trades')
    .select('token_address, token_symbol, trade_direction, input_amount, output_amount')
    .eq('experiment_id', '015db965-0b33-4d98-88b1-386203886381');

  console.log('\n原始实验 trades 数:', trades?.length);

  // 计算 stats - 注意字段名是 trade_direction, input_amount, unit_price
  const tokenStats = new Map();
  trades?.forEach(trade => {
    const addr = trade.token_address;
    if (!tokenStats.has(addr)) {
      tokenStats.set(addr, {
        symbol: trade.token_symbol,
        address: addr,
        buyCost: 0,
        sellRevenue: 0
      });
    }
    const stat = tokenStats.get(addr);
    // buy 交易：input 是 BNB，output 是代币
    // sell 交易：input 是代币，output 是 BNB
    // 买入成本用 input_amount * BNB价格，这里简化用 input_amount（BNB数量）
    if (trade.trade_direction === 'buy') {
      stat.buyCost += trade.input_amount || 0;
    } else if (trade.trade_direction === 'sell') {
      stat.sellRevenue += trade.output_amount || 0;
    }
  });

  console.log('\n有买入记录的代币数:', Array.from(tokenStats.values()).filter(s => s.buyCost > 0).length);

  // 检查匹配
  let matchCount = 0;
  const matches = [];
  filteredByRatio.forEach(t => {
    const stat = tokenStats.get(t.address);
    if (stat && stat.buyCost > 0) {
      matchCount++;
      matches.push({ ...t, buyCost: stat.buyCost });
    }
  });

  console.log('\n匹配且有买入记录的代币数:', matchCount);
  if (matches.length > 0) {
    console.log('\n匹配的代币:');
    matches.forEach(m => {
      const profit = (tokenStats.get(m.address).sellRevenue || 0) - m.buyCost;
      const returnRate = (profit / m.buyCost) * 100;
      console.log('  ' + m.symbol + ': ratio=' + m.ratio.toFixed(2) + '%, buyCost=' + m.buyCost.toFixed(2) + ', return=' + returnRate.toFixed(2) + '%');
    });
  }
})();
