/**
 * 批处理主脚本：扩展强势交易者数据集
 * 顺序处理多个实验，复用已有数据
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// 要处理的新实验ID（完整ID）
const NEW_EXPERIMENT_IDS = [
  '431ffc1c-9b68-491b-8707-08117a1d7b74', // 140条交易
  '6b17ff18-002d-4ce0-a745-b8e02676abd4',  // 118条交易
  '25493408-98b3-4342-a1ac-036ba49f97ee', // 264条交易
  '208630e8-33bc-46a9-84d2-2b66db0b6ed4',  // 170条交易
  '8b6408cd-c555-4a98-b9a7-19a5f0925a00'   // 134条交易
];

// 加载已处理的实验列表
const PROCESSED_EXP_FILE = path.join(DATA_DIR, 'processed_experiments.json');
let processedExperiments = [];
if (fs.existsSync(PROCESSED_EXP_FILE)) {
  try {
    processedExperiments = JSON.parse(fs.readFileSync(PROCESSED_EXP_FILE, 'utf8'));
  } catch (e) {}
}

function runScript(scriptPath, args = []) {
  try {
    const cmd = `node ${scriptPath}`;
    const fullCmd = args.length > 0 ? `${cmd} ${args.join(' ')}` : cmd;
    console.log(`\n> ${fullCmd}`);
    execSync(fullCmd, {
      stdio: 'inherit',
      cwd: __dirname
    });
    return true;
  } catch (error) {
    console.error(`失败: ${error.message}`);
    return false;
  }
}

async function processExperiment(expId) {
  console.log('\n' + '='.repeat(80));
  console.log(`处理实验: ${expId}`);
  console.log('='.repeat(80));

  // Step 1: 获取信号和代币
  console.log('\n[1/5] 获取信号和代币数据...');
  if (!runScript('step1_fetch_signals_with_exp_id.js', [expId])) {
    console.error(`实验 ${expId} Step 1 失败，跳过`);
    return false;
  }

  // Step 2: 获取早期交易
  console.log('\n[2/5] 获取早期交易数据...');
  if (!runScript('step2_fetch_with_cache.js')) {
    console.error(`实验 ${expId} Step 2 失败，跳过`);
    return false;
  }

  // Step 3: 获取钱包数据（累积）
  console.log('\n[3/5] 获取钱包盈亏数据...');
  if (!runScript('step3_fetch_cumulative.js')) {
    console.error(`实验 ${expId} Step 3 失败，跳过`);
    return false;
  }

  // Step 4: 过滤有效钱包
  console.log('\n[4/5] 过滤有效钱包...');
  if (!runScript('step4_filter_valid.js')) {
    console.error(`实验 ${expId} Step 4 失败，跳过`);
    return false;
  }

  // Step 5: 识别强势交易者
  console.log('\n[5/5] 识别强势交易者...');
  if (!runScript('step5_analyze_from_cumulative.js')) {
    console.error(`实验 ${expId} Step 5 失败，跳过`);
    return false;
  }

  // 标记为已处理
  processedExperiments.push(expId);
  fs.writeFileSync(PROCESSED_EXP_FILE, JSON.stringify(processedExperiments, null, 2));

  console.log(`\n✅ 实验 ${expId} 处理完成`);
  return true;
}

async function mergeStrongTraders() {
  console.log('\n' + '='.repeat(80));
  console.log('合并强势交易者列表');
  console.log('='.repeat(80) + '\n');

  // 加载原有的强势交易者
  const { STRONG_TRADERS } = require('../../src/trading-engine/pre-check/STRONG_TRADERS');
  const existingSet = new Set([...STRONG_TRADERS].map(a => a.toLowerCase()));

  console.log(`原有强势交易者: ${existingSet.size}`);

  // 从所有处理过的实验收集新强势交易者
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

  // 输出更新后的 STRONG_TRADERS.js 代码
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
  const sortedList = Array.from(finalSet).sort();
  sortedList.forEach(addr => {
    console.log(`  '${addr}',`);
  });
  console.log(`]);`);

  // 保存完整结果
  const mergeResult = {
    version: 'v2',
    original_count: existingSet.size,
    processed_experiments: processedExperiments,
    new_traders_from_experiments: newCount,
    newly_added: addedCount,
    final_count: finalSet.size,
    final_list: sortedList
  };

  const resultFile = path.join(DATA_DIR, 'merge_result.json');
  fs.writeFileSync(resultFile, JSON.stringify(mergeResult, null, 2));
  console.log(`\n✅ 合并结果已保存到 ${resultFile}`);
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║          扩展强势交易者数据集 - 批处理脚本                                      ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════╝');

  console.log(`\n待处理实验数: ${NEW_EXPERIMENT_IDS.length}`);
  NEW_EXPERIMENT_IDS.forEach((id, i) => {
    console.log(`  ${i + 1}. ${id}`);
  });

  console.log(`\n已处理实验: ${processedExperiments.length}`);
  processedExperiments.forEach((id, i) => {
    console.log(`  - ${id}`);
  });

  if (processedExperiments.length > 0) {
    console.log('\n注意: 已处理的实验将被跳过');
  }

  const startTime = Date.now();

  // 处理每个实验
  for (const expId of NEW_EXPERIMENT_IDS) {
    if (processedExperiments.includes(expId)) {
      console.log(`\n跳过 ${expId}（已处理过）`);
      continue;
    }

    const success = await processExperiment(expId);

    if (!success) {
      console.log(`\n⚠️ 实验 ${expId} 处理失败，继续下一个实验`);
    }

    // 步骤间延迟
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // 合并强势交易者
  await mergeStrongTraders();

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ 批处理完成！总耗时: ${duration} 分钟`);
}

main().catch(error => {
  console.error('\n错误:', error);
  process.exit(1);
});
