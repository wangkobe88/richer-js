const fs = require('fs');

const buySignals = JSON.parse(fs.readFileSync('/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis/data/buy_signals.json', 'utf8'));

console.log('='.repeat(60));
console.log('数据来源说明');
console.log('='.repeat(60));
console.log('');
console.log('1. buy_signals.json 数据来源:');
console.log('   API: /api/experiment/505ac306-97fc-43d6-b027-00b909469b81/signals');
console.log('   参数: signalType=BUY&executed=true');
console.log('   总信号数:', buySignals.length);
console.log('');

const uniqueTokens = new Map();
buySignals.forEach(signal => {
  if (!uniqueTokens.has(signal.token_address)) {
    uniqueTokens.set(signal.token_address, signal);
  }
});

console.log('2. 去重后的唯一代币数:', uniqueTokens.size);
console.log('   原因: 同一个代币可能触发多次买入信号');
console.log('');

const typeCount = {};
buySignals.forEach(s => {
  typeCount[s.signal_type] = (typeCount[s.signal_type] || 0) + 1);
});
console.log('3. 信号类型分布:', typeCount);
console.log('');

console.log('4. 为什么是87个而不是57个？');
console.log('   - 57个是有买入信号的代币（对应实验的57个交易）');
console.log('   - buy_signals.json 包含125条信号（可能有重复）');
console.log('   - 去重后得到87个唯一代币地址');
console.log('');

console.log('5. 早期交易数据获取方法:');
console.log('   - 使用 AveTxAPI.getSwapTransactions()');
console.log('   - 时间窗口: 买入信号时间前90秒');
console.log('   - 循环获取直到覆盖整个90秒窗口');
console.log('   - 统计每个钱包的 from_usd 作为投入金额');
console.log('   - 成功获取: 86/87个代币有数据');
