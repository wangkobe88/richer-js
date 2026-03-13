/**
 * 强短线交易者分析 - 主脚本
 * 依次执行所有步骤
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const steps = [
  { name: '步骤1: 获取信号和代币数据', script: 'step1_fetch_signals_and_tokens.js' },
  { name: '步骤2: 获取早期交易数据', script: 'step2_fetch_early_trades.js', delay: 5000 },
  { name: '步骤3: 获取钱包盈亏数据', script: 'step3_fetch_wallet_data.js', delay: 5000 },
  { name: '步骤4: 分析钱包数据分布', script: 'step4_analyze_wallet_distribution.js' },
  { name: '步骤5: 最终分析', script: 'step5_final_analysis.js' }
];

async function runStep(step) {
  console.log('\n' + '='.repeat(80));
  console.log(step.name);
  console.log('='.repeat(80) + '\n');

  try {
    execSync(`node ${path.join(__dirname, step.script)}`, {
      stdio: 'inherit',
      cwd: __dirname
    });
    return true;
  } catch (error) {
    console.error(`\n❌ ${step.name} 失败:`, error.message);
    return false;
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║          强短线交易者与代币质量关系分析                                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════╝');

  console.log('\n执行步骤:');
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.name}`));

  console.log('\n注意:');
  console.log('  - 步骤2和步骤3涉及大量API调用，可能需要较长时间');
  console.log('  - 所有中间数据会保存在 data/ 目录下');
  console.log('  - 如果中断，可以从失败的步骤重新开始\n');

  // 询问用户
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise(resolve => {
    rl.question('是否继续? (y/n): ', resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== 'y') {
    console.log('已取消');
    return;
  }

  const startTime = Date.now();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const success = await runStep(step);

    if (!success) {
      console.log(`\n⚠️  ${step.name} 失败，是否继续执行下一步?`);
      const continueAnswer = await new Promise(resolve => {
        const rl2 = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        rl2.question('(y/n): ', ans => {
          rl2.close();
          resolve(ans);
        });
      });

      if (continueAnswer.toLowerCase() !== 'y') {
        console.log('\n已中断');
        break;
      }
    }

    // 步骤间延迟（用于API限流恢复）
    if (step.delay && i < steps.length - 1) {
      console.log(`\n等待 ${step.delay / 1000} 秒...`);
      await new Promise(resolve => setTimeout(resolve, step.delay));
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ 分析完成！总耗时: ${duration} 秒`);
  console.log('\n结果文件:');
  console.log('  - data/step1_signals_and_tokens.json');
  console.log('  - data/step2_early_trades.json');
  console.log('  - data/wallet_list.json');
  console.log('  - data/step3_wallet_data.json');
  console.log('  - data/wallet_data_valid.json');
  console.log('  - data/step4_wallet_distribution_analysis.json');
  console.log('  - data/step5_final_analysis.json');
}

main().catch(console.error);
