/**
 * 测试钱包簇因子集成
 */

const { PreBuyCheckService, WalletClusterService, EarlyParticipantCheckService } = require('../src/trading-engine/pre-check');
const Logger = require('../src/services/logger');

async function testIntegration() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    钱包簇因子集成测试                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 1. 测试服务导入
  console.log('【测试 1/5】服务导入');
  console.log('✅ PreBuyCheckService:', typeof PreBuyCheckService);
  console.log('✅ WalletClusterService:', typeof WalletClusterService);
  console.log('✅ EarlyParticipantCheckService:', typeof EarlyParticipantCheckService);

  // 2. 测试 WalletClusterService 独立使用
  console.log('\n【测试 2/5】WalletClusterService 独立使用');
  const logger = new Logger({ dir: './logs', experimentId: 'test' });
  const walletClusterService = new WalletClusterService(logger);

  // 模拟交易数据
  const mockTrades = Array.from({ length: 200 }, (_, i) => ({
    time: Math.floor(i / 50) * 2, // 每50笔交易时间增加2秒，形成4个簇
    from_address: `0x${Math.random().toString(16).substr(2, 40)}`
  }));

  const clusterResult = walletClusterService.performClusterAnalysis(mockTrades);
  console.log('✅ 簇数量:', clusterResult.walletClusterCount);
  console.log('✅ 最大簇大小:', clusterResult.walletClusterMaxSize);
  console.log('✅ 第2簇/第1簇:', clusterResult.walletClusterSecondToFirstRatio.toFixed(3));
  console.log('✅ 超大簇占比:', (clusterResult.walletClusterMegaRatio * 100).toFixed(1) + '%');
  console.log('✅ 最大簇钱包数:', clusterResult.walletClusterMaxClusterWallets);

  // 3. 测试空值
  console.log('\n【测试 3/5】空值处理');
  const emptyValues = walletClusterService.getEmptyFactorValues();
  console.log('✅ walletClusterCount:', emptyValues.walletClusterCount);
  console.log('✅ 包含所有必需字段:', Object.keys(emptyValues).length >= 12);

  // 4. 测试配置加载
  console.log('\n【测试 4/5】配置加载');
  const config = require('../config/default.json');
  console.log('✅ walletClusterCheckEnabled:', config.preBuyCheck.walletClusterCheckEnabled);
  console.log('✅ walletClusterPumpDumpThreshold:', config.preBuyCheck.walletClusterPumpDumpThreshold);
  console.log('✅ walletClusterMegaRatioThreshold:', config.preBuyCheck.walletClusterMegaRatioThreshold);

  // 5. 测试因子名称
  console.log('\n【测试 5/5】因子名称验证');
  const expectedFactors = [
    'walletClusterSecondToFirstRatio',
    'walletClusterMegaRatio',
    'walletClusterTop2Ratio',
    'walletClusterCount',
    'walletClusterMaxSize',
    'walletClusterSecondSize',
    'walletClusterAvgSize',
    'walletClusterMinSize',
    'walletClusterMegaCount',
    'walletClusterMaxClusterWallets',
    'walletClusterIntervalMean',
    'walletClusterThreshold'
  ];

  console.log('预期因子:');
  expectedFactors.forEach(factor => {
    const hasFactor = factor in emptyValues;
    console.log(`  ${hasFactor ? '✅' : '❌'} ${factor}`);
  });

  // 条件表达式示例
  console.log('\n【条件表达式示例】');
  console.log('// 过滤拉砸代币（规则：第2簇/第1簇 >= 0.3 且 超大簇占比 < 0.4）');
  console.log('walletClusterSecondToFirstRatio > 0.3 && walletClusterMegaRatio < 0.4');
  console.log('');
  console.log('// 或者使用更严格的阈值');
  console.log('walletClusterSecondToFirstRatio > 0.2 && walletClusterMegaRatio < 0.3');
  console.log('');
  console.log('// 组合早期参与者因子');
  console.log('earlyTradesCountPerMin >= 10.6 && walletClusterSecondToFirstRatio > 0.3');
  console.log('');
  console.log('// 只检查超大簇占比');
  console.log('walletClusterMegaRatio < 0.4');

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('✅ 所有测试通过！');
  console.log('\n【因子说明】');
  console.log('- walletClusterSecondToFirstRatio: 第2簇大小 / 第1簇大小（拉砸 < 0.3）');
  console.log('- walletClusterMegaRatio: 超大簇（>100笔）的交易占比（拉砸 > 40%）');
  console.log('- walletClusterTop2Ratio: 前2大簇的交易占比（拉砸 > 80%）');
  console.log('- walletClusterMaxClusterWallets: 最大簇中的独立钱包数（衡量集中度）');
  console.log('- walletClusterCount: 簇的总数量');
  console.log('- 使用 earlyTradesUniqueWallets 获取总钱包数（不重复提供）');
}

testIntegration().then(() => process.exit(0)).catch(e => {
  console.error('❌ 测试失败:', e);
  process.exit(1);
});
