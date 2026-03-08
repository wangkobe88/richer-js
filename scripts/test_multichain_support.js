/**
 * 测试多链多平台支持
 *
 * 测试三个链的 pair 地址解析：
 * 1. Base bankr: 0x124a4ed43e2abf32b7e6a3d6dc1c8e47bbd1cba3
 * 2. Solana pumpfun: vnCnPd5qBTn383KbLvz6k7ZL83nJLbTqtbPjugjpump
 * 3. BSC fourmeme: 0xa991647e8a74aa07832843dd2f80e260200e4444
 */

require('dotenv').config({ path: 'config/.env' });
const { PlatformPairResolver } = require('../src/core/PlatformPairResolver');
const config = require('../config/default.json');

// 简单的 logger
const logger = {
  debug: (msg, data) => console.log(`[DEBUG] ${msg}`, data ? JSON.stringify(data) : ''),
  info: (msg, data) => console.log(`[INFO] ${msg}`, data ? JSON.stringify(data) : ''),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data ? JSON.stringify(data) : ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data ? JSON.stringify(data) : '')
};

async function testMultiChainSupport() {
  console.log('=== 多链多平台支持测试 ===\n');

  const resolver = new PlatformPairResolver(logger);

  // 测试用例
  const testCases = [
    {
      name: 'Base bankr',
      tokenAddress: '0x124a4ed43e2abf32b7e6a3d6dc1c8e47bbd1cba3',
      platform: 'bankr',
      chain: 'base',
      expectedPairFormat: 'api' // 从 API 获取
    },
    {
      name: 'Solana pumpfun',
      tokenAddress: 'vnCnPd5qBTn383KbLvz6k7ZL83nJLbTqtbPjugjpump',
      platform: 'pumpfun',
      chain: 'solana',
      expectedPairFormat: 'api' // 从 API 获取
    },
    {
      name: 'BSC fourmeme',
      tokenAddress: '0xa991647e8a74aa07832843dd2f80e260200e4444',
      platform: 'fourmeme',
      chain: 'bsc',
      expectedPairFormat: 'direct', // 直接拼接: address_fo
      expectedSuffix: '_fo'
    },
    {
      name: 'BSC flap',
      tokenAddress: '0x1234567890123456789012345678901234567890',
      platform: 'flap',
      chain: 'bsc',
      expectedPairFormat: 'direct', // 直接拼接: address_iportal
      expectedSuffix: '_iportal'
    }
  ];

  console.log(`总共 ${testCases.length} 个测试用例\n`);

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`--- 测试 ${i + 1}/${testCases.length}: ${testCase.name} ---`);
    console.log(`代币地址: ${testCase.tokenAddress}`);
    console.log(`平台: ${testCase.platform}`);
    console.log(`链: ${testCase.chain}`);

    try {
      const result = await resolver.resolvePairAddress(testCase.tokenAddress, testCase.platform, testCase.chain);

      console.log(`✅ 解析成功`);
      console.log(`   Pair 地址: ${result.pairAddress}`);
      console.log(`   平台: ${result.platform}`);
      console.log(`   链: ${result.chain}`);

      // 构建 pairId（用于 getSwapTransactions）
      const pairId = resolver.buildPairId(result.pairAddress, result.chain);
      console.log(`   Pair ID: ${pairId}`);

      // 验证结果
      if (testCase.expectedPairFormat === 'direct') {
        const expectedPairAddress = testCase.tokenAddress + testCase.expectedSuffix;
        if (result.pairAddress === expectedPairAddress) {
          console.log(`   ✅ 格式验证通过: 直接拼接正确`);
        } else {
          console.log(`   ❌ 格式验证失败: 期望 ${expectedPairAddress}, 实际 ${result.pairAddress}`);
        }
      } else if (testCase.expectedPairFormat === 'api') {
        console.log(`   ℹ️  Pair 地址来自 API 调用`);
      }

      // 测试缓存（第二次调用应该使用缓存）
      const startTime = Date.now();
      const cachedResult = await resolver.resolvePairAddress(testCase.tokenAddress, testCase.platform, testCase.chain);
      const cacheTime = Date.now() - startTime;

      if (cachedResult.pairAddress === result.pairAddress) {
        console.log(`   ✅ 缓存测试通过 (${cacheTime}ms)`);
      } else {
        console.log(`   ❌ 缓存测试失败`);
      }

    } catch (error) {
      console.log(`❌ 解析失败: ${error.message}`);
    }

    console.log('');
  }

  // 显示缓存统计
  console.log('=== 缓存统计 ===');
  const cacheStats = resolver.getCacheStats();
  console.log(JSON.stringify(cacheStats, null, 2));

  // 测试支持的平台列表
  console.log('\n=== 支持的平台 ===');
  const platforms = PlatformPairResolver.getSupportedPlatforms();
  platforms.forEach(platform => {
    const platformConfig = PlatformPairResolver.getPlatformConfig(platform);
    console.log(`- ${platform}: ${platformConfig.name} (${platformConfig.chain})`);
    console.log(`  策略: ${platformConfig.strategy}`);
    if (platformConfig.strategy === 'direct') {
      console.log(`  后缀: ${platformConfig.suffix}`);
    }
  });

  console.log('\n=== 测试完成 ===');
}

// 运行测试
testMultiChainSupport()
  .then(() => {
    console.log('测试成功完成');
    process.exit(0);
  })
  .catch(error => {
    console.error('测试失败:', error);
    process.exit(1);
  });
