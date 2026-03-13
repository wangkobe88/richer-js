const fs = require('fs');
const path = require('path');

const logFile = '/Users/nobody1/Downloads/experiment-a2ee5c27-3788-48fa-8735-858cbc60fcad-2026-03-13.log';

console.log('=== 分析实验日志中的 API 超时和错误情况 ===\n');

if (!fs.existsSync(logFile)) {
    console.log(`日志文件不存在: ${logFile}`);
    process.exit(1);
}

const content = fs.readFileSync(logFile, 'utf-8');
const lines = content.split('\n');

// 统计各类错误
const stats = {
    apiTimeout: [],
    apiError: [],
    apiRetry: [],
    earlyParticipantFail: [],
    strongTraderFail: [],
    totalSignals: 0,
    successEarlyCheck: 0
};

// 关键词模式
const patterns = {
    timeout: /timeout|timed out|超时/i,
    apiError: /API调用失败|ave.*error|fetch.*fail/i,
    retry: /API重试|retry/i,
    earlyParticipantFail: /早期参与者检查失败|EarlyParticipantCheckService.*失败|未获取到交易数据/i,
    strongTraderFail: /强势交易者.*失败|StrongTraderPositionService.*失败/i,
    signal: /执行买入策略|executeStrategy|买入信号/i
};

let currentToken = null;

lines.forEach((line, index) => {
    // 提取当前代币地址
    const tokenMatch = line.match(/token_address[=:]\s*([0-9a-f]{8,})/i);
    if (tokenMatch) {
        currentToken = tokenMatch[1];
    }
    
    // 统计买入信号
    if (patterns.signal.test(line)) {
        stats.totalSignals++;
    }
    
    // 成功的早期参与者检查
    if (line.includes('早期参与者检查完成') || line.includes('earlyTradesCountPerMin')) {
        stats.successEarlyCheck++;
    }
    
    // API 超时
    if (patterns.timeout.test(line)) {
        stats.apiTimeout.push({ line: index + 1, content: line.trim(), token: currentToken });
    }
    
    // API 错误
    if (patterns.apiError.test(line) && !patterns.timeout.test(line)) {
        stats.apiError.push({ line: index + 1, content: line.trim(), token: currentToken });
    }
    
    // API 重试
    if (patterns.retry.test(line)) {
        stats.apiRetry.push({ line: index + 1, content: line.trim(), token: currentToken });
    }
    
    // 早期参与者检查失败
    if (patterns.earlyParticipantFail.test(line)) {
        stats.earlyParticipantFail.push({ line: index + 1, content: line.trim(), token: currentToken });
    }
    
    // 强势交易者检查失败
    if (patterns.strongTraderFail.test(line)) {
        stats.strongTraderFail.push({ line: index + 1, content: line.trim(), token: currentToken });
    }
});

// 输出统计结果
console.log('=== 统计结果 ===\n');
console.log(`总买入信号数: ${stats.totalSignals}`);
console.log(`成功早期参与者检查: ${stats.successEarlyCheck}`);
console.log(`API 超时: ${stats.apiTimeout.length} 次`);
console.log(`API 错误: ${stats.apiError.length} 次`);
console.log(`API 重试: ${stats.apiRetry.length} 次`);
console.log(`早期参与者检查失败: ${stats.earlyParticipantFail.length} 次`);
console.log(`强势交易者检查失败: ${stats.strongTraderFail.length} 次`);

// 输出详细示例
if (stats.apiTimeout.length > 0) {
    console.log('\n=== API 超时示例 (前10条) ===');
    stats.apiTimeout.slice(0, 10).forEach(item => {
        console.log(`[行${item.line}] ${item.content.substring(0, 150)}`);
    });
}

if (stats.apiError.length > 0) {
    console.log('\n=== API 错误示例 (前10条) ===');
    stats.apiError.slice(0, 10).forEach(item => {
        console.log(`[行${item.line}] ${item.content.substring(0, 150)}`);
    });
}

if (stats.apiRetry.length > 0) {
    console.log('\n=== API 重试示例 (前10条) ===');
    stats.apiRetry.slice(0, 10).forEach(item => {
        console.log(`[行${item.line}] ${item.content.substring(0, 150)}`);
    });
}

if (stats.earlyParticipantFail.length > 0) {
    console.log('\n=== 早期参与者检查失败示例 (前15条) ===');
    stats.earlyParticipantFail.slice(0, 15).forEach(item => {
        console.log(`[行${item.line}] ${item.content.substring(0, 200)}`);
    });
}

// 按代币分组统计失败
const failByToken = {};
stats.earlyParticipantFail.forEach(item => {
    if (item.token) {
        failByToken[item.token] = (failByToken[item.token] || 0) + 1;
    }
});

console.log('\n=== 按代币统计失败次数 ===');
const sortedTokens = Object.entries(failByToken).sort((a, b) => b[1] - a[1]);
sortedTokens.slice(0, 10).forEach(([token, count]) => {
    console.log(`  ${token}: ${count} 次失败`);
});

