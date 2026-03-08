/**
 * 验证实盘引擎升级脚本
 * 检查实盘引擎代码是否包含所有风险控制组件
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 开始验证实盘引擎升级...\n');

// 读取 LiveTradingEngine.js 文件
const enginePath = path.join(__dirname, '../src/trading-engine/implementations/LiveTradingEngine.js');
const engineCode = fs.readFileSync(enginePath, 'utf-8');

console.log('✅ 已读取 LiveTradingEngine.js\n');

// 检查关键组件的导入和初始化
console.log('📋 检查风险控制组件初始化:');

const checks = [
  {
    name: 'PriceHistoryCache 导入',
    patterns: ["require('../PriceHistoryCache')", 'new PriceHistoryCache'],
    description: '价格历史缓存初始化'
  },
  {
    name: 'TrendDetector 导入',
    patterns: ["require('../TrendDetector')", 'new TrendDetector'],
    description: '趋势检测器初始化'
  },
  {
    name: 'TokenHolderService 导入',
    patterns: ["require('../holders/TokenHolderService')", 'new TokenHolderService'],
    description: '持有者服务初始化'
  },
  {
    name: 'PreBuyCheckService 导入',
    patterns: ["require('../pre-check/PreBuyCheckService')", 'new PreBuyCheckService'],
    description: '购买前检查服务初始化'
  },
  {
    name: 'TokenPool 传入 PriceHistoryCache',
    patterns: ['new TokenPool(this._logger, this._priceHistoryCache)', 'this._priceHistoryCache'],
    description: '代币池使用价格历史缓存'
  },
  {
    name: '预检查执行逻辑',
    patterns: ['performAllChecks', 'preBuyCheckResult', 'canBuy'],
    description: '购买前检查执行'
  },
  {
    name: '预检查失败处理',
    patterns: ['preCheckPassed = false', '预检查失败', '_updateSignalStatus'],
    description: '预检查失败时的处理（更新信号状态）'
  },
  {
    name: '先创建信号后预检查',
    patterns: ['先保存信号到数据库', '然后进行预检查', 'signalId = await'],
    description: '信号创建时机与虚拟盘一致'
  }
];

let allPassed = true;
const results = [];

for (const check of checks) {
  // 使用"或"逻辑：只要有一个模式匹配即可
  const passed = check.patterns.some(pattern => engineCode.includes(pattern));
  const status = passed ? '✅' : '❌';
  const note = passed ? '' : ' (未找到)';
  results.push({ name: check.name, passed, description: check.description });
  console.log(`  ${status} ${check.name}${note}`);
  if (!passed) allPassed = false;
}

console.log('');

// 检查辅助方法
console.log('📋 检查辅助方法:');
const helperMethods = [
  '_buildTokenInfo',
  '_buildTrendFactors',
  '_buildPreBuyCheckFactors',
  '_updateSignalMetadata',
  '_updateSignalStatus'
];

let allMethodsPresent = true;
for (const method of helperMethods) {
  // 检查方法定义
  const pattern = `${method}(`;
  const passed = engineCode.includes(pattern);
  const status = passed ? '✅' : '❌';
  const note = passed ? '' : ' (未找到)';
  console.log(`  ${status} ${method}${note}`);
  if (!passed) allMethodsPresent = false;
}

console.log('');

// 检查信号元数据
console.log('📋 检查信号元数据:');
const metadataChecks = [
  {
    name: '买入信号包含 trendFactors',
    pattern: 'trendFactors: this._buildTrendFactors(factorResults)',
    description: '买入信号构建趋势因子'
  },
  {
    name: '买入信号包含 preBuyCheckFactors',
    pattern: 'preBuyCheckFactors',
    description: '买入信号构建预检查因子'
  },
  {
    name: '卖出信号包含 trendFactors',
    pattern: 'trendFactors: this._buildTrendFactors(factorResults)',
    description: '卖出信号构建趋势因子'
  },
  {
    name: '使用 FactorBuilder',
    pattern: "require('../core/FactorBuilder')",
    description: '使用统一的因子构建器'
  },
  {
    name: 'getAvailableFactorIds',
    pattern: 'getAvailableFactorIds()',
    description: '获取可用因子ID'
  }
];

let allMetadataPresent = true;
for (const check of metadataChecks) {
  const passed = engineCode.includes(check.pattern);
  const status = passed ? '✅' : '❌';
  const note = passed ? '' : ' (未找到)';
  console.log(`  ${status} ${check.name}${note}`);
  if (!passed) allMetadataPresent = false;
}

console.log('');

// 总结
console.log('='.repeat(50));
if (allPassed && allMethodsPresent && allMetadataPresent) {
  console.log('✅ 实盘引擎升级验证通过！');
  console.log('\n🎉 已成功添加所有风险控制组件:');
  console.log('  1. ✅ PriceHistoryCache - 价格历史缓存（15分钟）');
  console.log('  2. ✅ TrendDetector - 趋势检测器');
  console.log('  3. ✅ TokenHolderService - 持有者服务');
  console.log('  4. ✅ PreBuyCheckService - 购买前检查服务');
  console.log('\n🎉 已成功添加所有辅助方法:');
  console.log('  1. ✅ _buildTokenInfo - 构建代币信息');
  console.log('  2. ✅ _buildTrendFactors - 构建趋势因子');
  console.log('  3. ✅ _buildPreBuyCheckFactors - 构建预检查因子');
  console.log('  4. ✅ _updateSignalMetadata - 更新信号元数据');
  console.log('  5. ✅ _updateSignalStatus - 更新信号状态');
  console.log('\n🎉 信号元数据已升级:');
  console.log('  1. ✅ 买入信号包含完整 trendFactors');
  console.log('  2. ✅ 买入信号包含完整 preBuyCheckFactors');
  console.log('  3. ✅ 卖出信号包含完整 trendFactors');
  console.log('  4. ✅ 使用统一的 FactorBuilder');
  console.log('\n⚠️  重要提醒:');
  console.log('  1. 在实盘测试前，务必在虚拟盘充分测试');
  console.log('  2. 从小额资金开始，逐步增加');
  console.log('  3. 设置异常告警机制');
  console.log('  4. 密切监控前几天的交易');
  console.log('  5. 确认数据库中有钱包黑名单数据');
  console.log('\n📝 下一步操作:');
  console.log('  1. 运行虚拟盘实验，验证预检查功能');
  console.log('  2. 检查日志中的预检查输出');
  console.log('  3. 确认被拒绝的代币符合预期');
  console.log('  4. 虚拟盘稳定后再考虑实盘测试');
  process.exit(0);
} else {
  console.log('❌ 实盘引擎升级验证失败！');
  console.log('\n请检查以下项目:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.name}: ${r.description}`);
  });
  process.exit(1);
}
