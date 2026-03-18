/**
 * 详细对比LLM和规则评分
 * 展示每个代币在两个评分系统中的表现
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RULE_DATA_PATH = path.resolve(__dirname, 'data/combined_narrative_scores.json');
const LLM_DATA_PATH = path.resolve(__dirname, 'data/llm_narrative_scores.json');
const HUMAN_DATA_PATH = path.resolve(__dirname, 'data/human_machine_comparison.json');

/**
 * 加载并合并数据
 */
function loadAndMergeData() {
  const ruleData = JSON.parse(fs.readFileSync(RULE_DATA_PATH, 'utf-8'));
  const llmData = JSON.parse(fs.readFileSync(LLM_DATA_PATH, 'utf-8'));
  const humanData = JSON.parse(fs.readFileSync(HUMAN_DATA_PATH, 'utf-8'));

  // 构建代币映射
  const tokenMap = new Map();

  // 添加规则评分
  for (const [expId, expData] of Object.entries(ruleData)) {
    for (const t of expData.tokens) {
      const key = `${expId}_${t.address}`;
      tokenMap.set(key, {
        expId,
        address: t.address,
        symbol: t.symbol,
        ruleCategory: t.narrative_category,
        ruleScore: t.narrative_score,
        ruleScores: t.scores
      });
    }
  }

  // 添加LLM评分
  for (const [expId, expData] of Object.entries(llmData)) {
    for (const t of expData.tokens) {
      const key = `${expId}_${t.address}`;
      const existing = tokenMap.get(key);
      if (existing) {
        existing.llmCategory = t.llmCategory;
        existing.llmScore = t.llmTotalScore;
        existing.llmScores = t.llmScores;
        existing.llmReasoning = t.llmReasoning;
      }
    }
  }

  // 添加人工标注
  for (const [category, tokens] of Object.entries(humanData.details)) {
    for (const t of tokens) {
      // 按symbol查找
      for (const [key, value] of tokenMap.entries()) {
        if (value.symbol === t.token) {
          value.humanCategory = t.human;
          value.machineCategory = t.machine;
          value.machineScore = t.machineScore;
          break;
        }
      }
    }
  }

  return Array.from(tokenMap.values());
}

/**
 * 计算分类一致性
 */
function calculateAgreement(tokens) {
  let exactAgreement = 0;
  let binaryAgreement = 0;
  const toBinary = (cat) => (cat === 'high' || cat === 'mid' || cat === 'high_quality' || cat === 'mid_quality') ? 'good' : 'bad';

  for (const t of tokens) {
    if (t.ruleCategory && t.llmCategory) {
      if (t.ruleCategory === t.llmCategory) exactAgreement++;
      if (toBinary(t.ruleCategory) === toBinary(t.llmCategory)) binaryAgreement++;
    }
  }

  const withBoth = tokens.filter(t => t.ruleCategory && t.llmCategory).length;

  return {
    total: withBoth,
    exactAgreement,
    exactRate: withBoth > 0 ? exactAgreement / withBoth : 0,
    binaryAgreement,
    binaryRate: withBoth > 0 ? binaryAgreement / withBoth : 0
  };
}

/**
 * 显示详细对比表
 */
function displayDetailedComparison(tokens) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    LLM vs 规则评分 - 详细对比');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 按实验分组
  const byExp = new Map();
  for (const t of tokens) {
    if (!byExp.has(t.expId)) byExp.set(t.expId, []);
    byExp.get(t.expId).push(t);
  }

  for (const [expId, expTokens] of byExp.entries()) {
    console.log(`\n【实验 ${expId}】`);
    console.log('─'.repeat(120));

    // 表头
    console.log(
      '  代币'.padEnd(14) +
      '规则'.padStart(8) +
      'LLM'.padStart(8) +
      '人工'.padStart(10) +
      '规则分'.padStart(8) +
      'LLM分'.padStart(8) +
      '一致性'.padStart(10)
    );
    console.log('  ' + '─'.repeat(110));

    for (const t of expTokens) {
      const ruleCat = t.ruleCategory || '-';
      const llmCat = t.llmCategory || '-';
      const humanCat = t.humanCategory || '-';

      const agreement =
        (t.ruleCategory && t.llmCategory && t.ruleCategory === t.llmCategory) ? '✅一致' :
        (t.ruleCategory && t.llmCategory) ? '❌不一致' : '-';

      console.log(
        '  ' + (t.symbol || 'N/A').padEnd(14) +
        ruleCat.padStart(8) +
        llmCat.padStart(8) +
        humanCat.padStart(10) +
        (t.ruleScore !== undefined ? String(t.ruleScore) : '-').padStart(8) +
        (t.llmScore !== undefined ? String(t.llmScore) : '-').padStart(8) +
        agreement.padStart(10)
      );
    }
  }
}

