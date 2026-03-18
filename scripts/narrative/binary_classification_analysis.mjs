/**
 * 二分类准确率分析
 * high+mid = good (好)
 * low = bad (差)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据路径
const RULE_DATA_PATH = path.resolve(__dirname, 'data/combined_narrative_scores.json');
const LLM_DATA_PATH = path.resolve(__dirname, 'data/llm_narrative_scores.json');
const HUMAN_DATA_PATH = path.resolve(__dirname, 'data/human_machine_comparison.json');
const OUTPUT_PATH = path.resolve(__dirname, 'data/binary_classification_analysis.json');

/**
 * 将三分类转换为二分类
 */
function toBinary(category) {
  return (category === 'high' || category === 'mid' || category === 'high_quality' || category === 'mid_quality')
    ? 'good'
    : 'bad';
}

/**
 * 分析规则评分准确率（基于人工标注）
 */
function analyzeRuleAccuracy(humanData) {
  const summary = humanData.summary;
  const details = humanData.details;

  let tp = 0, tn = 0, fp = 0, fn = 0;

  // 统计各分类
  tp += summary.high_high + summary.high_mid + summary.mid_high + summary.mid_mid;
  fn += summary.high_low + summary.mid_low;
  fp += summary.low_high + summary.low_mid;
  tn += summary.low_low;

  // 处理详情（用于显示具体案例）
  const falseNegatives = [
    ...details.high_low,
    ...details.mid_low
  ];

  const falsePositives = [
    ...details.low_high,
    ...details.low_mid
  ];

  return {
    tp, tn, fp, fn,
    total: tp + tn + fp + fn,
    accuracy: (tp + tn) / (tp + tn + fp + fn),
    precision: tp / (tp + fp) || 0,
    recall: tp / (tp + fn) || 0,
    f1: 2 * ((tp / (tp + fp) || 0) * (tp / (tp + fn) || 0)) / ((tp / (tp + fp) || 0) + (tp / (tp + fn) || 0)) || 0,
    falseNegatives,
    falsePositives
  };
}

/**
 * 分析LLM评分准确率（需要先获取LLM评分数据）
 */
function analyzeLLMAccuracy(llmData, humanData) {
  // 从human_machine_comparison中获取人工标注的代币列表
  const humanTokens = new Map();
  for (const [category, tokens] of Object.entries(humanData.details)) {
    for (const t of tokens) {
      humanTokens.set(t.token, {
        humanCategory: t.human,
        machineCategory: t.machine,
        machineScore: t.machineScore
      });
    }
  }

  // 从LLM数据中查找对应代币
  let tp = 0, tn = 0, fp = 0, fn = 0;
  const matched = [];
  const unmatched = [];
  const falseNegatives = [];
  const falsePositives = [];

  for (const [expId, expData] of Object.entries(llmData)) {
    for (const t of expData.tokens) {
      const humanData = humanTokens.get(t.symbol);
      if (humanData) {
        const humanBinary = toBinary(humanData.humanCategory);
        const llmBinary = toBinary(t.llmCategory);

        matched.push({
          symbol: t.symbol,
          human: humanData.humanCategory,
          llm: t.llmCategory,
          humanBinary,
          llmBinary,
          llmScore: t.llmTotalScore
        });

        if (humanBinary === 'good' && llmBinary === 'good') tp++;
        else if (humanBinary === 'bad' && llmBinary === 'bad') tn++;
        else if (humanBinary === 'good' && llmBinary === 'bad') {
          fn++;
          falseNegatives.push({
            symbol: t.symbol,
            human: humanData.humanCategory,
            llm: t.llmCategory,
            llmScore: t.llmTotalScore,
            reasoning: t.llmReasoning?.substring(0, 100)
          });
        }
        else {
          fp++;
          falsePositives.push({
            symbol: t.symbol,
            human: humanData.humanCategory,
            llm: t.llmCategory,
            llmScore: t.llmTotalScore,
            reasoning: t.llmReasoning?.substring(0, 100)
          });
        }
      }
    }
  }

  return {
    tp, tn, fp, fn,
    total: tp + tn + fp + fn,
    accuracy: (tp + tn) / (tp + tn + fp + fn),
    precision: tp / (tp + fp) || 0,
    recall: tp / (tp + fn) || 0,
    f1: 2 * ((tp / (tp + fp) || 0) * (tp / (tp + fn) || 0)) / ((tp / (tp + fp) || 0) + (tp / (tp + fn) || 0)) || 0,
    matched,
    unmatched,
    falseNegatives,
    falsePositives
  };
}

