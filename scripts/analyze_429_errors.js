const fs = require('fs');

const logFile = '/Users/nobody1/Downloads/experiment-a2ee5c27-3788-48fa-8735-858cbc60fcad-2026-03-13.log';
const content = fs.readFileSync(logFile, 'utf-8');
const lines = content.split('\n');

console.log('=== AVE API 429 限流错误详细分析 ===\n');

// 统计 429 错误
const errors429 = [];
const errorLog = [];

lines.forEach((line, index) => {
    if (line.includes('429')) {
        errors429.push({ line: index + 1, content: line });
    }
    if (line.includes('未获取到交易数据，无法进行早期参与者检查')) {
        errorLog.push({ line: index + 1, content: line });
    }
});

console.log(`总 429 错误数: ${errors429.length}`);
console.log(`早期参与者检查最终失败数: ${errorLog.length}`);

// 分析重试成功率
// 查找"API重试成功"的数量
const retrySuccess = lines.filter(l => l.includes('API重试成功')).length;
console.log(`API 重试成功次数: ${retrySuccess}`);

// 分析 429 错误的时间分布
const timePattern = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/;
const timeDistribution = {};

errors429.forEach(item => {
    const match = item.content.match(timePattern);
    if (match) {
        const minute = match[1].substring(0, 16); // 精确到分钟
        timeDistribution[minute] = (timeDistribution[minute] || 0) + 1;
    }
});

console.log('\n=== 429 错误时间分布 ===');
const sortedTimes = Object.entries(timeDistribution).sort((a, b) => a[0].localeCompare(b[0]));
sortedTimes.forEach(([time, count]) => {
    console.log(`  ${time}: ${count} 次`);
});

// 检查是否最终都重试成功了
console.log('\n=== 最终失败的原因分析 ===');

// 提取最终错误信息
const finalErrors = lines.filter(l => l.includes('早期参与者检查失败') && l.includes('error'));

// 按错误类型分组
const errorTypes = {};
finalErrors.forEach(line => {
    if (line.includes('未获取到交易数据')) {
        errorTypes['未获取到交易数据'] = (errorTypes['未获取到交易数据'] || 0) + 1;
    }
});

console.log('\n最终失败原因分类:');
Object.entries(errorTypes).forEach(([type, count]) => {
    console.log(`  ${type}: ${count} 次`);
});

// 检查有多少次是3次重试都失败的
const retry3Failed = lines.filter(l => l.includes('attempt":3') && l.includes('API调用失败')).length;
console.log(`\n3次重试都失败的次数: ${retry3Failed}`);

// 计算成功率
const totalAttempts = errors429.length; // 所有429错误
const successfulRetries = retrySuccess; // 重试成功次数
const failAfterRetry = errorLog.length; // 最终失败次数

console.log('\n=== 重试机制效果 ===');
console.log(`遇到 429 错误: ${totalAttempts} 次`);
console.log(`重试成功: ${successfulRetries} 次`);
console.log(`重试后仍失败: ${failAfterRetry} 次`);
console.log(`重试成功率: ${(successfulRetries / (successfulRetries + failAfterRetry) * 100).toFixed(1)}%`);
