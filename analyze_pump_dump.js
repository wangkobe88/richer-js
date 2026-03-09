const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 用户提供的标注数据
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

async function analyzeLabeledTokens() {
  const experimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  console.log('=== 分析实验中的标注代币 ===');
  console.log('实验ID:', experimentId);
  console.log('');

  // 获取所有标注代币的购买信号
  const allAddresses = [...pumpAndDump, ...notPumpAndDump];

  const { data: signals, error } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .in('token_address', allAddresses)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  console.log('找到', signals.length, '个购买信号');
  console.log('');

  // 按代币分组，取最早的购买信号
  const tokenMap = new Map();

  signals.forEach(sig => {
    if (!tokenMap.has(sig.token_address)) {
      const metadata = sig.metadata || {};
      const preBuy = metadata.preBuyCheckFactors || {};

      tokenMap.set(sig.token_address, {
        address: sig.token_address,
        symbol: metadata.symbol || sig.token_address.substring(0, 8) + '...',
        buyTime: sig.created_at,
        buyPrice: metadata.price,
        preBuyFactors: preBuy,
        trendFactors: metadata.trendFactors || {}
      });
    }
  });

  console.log('=== 拉砸代币 ===');
  const pumpData = [];
  pumpAndDump.forEach(addr => {
    if (tokenMap.has(addr)) {
      const d = tokenMap.get(addr);
      d.isPump = true;
      pumpData.push(d);

      console.log(d.symbol + ':');
      console.log('  买入时间:', d.buyTime);
      console.log('  买入价格:', d.buyPrice);

      const tf = d.trendFactors;
      if (tf.earlyReturn !== undefined) {
        console.log('  earlyReturn:', tf.earlyReturn.toFixed(1) + '%');
      }
      if (tf.age !== undefined) {
        console.log('  age:', tf.age.toFixed(2) + '分钟');
      }
    } else {
      console.log(addr.substring(0,10) + '...: 无购买信号');
    }
  });

  console.log('');
  console.log('=== 非拉砸代币 ===');
  const normalData = [];
  notPumpAndDump.forEach(addr => {
    if (tokenMap.has(addr)) {
      const d = tokenMap.get(addr);
      d.isPump = false;
      normalData.push(d);

      console.log(d.symbol + ':');
      console.log('  买入时间:', d.buyTime);
      console.log('  买入价格:', d.buyPrice);

      const tf = d.trendFactors;
      if (tf.earlyReturn !== undefined) {
        console.log('  earlyReturn:', tf.earlyReturn.toFixed(1) + '%');
      }
      if (tf.age !== undefined) {
        console.log('  age:', tf.age.toFixed(2) + '分钟');
      }
    } else {
      console.log(addr.substring(0,10) + '...: 无购买信号');
    }
  });

  console.log('');
  console.log('=== 早期参与者数据对比 ===');
  console.log('');

  console.log('拉砸代币早期参与者指标:');
  pumpData.forEach(d => {
    const pb = d.preBuyFactors;
    console.log(d.symbol + ':');
    console.log('  交易: 总数=' + pb.earlyTradesTotalCount + ', /分=' + pb.earlyTradesCountPerMin + ', 钱包=' + pb.earlyTradesUniqueWallets);
    console.log('  聚簇: 数量=' + pb.walletClusterCount + ', 最大=' + pb.walletClusterMaxSize + ', 第二/第一=' + (pb.walletClusterSecondToFirstRatio?.toFixed(3) || 'N/A'));
  });

  console.log('');
  console.log('非拉砸代币早期参与者指标:');
  normalData.forEach(d => {
    const pb = d.preBuyFactors;
    console.log(d.symbol + ':');
    console.log('  交易: 总数=' + pb.earlyTradesTotalCount + ', /分=' + pb.earlyTradesCountPerMin + ', 钱包=' + pb.earlyTradesUniqueWallets);
    console.log('  聚簇: 数量=' + pb.walletClusterCount + ', 最大=' + pb.walletClusterMaxSize + ', 第二/第一=' + (pb.walletClusterSecondToFirstRatio?.toFixed(3) || 'N/A'));
  });

  // 统计对比
  console.log('');
  console.log('=== 统计对比 ===');

  const calcStats = (data, key) => {
    const values = data.map(d => d.preBuyFactors[key]).filter(v => v !== undefined && v !== null);
    if (values.length === 0) return null;
    return {
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length
    };
  };

  const compare = (name, key) => {
    const pumpStats = calcStats(pumpData, key);
    const normalStats = calcStats(normalData, key);

    if (pumpStats && normalStats) {
      console.log(name + ':');
      console.log('  拉砸: avg=' + pumpStats.avg.toFixed(1) + ', range=[' + pumpStats.min.toFixed(1) + ', ' + pumpStats.max.toFixed(1) + '] (' + pumpStats.count + '个)');
      console.log('  正常: avg=' + normalStats.avg.toFixed(1) + ', range=[' + normalStats.min.toFixed(1) + ', ' + normalStats.max.toFixed(1) + '] (' + normalStats.count + '个)');
    }
  };

  compare('总交易数', 'earlyTradesTotalCount');
  compare('交易/分', 'earlyTradesCountPerMin');
  compare('独立钱包', 'earlyTradesUniqueWallets');
  compare('高价值交易', 'earlyTradesHighValueCount');
  compare('聚簇数量', 'walletClusterCount');
  compare('最大簇', 'walletClusterMaxSize');
  compare('第二/第一比', 'walletClusterSecondToFirstRatio');
  compare('Mega簇比', 'walletClusterMegaRatio');

  return { pumpData, normalData };
}

analyzeLabeledTokens().catch(console.error);
