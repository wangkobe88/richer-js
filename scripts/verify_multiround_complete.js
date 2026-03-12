/**
 * 完整验证多次交易功能
 * 检查从配置到因子存储的整个链路
 */

const fs = require('fs');
const path = require('path');

console.log('=== 多次交易功能完整性验证 ===\n');

let allPassed = true;

// 1. 检查前端表单
console.log('1. 检查前端表单...');
try {
    const htmlPath = path.join(__dirname, '../src/web/templates/create_experiment.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    const hasRepeatInput = html.includes('name="buy_repeatCheck_condition_');
    const hasCollectLogic = html.includes('repeatBuyCheckCondition: repeatBuyCheckInput');
    const hasCopyLogic = html.includes('repeatBuyCheckCondition: strategy.repeatBuyCheckCondition');

    if (hasRepeatInput && hasCollectLogic && hasCopyLogic) {
        console.log('   ✅ 前端表单包含 repeatBuyCheckCondition 字段\n');
    } else {
        console.log('   ❌ 前端表单缺少相关字段或逻辑');
        console.log(`      - hasRepeatInput: ${hasRepeatInput}`);
        console.log(`      - hasCollectLogic: ${hasCollectLogic}`);
        console.log(`      - hasCopyLogic: ${hasCopyLogic}\n`);
        allPassed = false;
    }
} catch (e) {
    console.log(`   ❌ 读取前端文件失败: ${e.message}\n`);
    allPassed = false;
}

// 2. 检查 BacktestEngine 配置读取
console.log('2. 检查 BacktestEngine 配置读取...');
try {
    const enginePath = path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js');
    const engine = fs.readFileSync(enginePath, 'utf-8');

    const hasReadConfig = engine.includes('repeatBuyCheckCondition = buyStrategyConfig.repeatBuyCheckCondition');
    const hasAssignToStrategy = engine.includes('strategy.repeatBuyCheckCondition = repeatBuyCheckCondition');
    const hasConditionSelect = engine.includes('if (currentRound === 0)');
    const hasFallback = engine.includes("preBuyCheckCondition = strategy.repeatBuyCheckCondition || strategy.preBuyCheckCondition");

    if (hasReadConfig && hasAssignToStrategy && hasConditionSelect && hasFallback) {
        console.log('   ✅ BacktestEngine 正确读取和选择条件\n');
    } else {
        console.log('   ❌ BacktestEngine 配置读取有问题');
        console.log(`      - hasReadConfig: ${hasReadConfig}`);
        console.log(`      - hasAssignToStrategy: ${hasAssignToStrategy}`);
        console.log(`      - hasConditionSelect: ${hasConditionSelect}`);
        console.log(`      - hasFallback: ${hasFallback}\n`);
        allPassed = false;
    }
} catch (e) {
    console.log(`   ❌ 读取 BacktestEngine 失败: ${e.message}\n`);
    allPassed = false;
}

// 3. 检查 VirtualTradingEngine 配置读取
console.log('3. 检查 VirtualTradingEngine 配置读取...');
try {
    const enginePath = path.join(__dirname, '../src/trading-engine/implementations/VirtualTradingEngine.js');
    const engine = fs.readFileSync(enginePath, 'utf-8');

    const hasRepeatField = engine.includes('repeatBuyCheckCondition: s.repeatBuyCheckCondition');
    const hasConditionSelect = engine.includes('if (currentRound === 0)');
    const hasFallback = engine.includes("preBuyCheckCondition = strategy.repeatBuyCheckCondition || strategy.preBuyCheckCondition");

    if (hasRepeatField && hasConditionSelect && hasFallback) {
        console.log('   ✅ VirtualTradingEngine 正确读取和选择条件\n');
    } else {
        console.log('   ❌ VirtualTradingEngine 配置读取有问题');
        console.log(`      - hasRepeatField: ${hasRepeatField}`);
        console.log(`      - hasConditionSelect: ${hasConditionSelect}`);
        console.log(`      - hasFallback: ${hasFallback}\n`);
        allPassed = false;
    }
} catch (e) {
    console.log(`   ❌ 读取 VirtualTradingEngine 失败: ${e.message}\n`);
    allPassed = false;
}

// 4. 检查 completedPairs 更新逻辑
console.log('4. 检查 completedPairs 更新逻辑...');
try {
    const backtestPath = path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js');
    const backtest = fs.readFileSync(backtestPath, 'utf-8');

    const hasPush = backtest.includes('tokenState.completedPairs.push({');
    const hasReturnRate = backtest.includes('returnRate: returnRate');
    const hasBuyTime = backtest.includes('buyTime: tokenState.buyTime');

    if (hasPush && hasReturnRate && hasBuyTime) {
        console.log('   ✅ BacktestEngine 正确更新 completedPairs');
    } else {
        console.log('   ❌ BacktestEngine completedPairs 更新有问题');
        console.log(`      - hasPush: ${hasPush}`);
        console.log(`      - hasReturnRate: ${hasReturnRate}`);
        console.log(`      - hasBuyTime: ${hasBuyTime}`);
        allPassed = false;
    }
} catch (e) {
    console.log(`   ❌ 读取 BacktestEngine 失败: ${e.message}`);
    allPassed = false;
}

try {
    const virtualPath = path.join(__dirname, '../src/trading-engine/implementations/VirtualTradingEngine.js');
    const virtual = fs.readFileSync(virtualPath, 'utf-8');

    const hasAddCall = virtual.includes('this._tokenPool.addCompletedPair(');
    const hasReturnRate = virtual.includes('returnRate: returnRate');

    if (hasAddCall && hasReturnRate) {
        console.log('   ✅ VirtualTradingEngine 正确更新 completedPairs\n');
    } else {
        console.log('   ❌ VirtualTradingEngine completedPairs 更新有问题');
        console.log(`      - hasAddCall: ${hasAddCall}`);
        console.log(`      - hasReturnRate: ${hasReturnRate}\n`);
        allPassed = false;
    }
} catch (e) {
    console.log(`   ❌ 读取 VirtualTradingEngine 失败: ${e.message}\n`);
    allPassed = false;
}

// 5. 检查 TokenPool 方法
console.log('5. 检查 TokenPool 方法...');
try {
    const poolPath = path.join(__dirname, '../src/core/token-pool.js');
    const pool = fs.readFileSync(poolPath, 'utf-8');

    const hasGetRound = pool.includes('getCurrentRound(');
    const hasGetReturn = pool.includes('getLastPairReturnRate(');
    const hasAddPair = pool.includes('addCompletedPair(');

    if (hasGetRound && hasGetReturn && hasAddPair) {
        console.log('   ✅ TokenPool 包含所需方法\n');
    } else {
        console.log('   ❌ TokenPool 缺少所需方法');
        console.log(`      - hasGetRound: ${hasGetRound}`);
        console.log(`      - hasGetReturn: ${hasGetReturn}`);
        console.log(`      - hasAddPair: ${hasAddPair}\n`);
        allPassed = false;
    }
} catch (e) {
    console.log(`   ❌ 读取 TokenPool 失败: ${e.message}\n`);
    allPassed = false;
}

// 6. 检查 PreBuyCheckService 返回因子
console.log('6. 检查 PreBuyCheckService 返回因子...');
try {
    const servicePath = path.join(__dirname, '../src/trading-engine/pre-check/PreBuyCheckService.js');
    const service = fs.readFileSync(servicePath, 'utf-8');

    // 检查所有返回路径是否包含这两个因子
    const patterns = [
        'buyRound: options.buyRound',
        'buyRound: extraContext.buyRound',
        'lastPairReturnRate: options.lastPairReturnRate',
        'lastPairReturnRate: extraContext.lastPairReturnRate'
    ];

    let allFound = true;
    patterns.forEach(p => {
        if (!service.includes(p)) {
            console.log(`   ❌ 缺少: ${p}`);
            allFound = false;
        }
    });

    if (allFound) {
        console.log('   ✅ PreBuyCheckService 所有返回路径包含因子\n');
    } else {
        console.log('');
        allPassed = false;
    }
} catch (e) {
    console.log(`   ❌ 读取 PreBuyCheckService 失败: ${e.message}\n`);
    allPassed = false;
}

// 7. 检查 FactorBuilder
console.log('7. 检查 FactorBuilder...');
try {
    const builderPath = path.join(__dirname, '../src/trading-engine/core/FactorBuilder.js');
    const builder = fs.readFileSync(builderPath, 'utf-8');

    const hasBuyRound = builder.includes('buyRound: preBuyCheckResult.buyRound');
    const hasLastReturn = builder.includes('lastPairReturnRate: preBuyCheckResult.lastPairReturnRate');

    if (hasBuyRound && hasLastReturn) {
        console.log('   ✅ FactorBuilder 包含新因子\n');
    } else {
        console.log('   ❌ FactorBuilder 缺少新因子');
        console.log(`      - hasBuyRound: ${hasBuyRound}`);
        console.log(`      - hasLastReturn: ${hasLastReturn}\n`);
        allPassed = false;
    }
} catch (e) {
    console.log(`   ❌ 读取 FactorBuilder 失败: ${e.message}\n`);
    allPassed = false;
}

// 8. 检查参数传递
console.log('8. 检查参数传递...');
try {
    const backtestPath = path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js');
    const backtest = fs.readFileSync(backtestPath, 'utf-8');

    const hasBuyRoundParam = backtest.includes('buyRound: currentRound + 1');
    const hasLastReturnParam = backtest.includes('lastPairReturnRate: lastPairReturnRate ?? 0');

    if (hasBuyRoundParam && hasLastReturnParam) {
        console.log('   ✅ BacktestEngine 正确传递参数\n');
    } else {
        console.log('   ❌ BacktestEngine 参数传递有问题');
        console.log(`      - hasBuyRoundParam: ${hasBuyRoundParam}`);
        console.log(`      - hasLastReturnParam: ${hasLastReturnParam}\n`);
        allPassed = false;
    }
} catch (e) {
    console.log(`   ❌ 读取 BacktestEngine 失败: ${e.message}\n`);
    allPassed = false;
}

try {
    const virtualPath = path.join(__dirname, '../src/trading-engine/implementations/VirtualTradingEngine.js');
    const virtual = fs.readFileSync(virtualPath, 'utf-8');

    const hasBuyRoundParam = virtual.includes('buyRound: currentRound + 1');
    const hasLastReturnParam = virtual.includes('lastPairReturnRate: lastPairReturnRate ?? 0');

    if (hasBuyRoundParam && hasLastReturnParam) {
        console.log('   ✅ VirtualTradingEngine 正确传递参数\n');
    } else {
        console.log('   ❌ VirtualTradingEngine 参数传递有问题');
        console.log(`      - hasBuyRoundParam: ${hasBuyRoundParam}`);
        console.log(`      - hasLastReturnParam: ${hasLastReturnParam}\n`);
        allPassed = false;
    }
} catch (e) {
    console.log(`   ❌ 读取 VirtualTradingEngine 失败: ${e.message}\n`);
    allPassed = false;
}

// 9. 检查 skipPreBuyConditionMatch 已移除
console.log('9. 检查 skipPreBuyConditionMatch 已移除...');
try {
    const servicePath = path.join(__dirname, '../src/trading-engine/pre-check/PreBuyCheckService.js');
    const service = fs.readFileSync(servicePath, 'utf-8');

    const hasSkipConfig = service.includes('skipPreBuyConditionMatch:');
    const hasSkipLogic = service.includes('shouldSkipConditionMatch');

    if (!hasSkipConfig && !hasSkipLogic) {
        console.log('   ✅ skipPreBuyConditionMatch 已完全移除\n');
    } else {
        console.log('   ❌ skipPreBuyConditionMatch 仍有残留');
        console.log(`      - hasSkipConfig: ${hasSkipConfig}`);
        console.log(`      - hasSkipLogic: ${hasSkipLogic}\n`);
        allPassed = false;
    }
} catch (e) {
    console.log(`   ❌ 读取 PreBuyCheckService 失败: ${e.message}\n`);
    allPassed = false;
}

// 总结
console.log('=== 验证结果 ===');
if (allPassed) {
    console.log('✅ 所有检查通过！功能已完整实现。\n');
    console.log('可以安全运行新实验。建议验证步骤：');
    console.log('1. 创建新实验，设置不同的首次/再次购买条件');
    console.log('2. 运行实验后检查信号 metadata 中的 buyRound 和 lastPairReturnRate');
    console.log('3. 确认多次买入的代币使用了正确的条件');
} else {
    console.log('❌ 有检查失败，请修复后再运行实验。\n');
    process.exit(1);
}