/**
 * 打印混淆矩阵
 */
function printConfusionMatrix(metrics, name) {
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`                    ${name} - 二分类混淆矩阵`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('                    实际: 好      实际: 差');
  console.log('                  ──────────────────────────');
  console.log(`预测: 好  │  TP=${metrics.tp.toString().padStart(3)}   │  FP=${metrics.fp.toString().padStart(3)}`);
  console.log(`          │  ${'真阳性'.padStart(9)} │  ${'假阳性'.padStart(9)}`);
  console.log('          ├─────────────────┼─────────────────');
  console.log(`预测: 差  │  FN=${metrics.fn.toString().padStart(3)}   │  TN=${metrics.tn.toString().padStart(3)}`);
  console.log(`          │  ${'假阴性'.padStart(9)} │  ${'真阴性'.padStart(9)}`);
  console.log('                  ──────────────────────────');

  console.log(`\n总样本数: ${metrics.total}`);
  console.log(`准确率 (Accuracy): ${(metrics.accuracy * 100).toFixed(1)}%`);
  console.log(`精确率 (Precision): ${(metrics.precision * 100).toFixed(1)}%`);
  console.log(`召回率 (Recall): ${(metrics.recall * 100).toFixed(1)}%`);
  console.log(`F1分数: ${(metrics.f1 * 100).toFixed(1)}%`);
}

/**
 * 打印错误案例
 */
