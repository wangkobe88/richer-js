// 验证 earlyWhale 相关代码是否已删除

console.log('验证删除结果:\n');

// 1. 检查 EarlyWhaleService.js 是否已删除
const fs = require('fs');
const servicePath = './src/trading-engine/pre-check/EarlyWhaleService.js';
try {
  if (fs.existsSync(servicePath)) {
    console.log('❌ EarlyWhaleService.js 仍然存在');
  } else {
    console.log('✅ EarlyWhaleService.js 已删除');
  }
} catch (e) {
  console.log('⚠️  检查 EarlyWhaleService.js 时出错:', e.message);
}

// 2. 检查 PreBuyCheckService.js 是否还有 earlyWhale 引用
const preBuyCheckPath = './src/trading-engine/pre-check/PreBuyCheckService.js';
try {
  const content = fs.readFileSync(preBuyCheckPath, 'utf8');
  if (content.includes('EarlyWhaleService') || content.includes('earlyWhaleService')) {
    console.log('❌ PreBuyCheckService.js 中仍有 EarlyWhaleService 引用');
  } else {
    console.log('✅ PreBuyCheckService.js 已移除 EarlyWhaleService 引用');
  }
  
  if (content.includes('_performEarlyWhaleCheck')) {
    console.log('❌ PreBuyCheckService.js 中仍有 _performEarlyWhaleCheck 方法');
  } else {
    console.log('✅ PreBuyCheckService.js 已删除 _performEarlyWhaleCheck 方法');
  }
  
  if (content.includes('earlyWhaleHoldRatio') || content.includes('earlyWhaleSellRatio')) {
    console.log('❌ PreBuyCheckService.js 中仍有 earlyWhale 相关因子');
  } else {
    console.log('✅ PreBuyCheckService.js 已移除 earlyWhale 相关因子');
  }
} catch (e) {
  console.log('⚠️  检查 PreBuyCheckService.js 时出错:', e.message);
}

// 3. 检查 FactorBuilder.js
const factorBuilderPath = './src/trading-engine/core/FactorBuilder.js';
try {
  const content = fs.readFileSync(factorBuilderPath, 'utf8');
  if (content.includes('earlyWhaleHoldRatio') || content.includes('earlyWhaleSellRatio')) {
    console.log('❌ FactorBuilder.js 中仍有 earlyWhale 相关因子');
  } else {
    console.log('✅ FactorBuilder.js 已移除 earlyWhale 相关因子');
  }
} catch (e) {
  console.log('⚠️  检查 FactorBuilder.js 时出错:', e.message);
}

// 4. 尝试加载 PreBuyCheckService 看是否有语法错误
try {
  const { PreBuyCheckService } = require('./src/trading-engine/pre-check/PreBuyCheckService');
  console.log('✅ PreBuyCheckService 加载成功（无语法错误）');
} catch (e) {
  console.log('❌ PreBuyCheckService 加载失败:', e.message);
}

// 5. 尝试加载 FactorBuilder 看是否有语法错误
try {
  const { buildPreBuyCheckFactorValues } = require('./src/trading-engine/core/FactorBuilder');
  console.log('✅ FactorBuilder 加载成功（无语法错误）');
} catch (e) {
  console.log('❌ FactorBuilder 加载失败:', e.message);
}

console.log('\n✅ 删除完成！');
