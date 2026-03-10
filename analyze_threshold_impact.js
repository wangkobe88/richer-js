const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeThresholdImpact() {
  const newExpId = 'bd7e63a2-8f56-4dfd-baef-a1c70d435384'; // 新实验（修复后）
  const oldExpId = '233e4d94-e771-463a-9296-a93483a9ce96'; // 旧实验（修复前）

  console.log('=== 分析调整阈值的影响 ===\n');
  console.log('当前阈值: earlyWhaleSellRatio <= 0.7');
  console.log('建议阈值: earlyWhaleSellRatio <= 0.85');
  console.log('');

  // 获取新实验的信号
  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, metadata, executed')
    .eq('experiment_id', newExpId);

  if (!newSignals || newSignals.length === 0) {
    console.log('没有信号数据');
    return;
  }

  // 分析 earlyWhaleSellRatio 分布
  const signalsWithWhaleData = newSignals.filter(s => {
    const ratio = s.metadata?.preBuyCheckFactors?.earlyWhaleSellRatio;
    return ratio !== undefined && ratio !== null;
  });

  console.log('=== EarlyWhaleSellRatio 分布 ===\n');
  console.log('有 whale 数据的信号:', signalsWithWhaleData.length);
  console.log('');

  // 按区间统计
  const ranges = [
    { label: '0-50%', min: 0, max: 0.5, count: 0, executed: 0 },
    { label: '50-60%', min: 0.5, max: 0.6, count: 0, executed: 0 },
    { label: '60-70%', min: 0.6, max: 0.7, count: 0, executed: 0 },
    { label: '70-75%', min: 0.7, max: 0.75, count: 0, executed: 0 },
    { label: '75-80%', min: 0.75, max: 0.8, count: 0, executed: 0 },
    { label: '80-85%', min: 0.8, max: 0.85, count: 0, executed: 0 },
    { label: '85-90%', min: 0.85, max: 0.9, count: 0, executed: 0 },
    { label: '90-95%', min: 0.9, max: 0.95, count: 0, executed: 0 },
    { label: '95-100%', min: 0.95, max: 1.0, count: 0, executed: 0 },
  ];

  signalsWithWhaleData.forEach(s => {
    const ratio = s.metadata.preBuyCheckFactors.earlyWhaleSellRatio;
    const executed = s.executed === true ? 1 : 0;
    
    for (const range of ranges) {
      if (ratio >= range.min && ratio < range.max) {
        range.count++;
        range.executed += executed;
        break;
      }
    }
  });

  console.log('区间分布:');
  ranges.forEach(r => {
    const percentage = r.count > 0 ? ((r.executed / r.count) * 100).toFixed(1) : '0';
    console.log(`  ${r.label.padEnd(10)} ${r.count.toString().padStart(4)} 个信号 (${r.executed} 执行, ${percentage}%)`);
  });
  console.log('');

  // 重点分析 70%-85% 区间（会被新阈值影响的信号）
  const signalsIn70to85 = signalsWithWhaleData.filter(s => {
    const ratio = s.metadata.preBuyCheckFactors.earlyWhaleSellRatio;
    return ratio >= 0.7 && ratio <= 0.85;
  });

  console.log('=== 关键区间 (70%-85%) 分析 ===\n');
  console.log('信号数量:', signalsIn70to85.length);
  console.log('');

  if (signalsIn70to85.length > 0) {
    console.log('详细数据:');
    signalsIn70to85.forEach((s, i) => {
      const ratio = s.metadata.preBuyCheckFactors.earlyWhaleSellRatio;
      const whaleCount = s.metadata.preBuyCheckFactors.earlyWhaleCount;
      const executed = s.executed;
      const symbol = s.token_symbol || s.token_address?.substring(0, 10);
      
      console.log(`  ${i + 1}. ${symbol}`);
      console.log(`     SellRatio: ${(ratio * 100).toFixed(1)}%, WhaleCount: ${whaleCount}, Executed: ${executed ? '✅' : '❌'}`);
    });
  }
  console.log('');

  // 对比旧实验中这些代币的表现
  console.log('=== 对比旧实验中这些代币的表现 ===\n');
  
  const oldExpTokens = signalsIn70to85.map(s => s.token_address);
  
  if (oldExpTokens.length > 0) {
    const { data: oldTrades } = await supabase
      .from('trades')
      .select('token_address, pnl, pnl_percent')
      .eq('experiment_id', oldExpId)
      .in('token_address', oldExpTokens);

    if (oldTrades && oldTrades.length > 0) {
      console.log('旧实验中这些代币的交易结果:');
      let totalPnL = 0;
      oldTrades.forEach(t => {
        const pnl = t.pnl || 0;
        const pnlPercent = t.pnl_percent || 0;
        totalPnL += pnl;
        
        // 查找符号
        const signal = newSignals.find(s => s.token_address === t.token_address);
        const symbol = signal?.token_symbol || t.token_address?.substring(0, 10);
        const ratio = signal?.metadata?.preBuyCheckFactors?.earlyWhaleSellRatio || 0;
        
        console.log(`  ${symbol}: PnL=${pnl.toFixed(2)} (${pnlPercent.toFixed(1)}%), SellRatio=${(ratio * 100).toFixed(1)}%`);
      });
      console.log(`  总计: ${totalPnL.toFixed(2)} USDT`);
    } else {
      console.log('旧实验中没有这些代币的交易记录');
    }
  }

  // 统计如果使用 0.85 阈值会有多少额外信号
  const passed070 = signalsWithWhaleData.filter(s => s.metadata.preBuyCheckFactors.earlyWhaleSellRatio <= 0.7);
  const passed085 = signalsWithWhaleData.filter(s => s.metadata.preBuyCheckFactors.earlyWhaleSellRatio <= 0.85);

  console.log('\n=== 阈值调整影响 ===\n');
  console.log('阈值 0.70: 通过', passed070.length, '个信号');
  console.log('阈值 0.85: 通过', passed085.length, '个信号');
  console.log('增加信号数:', passed085.length - passed070.length, '个');
  console.log('增加比例:', (((passed085.length - passed070.length) / passed070.length) * 100).toFixed(1) + '%');
}

analyzeThresholdImpact().catch(console.error);