function printErrors(metrics, name) {
  if (metrics.falseNegatives.length > 0) {
    console.log(`\n【${name}】假阴性（实际好，预测差）:`);
    console.log('─────────────────────────────────────────────────────────────');
    metrics.falseNegatives.slice(0, 5).forEach(t => {
      // 规则评分数据格式: token, human, machine, machineScore
      // LLM评分数据格式: symbol, human, llm, llmScore
      const symbol = t.token || t.symbol;
      const human = t.human || t.humanCategory;
      const predicted = t.machine || t.llm;
      const score = t.machineScore !== undefined ? t.machineScore : t.llmScore;

      console.log(`  ${(symbol || 'N/A').padEnd(12)} | 实际:${(human || 'N/A').padEnd(12)} | 预测:${predicted}(${score})`);
      if (t.reasoning) {
        console.log(`    理由: ${t.reasoning}...`);
      }
    });
    if (metrics.falseNegatives.length > 5) {
      console.log(`  ... 还有 ${metrics.falseNegatives.length - 5} 个`);
    }
  }

  if (metrics.falsePositives.length > 0) {
    console.log(`\n【${name}】假阳性（实际差，预测好）:`);
    console.log('─────────────────────────────────────────────────────────────');
    metrics.falsePositives.slice(0, 5).forEach(t => {
      const symbol = t.token || t.symbol;
      const human = t.human || t.humanCategory;
      const predicted = t.machine || t.llm;
      const score = t.machineScore !== undefined ? t.machineScore : t.llmScore;

      console.log(`  ${(symbol || 'N/A').padEnd(12)} | 实际:${(human || 'N/A').padEnd(12)} | 预测:${predicted}(${score})`);
      if (t.reasoning) {
        console.log(`    理由: ${t.reasoning}...`);
      }
    });
    if (metrics.falsePositives.length > 5) {
      console.log(`  ... 还有 ${metrics.falsePositives.length - 5} 个`);
    }
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                   二分类准确率分析');
  console.log('              high+mid = good (好), low = bad (差)');
  console.log('═══════════════════════════════════════════════════════════════');

  // 加载数据
  console.log('\n📂 加载数据...');
  const ruleData = JSON.parse(fs.readFileSync(RULE_DATA_PATH, 'utf-8'));
  const llmData = JSON.parse(fs.readFileSync(LLM_DATA_PATH, 'utf-8'));
  const humanData = JSON.parse(fs.readFileSync(HUMAN_DATA_PATH, 'utf-8'));

  console.log('   规则评分数据: 已加载');
  console.log('   LLM评分数据: 已加载');
  console.log('   人工标注数据: 已加载');

  // 分析规则评分
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    规则评分分析');
  console.log('═══════════════════════════════════════════════════════════════');

  const ruleMetrics = analyzeRuleAccuracy(humanData);
  printConfusionMatrix(ruleMetrics, '规则评分');
  printErrors(ruleMetrics, '规则评分');

  // 分析LLM评分
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    LLM评分分析');
  console.log('═══════════════════════════════════════════════════════════════');

  const llmMetrics = analyzeLLMAccuracy(llmData, humanData);
  console.log(`\n匹配样本数: ${llmMetrics.matched.length}/${Object.keys(humanData.details).reduce((sum, cat) => sum + humanData.details[cat].length, 0)}`);

  if (llmMetrics.total > 0) {
    printConfusionMatrix(llmMetrics, 'LLM评分');
    printErrors(llmMetrics, 'LLM评分');
  } else {
    console.log('\n⚠️  没有找到匹配的LLM评分样本');
  }

  // 对比结论
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    对比结论');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`┌─────────────┬─────────────┬─────────────┬─────────────┐`);
  console.log(`│   方法      │   准确率    │   精确率    │   召回率    │`);
  console.log(`├─────────────┼─────────────┼─────────────┼─────────────┤`);
  console.log(`│ 规则评分    │ ${(ruleMetrics.accuracy * 100).toFixed(1).padStart(9)}% │ ${(ruleMetrics.precision * 100).toFixed(1).padStart(9)}% │ ${(ruleMetrics.recall * 100).toFixed(1).padStart(9)}% │`);
  if (llmMetrics.total > 0) {
    console.log(`│ LLM评分     │ ${(llmMetrics.accuracy * 100).toFixed(1).padStart(9)}% │ ${(llmMetrics.precision * 100).toFixed(1).padStart(9)}% │ ${(llmMetrics.recall * 100).toFixed(1).padStart(9)}% │`);
  }
  console.log(`└─────────────┴─────────────┴─────────────┴─────────────┘`);

  if (llmMetrics.total > 0) {
    const accDiff = ((llmMetrics.accuracy - ruleMetrics.accuracy) * 100).toFixed(1);
    if (Math.abs(llmMetrics.accuracy - ruleMetrics.accuracy) < 0.05) {
      console.log('\n✅ 两种方法准确率相当');
    } else if (llmMetrics.accuracy > ruleMetrics.accuracy) {
      console.log(`\n🎯 LLM评分准确率高出 ${accDiff}%`);
    } else {
      console.log(`\n🎯 规则评分准确率高出 ${(-accDiff)}%`);
    }
  }

  // 保存结果
  const result = {
    timestamp: new Date().toISOString(),
    binaryDefinition: {
      good: ['high', 'mid', 'high_quality', 'mid_quality'],
      bad: ['low', 'low_quality']
    },
    ruleScoring: {
      metrics: ruleMetrics,
      falseNegatives: ruleMetrics.falseNegatives,
      falsePositives: ruleMetrics.falsePositives
    },
    llmScoring: {
      metrics: llmMetrics,
      matched: llmMetrics.matched,
      falseNegatives: llmMetrics.falseNegatives,
      falsePositives: llmMetrics.falsePositives
    }
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`\n💾 分析结果已保存: ${OUTPUT_PATH}`);

  console.log('\n═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
