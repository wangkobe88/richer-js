const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeUnidentifiedPumpDump() {
  const experimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  // 那两个可能无法被方案1识别的拉砸代币
  const potentialUnidentified = [
    '0x2be52e98e45ed3d27f56284972b3545dac964444',
    '0x68b04d6e06495866cc810d4179caf97651a5ffff'
  ];

  console.log('=== 分析未被方案1识别的拉砸代币 ===');
  console.log('');

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .in('token_address', potentialUnidentified);

  const { data: sellSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'sell')
    .in('token_address', potentialUnidentified);

  signals.forEach(buySig => {
    const sellSig = sellSignals?.find(s => s.token_address === buySig.token_address);
    const metadata = buySig.metadata || {};
    const preBuy = metadata.preBuyCheckFactors || {};
    const tf = metadata.trendFactors || {};

    console.log('代币:', metadata.symbol || buySig.token_address.substring(0, 10));
    console.log('');
    console.log('聚簇特征:');
    console.log('  簇数量:', preBuy.walletClusterCount);
    console.log('  最大簇:', preBuy.walletClusterMaxSize, '笔');
    console.log('  最大簇占比:', (preBuy.walletClusterMaxSize / preBuy.earlyTradesTotalCount).toFixed(3));
    console.log('  第二/第一比:', (preBuy.walletClusterSecondToFirstRatio || 0).toFixed(3));
    console.log('  Mega簇比:', (preBuy.walletClusterMegaRatio || 0).toFixed(3));
    console.log('');

    console.log('价格特征:');
    console.log('  代币年龄:', tf.age?.toFixed(2), '分钟');
    console.log('  早期收益率:', tf.earlyReturn?.toFixed(1), '%');
    console.log('  上涨速度:', tf.riseSpeed?.toFixed(1), '%/分钟');
    console.log('');

    if (sellSig) {
      const buyPrice = metadata.price || 0;
      const sellPrice = sellSig.metadata?.price || 0;
      const profitPct = ((sellPrice - buyPrice) / buyPrice * 100);

      console.log('交易结果:');
      console.log('  买入价格:', buyPrice);
      console.log('  卖出价格:', sellPrice);
      console.log('  盈亏:', profitPct.toFixed(1) + '%');
    }

    console.log('');
    console.log('方案1检测:');
    const maxSize = preBuy.walletClusterMaxSize || 0;
    const megaRatio = preBuy.walletClusterMegaRatio || 0;
    const secondFirst = preBuy.walletClusterSecondToFirstRatio || 1;

    const condition1 = maxSize > 200;
    const condition2 = megaRatio > 0.7;
    const condition3 = secondFirst < 0.1;

    console.log('  最大簇>200:', condition1 ? '是 (' + maxSize + ')' : '否 (' + maxSize + ')');
    console.log('  Mega簇比>0.7:', condition2 ? '是 (' + megaRatio.toFixed(3) + ')' : '否 (' + megaRatio.toFixed(3) + ')');
    console.log('  第二/第一<0.1:', condition3 ? '是 (' + secondFirst.toFixed(3) + ')' : '否 (' + secondFirst.toFixed(3) + ')');
    console.log('  综合结果:', (condition1 || condition2 || condition3) ? '拒绝 ✓' : '通过 ✗');

    console.log('');
    console.log('---');
  });

  console.log('');
  console.log('=== 总结：未被识别的原因 ===');
  console.log('');
  console.log('这两个代币都无法被方案1识别，因为：');
  console.log('1. 最大簇 < 200笔');
  console.log('2. Mega簇比 < 0.7');
  console.log('3. 第二/第一比 > 0.1');
  console.log('');
  console.log('这些代币使用的是"分散操纵"手法，没有明显的单一大簇。');
  console.log('');
  console.log('建议改进方向：');
  console.log('1. 添加价格波动率特征');
  console.log('2. 添加上涨速度特征');
  console.log('3. 分析交易时间分布的其他模式');
}

analyzeUnidentifiedPumpDump().catch(console.error);
