/**
 * 完成后整理文件到 data 文件夹
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const DATA_FOLDER = path.join(DATA_DIR, 'data');

console.log('='.repeat(80));
console.log('整理文件到 data 文件夹');
console.log('='.repeat(80));

// 创建 data 文件夹
if (!fs.existsSync(DATA_FOLDER)) {
  fs.mkdirSync(DATA_FOLDER, { recursive: true });
  console.log(`\n✓ 创建文件夹: ${DATA_FOLDER}`);
}

// 定义数据文件
const dataFiles = [
  'token_early_participants_all.json',
  'wallet_data.json',
  'wallet_data_complete.json',
  'classification_system_v3.json',
  'buy_signals.json',
  'analysis_results.json',
  'final_analysis_results.json',
  'final_analysis_v2.json'
];

// 移动文件
console.log('\n移动文件:');
dataFiles.forEach(file => {
  const srcPath = path.join(DATA_DIR, file);
  const destPath = path.join(DATA_FOLDER, file);

  if (fs.existsSync(srcPath)) {
    fs.renameSync(srcPath, destPath);
    console.log(`  ✓ ${file} -> data/${file}`);
  } else {
    console.log(`  ⚠️  ${file} 不存在，跳过`);
  }
});

// 移动分析脚本
const scriptFiles = [
  'fetch_all_wallets.js',
  'final_classification.js',
  'optimize_classification_v2.js',
  'build_final_classifier.js'
];

console.log('\n保留的分析脚本:');
scriptFiles.forEach(file => {
  if (fs.existsSync(path.join(DATA_DIR, file))) {
    console.log(`  ✓ ${file}`);
  }
});

// 列出 data 文件夹内容
console.log('\ndata 文件夹内容:');
const files = fs.readdirSync(DATA_FOLDER).filter(f => !f.startsWith('.'));
files.forEach(file => {
  const stat = fs.statSync(path.join(DATA_FOLDER, file));
  const size = (stat.size / 1024).toFixed(1);
  console.log(`  ${file} (${size} KB)`);
});

console.log('\n✅ 文件整理完成!');
console.log(`数据文件位置: ${DATA_FOLDER}`);
