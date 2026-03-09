const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeEdgeCases() {
  const experimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  console.log('=== 边界案例深度分析 ===');
  console.log('');

  // 获取所有信号和对应的交易数据
  const pumpAndDump = [
    '0x2be52e98e45ed3d27f56284972b3545dac964444',
    '0x281f05868b5ba9e55869541a117ebb661f474444',
    '0xf3372a3dbc824f0b0044ca77209559514b294444',
    '0xb9b1142a28fade5771b7ae076c96c3bee8beffff',
    '0xd8d4ddeb91987a121422567260a88230dbb34444',
    '0x68b04d6e06495866cc810d4179caf97651a5ffff',
    '0x98fe71847aa16d9e40a4f0e123d172bc71d14444',
    '0x721f5abc0d34948aa0904ba135cc4d9c6ff84444'
  ];

  const notPumpAndDump = [
    '0x1443d233e2dbad52df65e6b17063274e6c844444',
    '0xf40dec26ab76df60a761e78c84682d7117a64444',
    '0x0da3a0a3bd66bbeaaa4d35d12cb9ea3725294444',
    '0x16aeb87aeb78e4cf7987f16e910c285d77354444',
    '0xa9fe96fd5230a135ada220523032b3e1a67d4444',
    '0x4d15d67fcf9bd0b109efa7fc1b150416cca04444',
    '0xd7a23f95c6698c44c7b861408f0d7b47acc74444'
  ];

  const allAddresses = [...pumpAndDump, ...notPumpAndDump];

  // 获取购买信号
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .in('token_address', allAddresses);

  // 获取卖出信号
  const { data: sellSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'sell')
    .in('token_address', allAddresses);

  // 获取交易记录
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .in('token_address', allAddresses)
    .order('created_at', { ascending: true });

  console.log('=== 第一类：标注为"拉砸"但特征不明显的代币 ===');
  console.log('');

  // 这些代币的超级簇指标不高
  const unclearPump = [
    '0x2be52e98e45ed3d27f56284972b3545dac964444',  // maxClusterRatio=0.513, 无超级簇
    '0x68b04d6e06495866cc810d4179caf97651a5ffff',  // maxClusterRatio=0.469, 无超级簇
    '0x721f5abc0d34948aa0904ba135cc4d9c6ff84444'   // maxClusterRatio=0.495
  ];

  unclearPump.forEach(addr => {
    const buySig = buySignals?.find(s => s.token_address === addr);
    const sellSig = sellSignals?.find(s => s.token_address === addr);
    const trade = trades?.filter(t => t.token_address === addr);

    if (buySig) {
      const metadata = buySig.metadata || {};
      const preBuy = metadata.preBuyCheckFactors || {};

      console.log('代币:', metadata.symbol || addr.substring(0, 10));
      console.log('  聚簇特征:');
      console.log('    簇数量:', preBuy.walletClusterCount);
      console.log('    最大簇:', preBuy.walletClusterMaxSize);
      console.log('    最大簇占比:', (preBuy.walletClusterMaxSize / preBuy.earlyTradesTotalCount).toFixed(3));
      console.log('    第二/第一比:', preBuy.walletClusterSecondToFirstRatio?.toFixed(3));
      console.log('    Mega簇比:', preBuy.walletClusterMegaRatio?.toFixed(3));
      console.log('');

      // 计算实际交易结果
      if (sellSig && buySig) {
        const buyPrice = buySig.metadata?.price || 0;
        const sellPrice = sellSig.metadata?.price || 0;
        const profitPct = ((sellPrice - buyPrice) / buyPrice * 100);

        console.log('  实际交易结果:');
        console.log('    买入价格:', buyPrice);
        console.log('    卖出价格:', sellPrice);
        console.log('    盈亏:', profitPct.toFixed(1) + '%');
        console.log('');
      }

      // 分析时间特征
      if (trade && trade.length > 0) {
        const buyTime = new Date(buySig.created_at).getTime();
        const sellTime = sellSig ? new Date(sellSig.created_at).getTime() : buyTime;
        const holdDuration = (sellTime - buyTime) / 1000;

        console.log('  时间特征:');
        console.log('    持仓时间:', holdDuration.toFixed(0), '秒');
        console.log('');
      }
    }
  });

  console.log('=== 第二类：标注为"非拉砸"但具有极端拉砸特征的代币 ===');
  console.log('');

  // 这些代币有超级簇或极端特征
  const extremeNormal = [
    '0xf40dec26ab76df60a761e78c84682d7117a64444',  // 最大簇244，占比0.838
    '0x0da3a0a3bd66bbeaaa4d35d12cb9ea3725294444'   // 最大簇300，占比1.000
  ];

  extremeNormal.forEach(addr => {
    const buySig = buySignals?.find(s => s.token_address === addr);
    const sellSig = sellSignals?.find(s => s.token_address === addr);
    const trade = trades?.filter(t => t.token_address === addr);

    if (buySig) {
      const metadata = buySig.metadata || {};
      const preBuy = metadata.preBuyCheckFactors || {};

      console.log('代币:', metadata.symbol || addr.substring(0, 10));
      console.log('  聚簇特征:');
      console.log('    簇数量:', preBuy.walletClusterCount);
      console.log('    最大簇:', preBuy.walletClusterMaxSize);
      console.log('    最大簇占比:', (preBuy.walletClusterMaxSize / preBuy.earlyTradesTotalCount).toFixed(3));
      console.log('    第二/第一比:', preBuy.walletClusterSecondToFirstRatio?.toFixed(3));
      console.log('    Mega簇比:', preBuy.walletClusterMegaRatio?.toFixed(3));
      console.log('');

      // 计算实际交易结果
      if (sellSig && buySig) {
        const buyPrice = buySig.metadata?.price || 0;
        const sellPrice = sellSig.metadata?.price || 0;
        const profitPct = ((sellPrice - buyPrice) / buyPrice * 100);

        console.log('  实际交易结果:');
        console.log('    买入价格:', buyPrice);
        console.log('    卖出价格:', sellPrice);
        console.log('    盈亏:', profitPct.toFixed(1) + '%');
        console.log('');
      }

      // 分析时间特征
      if (trade && trade.length > 0) {
        const buyTime = new Date(buySig.created_at).getTime();
        const sellTime = sellSig ? new Date(sellSig.created_at).getTime() : buyTime;
        const holdDuration = (sellTime - buyTime) / 1000;

        console.log('  时间特征:');
        console.log('    持仓时间:', holdDuration.toFixed(0), '秒');
        console.log('');
      }
    }
  });

  console.log('=== 第三类：分析被正确识别的案例 ===');
  console.log('');

  // 被正确识别为拉砸的代币
  const clearPump = [
    '0xf3372a3dbc824f0b0044ca77209559514b294444',  // 超级簇283笔
    '0xb9b1142a28fade5771b7ae076c96c3bee8beffff',  // 超级簇286笔
    '0xd8d4ddeb91987a121422567260a88230dbb34444'   // 超级簇300笔
  ];

  console.log('--- 拉砸代币（超级簇） ---');
  clearPump.forEach(addr => {
    const buySig = buySignals?.find(s => s.token_address === addr);
    if (buySig) {
      const metadata = buySig.metadata || {};
      const preBuy = metadata.preBuyCheckFactors || {};
      console.log(metadata.symbol || addr.substring(0, 10) + ':');
      console.log('  超级簇=' + preBuy.walletClusterMaxSize + '笔, 占比=' + (preBuy.walletClusterMaxSize / preBuy.earlyTradesTotalCount).toFixed(3));
    }
  });

  // 被正确识别为正常的代币
  const clearNormal = [
    '0x1443d233e2dbad52df65e6b17063274e6c844444',  // 最大簇7，占比0.304
    '0x16aeb87aeb78e4cf7987f16e910c285d77354444',  // 最大簇29，占比0.284
    '0x4d15d67fcf9bd0b109efa7fc1b150416cca04444'   // 最大簇9，占比0.300
  ];

  console.log('');
  console.log('--- 非拉砸代币（多小簇） ---');
  clearNormal.forEach(addr => {
    const buySig = buySignals?.find(s => s.token_address === addr);
    if (buySig) {
      const metadata = buySig.metadata || {};
      const preBuy = metadata.preBuyCheckFactors || {};
      console.log(metadata.symbol || addr.substring(0, 10) + ':');
      console.log('  簇数量=' + preBuy.walletClusterCount + ', 最大簇=' + preBuy.walletClusterMaxSize + '笔, 占比=' + (preBuy.walletClusterMaxSize / preBuy.earlyTradesTotalCount).toFixed(3));
    }
  });

  console.log('');
  console.log('=== 关键发现 ===');
  console.log('');
  console.log('1. 标注为"非拉砸"的代币中，有2个具有极端拉砸特征：');
  console.log('   - 0xf40dec... 和 0x0da3a0... 都有单簇300笔、占比>80%的特征');
  console.log('   - 这些可能是标注错误，或者是边界案例');
  console.log('');
  console.log('2. 标注为"拉砸"的代币中，有3个聚簇特征不明显：');
  console.log('   - 0x2be52e..., 0x68b04d..., 0x721f5a...');
  console.log('   - 这些可能是"隐蔽型拉砸"，无法通过聚簇特征检测');
  console.log('');
  console.log('3. 建议解决方案：');
  console.log('   A. 重新确认标注数据，特别是具有极端特征的"非拉砸"代币');
  console.log('   B. 对于"隐蔽型拉砸"，需要引入其他特征（如价格波动率）');
  console.log('   C. 考虑使用"超级簇"(>200笔)作为强拉砸指标');
}

analyzeEdgeCases().catch(console.error);
