const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const PROCESSED_EXP_FILE = path.join(DATA_DIR, 'processed_experiments.json');

// 加载原有强势交易者
const { STRONG_TRADERS } = require('../../src/trading-engine/pre-check/STRONG_TRADERS');
const existingSet = new Set([...STRONG_TRADERS].map(a => a.toLowerCase()));

console.log(`原有强势交易者: ${existingSet.size}`);

// 从所有处理过的实验收集新强势交易者
const processedExperiments = JSON.parse(fs.readFileSync(PROCESSED_EXP_FILE, 'utf8'));
const allNewTraders = new Set();

for (const expId of processedExperiments) {
  const resultFile = path.join(DATA_DIR, `${expId}_step5_final_analysis.json`);
  if (!fs.existsSync(resultFile)) {
    console.log(`跳过 ${expId}: 未找到结果文件`);
    continue;
  }

  try {
    const data = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    const traders = data.strong_traders?.traders || [];
    traders.forEach(t => {
      allNewTraders.add(t.address.toLowerCase());
    });
    console.log(`${expId}: ${traders.length} 个强势交易者`);
  } catch (e) {
    console.error(`读取 ${expId} 数据失败: ${e.message}`);
  }
}

// 计算新增的
const finalSet = new Set([...existingSet]);
const newCount = allNewTraders.size;
allNewTraders.forEach(addr => finalSet.add(addr));

const addedCount = finalSet.size - existingSet.size;

console.log(`\n合并结果:`);
console.log(`  原有: ${existingSet.size}`);
console.log(`  新实验识别: ${newCount}`);
console.log(`  新增（不重叠）: ${addedCount}`);
console.log(`  总计: ${finalSet.size}`);

// 保存合并结果
const mergeResult = {
  version: 'v2',
  original_count: existingSet.size,
  processed_experiments: processedExperiments,
  new_traders_from_experiments: newCount,
  newly_added: addedCount,
  final_count: finalSet.size,
  final_list: Array.from(finalSet).sort()
};

const resultFile = path.join(DATA_DIR, 'merge_result.json');
fs.writeFileSync(resultFile, JSON.stringify(mergeResult, null, 2));
console.log(`\n✅ 合并结果已保存到 ${resultFile}`);

// 输出STRONG_TRADERS.js代码
console.log(`\n${'='.repeat(80)}`);
console.log('请在 STRONG_TRADERS.js 中更新:');
console.log(`${'='.repeat(80)}\n`);

console.log(`const STRONG_TRADERS_VERSION = 'v2';`);
console.log(`const STRONG_TRADERS_SOURCE_EXPERIMENTS = [`);
console.log(`  '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1', // 原始实验`);
processedExperiments.forEach(exp => {
  console.log(`  '${exp}', // 新实验`);
});
console.log(`];\n`);

console.log(`const STRONG_TRADERS = new Set([`);
mergeResult.final_list.forEach(addr => {
  console.log(`  '${addr}',`);
});
console.log(`]);`);
