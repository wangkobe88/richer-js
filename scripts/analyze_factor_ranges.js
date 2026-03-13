/**
 * 分析因子区间的收益表现
 * 找出最佳过滤条件
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid-1] + sorted[mid]) / 2 : sorted[mid];
}

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

async function main() {
  console.log('=== 分析因子区间的收益表现 ===\n');

  const expId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取数据
  const { data: trades } = await supabase
    .from('trades')
    .select('token_address, token_symbol, trade_direction, input_amount, output_amount')
    .eq('experiment_id', expId);

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, metadata')
    .eq('experiment_id', expId)
    .eq('action', 'buy')
    .eq('executed', true);

  // 计算收益
  const tokenProfits = {};
  for (const trade of trades || []) {
    const addr = trade.token_address;
    if (!tokenProfits[addr]) {
      tokenProfits[addr] = { symbol: trade.token_symbol, spent: 0, received: 0 };
    }
    if (trade.trade_direction === 'buy') {
      tokenProfits[addr].spent += parseFloat(trade.input_amount || 0);
    } else {
      tokenProfits[addr].received += parseFloat(trade.output_amount || 0);
    }
  }

  const data = (signals || []).map(s => {
    const p = tokenProfits[s.token_address] || { spent: 0, received: 0 };
    const profit = p.spent > 0 ? ((p.received - p.spent) / p.spent * 100) : 0;
    return {
      address: s.token_address,
      symbol: s.token_symbol,
      profit,
      trendFactors: s.metadata?.trendFactors || {},
      preBuyCheckFactors: s.metadata?.preBuyCheckFactors || {}
    };
  });

  console.log(`总代币数: ${data.length}`);
  console.log(`平均收益: ${avg(data.map(d => d.profit)).toFixed(2)}%\n`);

  // 1. earlyReturn 区间分析
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【earlyReturn 区间分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const earRanges = [
    { min: 0, max: 100, label: '0-100%' },
    { min: 100, max: 200, label: '100-200%' },
    { min: 200, max: 300, label: '200-300%' },
    { min: 300, max: 500, label: '300-500%' },
    { min: 500, max: Infinity, label: '>500%' }
  ];

  console.log('区间'.padEnd(15) + '数量'.padEnd(8) + '胜率'.padEnd(10) + '平均收益'.padEnd(10) + '中位数收益');
  console.log('─'.repeat(70));

  for (const range of earRanges) {
    const filtered = data.filter(d => {
      const ear = d.trendFactors.earlyReturn || 0;
      return ear >= range.min && ear < range.max;
    });

    if (filtered.length === 0) continue;

    const profits = filtered.map(d => d.profit);
    const winRate = (profits.filter(p => p > 0).length / profits.length * 100).toFixed(1);
    const avgProfit = avg(profits).toFixed(2);
    const medProfit = median(profits).toFixed(2);

    console.log(
      range.label.padEnd(15) +
      filtered.length.toString().padEnd(8) +
      `${winRate}%`.padEnd(10) +
      `${avgProfit}%`.padEnd(10) +
      `${medProfit}%`
    );
  }

  // 2. age 区间分析
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【age 区间分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const ageRanges = [
    { min: 0, max: 1.2, label: '< 1.2 min' },
    { min: 1.2, max: 1.5, label: '1.2-1.5 min' },
    { min: 1.5, max: 2.0, label: '1.5-2.0 min' },
    { min: 2.0, max: 3.0, label: '2.0-3.0 min' },
    { min: 3.0, max: Infinity, label: '> 3.0 min' }
  ];

  console.log('区间'.padEnd(15) + '数量'.padEnd(8) + '胜率'.padEnd(10) + '平均收益'.padEnd(10) + '中位数收益');
  console.log('─'.repeat(70));

  for (const range of ageRanges) {
    const filtered = data.filter(d => {
      const age = d.trendFactors.age || 0;
      return age >= range.min && age < range.max;
    });

    if (filtered.length === 0) continue;

    const profits = filtered.map(d => d.profit);
    const winRate = (profits.filter(p => p > 0).length / profits.length * 100).toFixed(1);
    const avgProfit = avg(profits).toFixed(2);
    const medProfit = median(profits).toFixed(2);

    console.log(
      range.label.padEnd(15) +
      filtered.length.toString().padEnd(8) +
      `${winRate}%`.padEnd(10) +
      `${avgProfit}%`.padEnd(10) +
      `${medProfit}%`
    );
  }

  // 3. earlyTradesCountPerMin 区间分析
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【earlyTradesCountPerMin 区间分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const countRanges = [
    { min: 0, max: 50, label: '< 50' },
    { min: 50, max: 100, label: '50-100' },
    { min: 100, max: 200, label: '100-200' },
    { min: 200, max: 400, label: '200-400' },
    { min: 400, max: Infinity, label: '> 400' }
  ];

  console.log('区间'.padEnd(15) + '数量'.padEnd(8) + '胜率'.padEnd(10) + '平均收益'.padEnd(10) + '中位数收益');
  console.log('─'.repeat(70));

  for (const range of countRanges) {
    const filtered = data.filter(d => {
      const count = d.preBuyCheckFactors.earlyTradesCountPerMin || 0;
      return count >= range.min && count < range.max;
    });

    if (filtered.length === 0) continue;

    const profits = filtered.map(d => d.profit);
    const winRate = (profits.filter(p => p > 0).length / profits.length * 100).toFixed(1);
    const avgProfit = avg(profits).toFixed(2);
    const medProfit = median(profits).toFixed(2);

    console.log(
      range.label.padEnd(15) +
      filtered.length.toString().padEnd(8) +
      `${winRate}%`.padEnd(10) +
      `${avgProfit}%`.padEnd(10) +
      `${medProfit}%`
    );
  }

  // 4. walletClusterTop2Ratio 区间分析
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【walletClusterTop2Ratio 区间分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const clusterRanges = [
    { min: 0, max: 0.6, label: '< 0.6' },
    { min: 0.6, max: 0.8, label: '0.6-0.8' },
    { min: 0.8, max: 0.95, label: '0.8-0.95' },
    { min: 0.95, max: Infinity, label: '>= 0.95' }
  ];

  console.log('区间'.padEnd(15) + '数量'.padEnd(8) + '胜率'.padEnd(10) + '平均收益'.padEnd(10) + '中位数收益');
  console.log('─'.repeat(70));

  for (const range of clusterRanges) {
    const filtered = data.filter(d => {
      const ratio = d.preBuyCheckFactors.walletClusterTop2Ratio || 0;
      return ratio >= range.min && ratio < range.max;
    });

    if (filtered.length === 0) continue;

    const profits = filtered.map(d => d.profit);
    const winRate = (profits.filter(p => p > 0).length / profits.length * 100).toFixed(1);
    const avgProfit = avg(profits).toFixed(2);
    const medProfit = median(profits).toFixed(2);

    console.log(
      range.label.padEnd(15) +
      filtered.length.toString().padEnd(8) +
      `${winRate}%`.padEnd(10) +
      `${avgProfit}%`.padEnd(10) +
      `${medProfit}%`
    );
  }

  // 5. trendStrengthScore 区间分析
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【trendStrengthScore 区间分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const scoreRanges = [
    { min: 0, max: 70, label: '< 70' },
    { min: 70, max: 75, label: '70-75' },
    { min: 75, max: 80, label: '75-80' },
    { min: 80, max: Infinity, label: '>= 80' }
  ];

  console.log('区间'.padEnd(15) + '数量'.padEnd(8) + '胜率'.padEnd(10) + '平均收益'.padEnd(10) + '中位数收益');
  console.log('─'.repeat(70));

  for (const range of scoreRanges) {
    const filtered = data.filter(d => {
      const score = d.trendFactors.trendStrengthScore || 0;
      return score >= range.min && score < range.max;
    });

    if (filtered.length === 0) continue;

    const profits = filtered.map(d => d.profit);
    const winRate = (profits.filter(p => p > 0).length / profits.length * 100).toFixed(1);
    const avgProfit = avg(profits).toFixed(2);
    const medProfit = median(profits).toFixed(2);

    console.log(
      range.label.padEnd(15) +
      filtered.length.toString().padEnd(8) +
      `${winRate}%`.padEnd(10) +
      `${avgProfit}%`.padEnd(10) +
      `${medProfit}%`
    );
  }

  // 6. 组合条件分析
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【组合条件分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const combos = [
    {
      name: 'earlyReturn < 300% AND age > 1.3',
      filter: d => (d.trendFactors.earlyReturn || 0) < 300 && (d.trendFactors.age || 0) > 1.3
    },
    {
      name: 'earlyReturn < 400% AND age > 1.3',
      filter: d => (d.trendFactors.earlyReturn || 0) < 400 && (d.trendFactors.age || 0) > 1.3
    },
    {
      name: 'earlyReturn < 500% AND age > 1.5',
      filter: d => (d.trendFactors.earlyReturn || 0) < 500 && (d.trendFactors.age || 0) > 1.5
    },
    {
      name: 'earlyTradesCountPerMin < 250 AND age > 1.3',
      filter: d => (d.preBuyCheckFactors.earlyTradesCountPerMin || 0) < 250 && (d.trendFactors.age || 0) > 1.3
    },
    {
      name: 'earlyReturn < 400% AND earlyTradesCountPerMin < 300',
      filter: d => (d.trendFactors.earlyReturn || 0) < 400 && (d.preBuyCheckFactors.earlyTradesCountPerMin || 0) < 300
    },
    {
      name: 'age > 2.0 AND earlyReturn < 500%',
      filter: d => (d.trendFactors.age || 0) > 2.0 && (d.trendFactors.earlyReturn || 0) < 500
    }
  ];

  console.log('条件'.padEnd(50) + '数量'.padEnd(8) + '胜率'.padEnd(10) + '平均收益');
  console.log('─'.repeat(80));

  for (const combo of combos) {
    const filtered = data.filter(combo.filter);

    if (filtered.length === 0) continue;

    const profits = filtered.map(d => d.profit);
    const winRate = (profits.filter(p => p > 0).length / profits.length * 100).toFixed(1);
    const avgProfit = avg(profits).toFixed(2);

    console.log(
      combo.name.padEnd(50) +
      filtered.length.toString().padEnd(8) +
      `${winRate}%`.padEnd(10) +
      `${avgProfit}%`
    );
  }

  // 7. 建议的过滤条件
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【建议的过滤条件】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('基于数据分析，以下过滤条件可能有助于提高收益：');
  console.log('');
  console.log('1. 在第一阶段 (buyCondition) 添加：');
  console.log('   - earlyReturn < 400% (过滤掉过热的代币)');
  console.log('   - age > 1.3 min (等待更稳定后再买入)');
  console.log('');
  console.log('2. 在第二阶段 (preBuyCheckCondition) 添加：');
  console.log('   - earlyTradesCountPerMin < 300 (过滤掉交易过于密集的代币)');
  console.log('');
  console.log('注意：以上条件会减少交易数量，但可能提高胜率和平均收益。');
  console.log('建议在回测中验证这些条件的效果。');
}

main().catch(console.error);