/**
 * 显示评分差异分析
 */
function displayScoreDifferences(tokens) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    评分差异分析');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 规则高但LLM低
  const ruleHighLlmLow = tokens.filter(t =>
    t.ruleCategory && t.llmCategory &&
    (t.ruleCategory === 'high' || t.ruleCategory === 'mid') &&
    t.llmCategory === 'low'
  );

  // 规则低但LLM高
  const ruleLowLlmHigh = tokens.filter(t =>
    t.ruleCategory && t.llmCategory &&
    t.ruleCategory === 'low' &&
    (t.llmCategory === 'high' || t.llmCategory === 'mid')
  );

  // 与人工标注不一致的
  const humanMismatched = tokens.filter(t =>
    t.humanCategory &&
    ((t.ruleCategory && toBinary(t.ruleCategory) !== toBinary(t.humanCategory)) ||
     (t.llmCategory && toBinary(t.llmCategory) !== toBinary(t.humanCategory)))
  );

  function toBinary(cat) {
    return (cat === 'high' || cat === 'mid' || cat === 'high_quality' || cat === 'mid_quality') ? 'good' : 'bad';
  }

  if (ruleHighLlmLow.length > 0) {
    console.log(`【规则评高但LLM评低】(${ruleHighLlmLow.length}个):`);
    console.log('  ' + '─'.repeat(100));
    ruleHighLlmLow.slice(0, 10).forEach(t => {
      console.log(
        `  ${t.symbol.padEnd(14)} | 规则:${t.ruleCategory}(${t.ruleScore})  LLM:${t.llmCategory}(${t.llmScore})`
      );
    });
    if (ruleHighLlmLow.length > 10) {
      console.log(`  ... 还有 ${ruleHighLlmLow.length - 10} 个`);
    }
  }

  console.log('');

  if (ruleLowLlmHigh.length > 0) {
    console.log(`【规则评低但LLM评高】(${ruleLowLlmHigh.length}个):`);
    console.log('  ' + '─'.repeat(100));
    ruleLowLlmHigh.slice(0, 10).forEach(t => {
      console.log(
        `  ${t.symbol.padEnd(14)} | 规则:${t.ruleCategory}(${t.ruleScore})  LLM:${t.llmCategory}(${t.llmScore})`
      );
      if (t.llmReasoning) {
        console.log(`    LLM理由: ${t.llmReasoning.substring(0, 80)}...`);
      }
    });
    if (ruleLowLlmHigh.length > 10) {
      console.log(`  ... 还有 ${ruleLowLlmHigh.length - 10} 个`);
    }
  }

  console.log('');

  if (humanMismatched.length > 0) {
    console.log(`【与人工标注不一致】(${humanMismatched.length}个):`);
    console.log('  ' + '─'.repeat(100));
    humanMismatched.forEach(t => {
      const ruleMatch = t.ruleCategory ? toBinary(t.ruleCategory) === toBinary(t.humanCategory) : null;
      const llmMatch = t.llmCategory ? toBinary(t.llmCategory) === toBinary(t.humanCategory) : null;

      console.log(
        `  ${t.symbol.padEnd(14)} | 人工:${t.humanCategory.padEnd(12)} ` +
        `规则:${t.ruleCategory || '-'}(${ruleMatch ? '✅' : '❌'})  ` +
        `LLM:${t.llmCategory || '-'}(${llmMatch ? '✅' : '❌'})`
      );
    });
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              LLM vs 规则评分 - 完整对比分析');
  console.log('═══════════════════════════════════════════════════════════════');

  const tokens = loadAndMergeData();
  console.log(`\n📊 共加载 ${tokens.length} 个代币数据`);

  // 统计
  const withRule = tokens.filter(t => t.ruleCategory).length;
  const withLLM = tokens.filter(t => t.llmCategory).length;
  const withBoth = tokens.filter(t => t.ruleCategory && t.llmCategory).length;
  const withHuman = tokens.filter(t => t.humanCategory).length;

  console.log(`   规则评分: ${withRule} 个`);
  console.log(`   LLM评分: ${withLLM} 个`);
  console.log(`   两者都有: ${withBoth} 个`);
  console.log(`   人工标注: ${withHuman} 个`);

  // 一致性分析
  const agreement = calculateAgreement(tokens);
  console.log(`\n📈 分类一致性:`);
  console.log(`   精确一致: ${agreement.exactAgreement}/${agreement.total} (${(agreement.exactRate * 100).toFixed(1)}%)`);
  console.log(`   二分类一致: ${agreement.binaryAgreement}/${agreement.total} (${(agreement.binaryRate * 100).toFixed(1)}%)`);

  // 详细对比
  displayDetailedComparison(tokens);

  // 差异分析
  displayScoreDifferences(tokens);

  console.log('\n═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
