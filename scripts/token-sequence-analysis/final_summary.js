/**
 * 最终总结分析
 * 整合所有研究发现，生成综合报告
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'processed');
const OUTPUT_DIR = path.join(__dirname, 'data', 'summary');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function loadSequences() {
  const sequencesPath = path.join(DATA_DIR, 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const data = JSON.parse(content);
  return data.sequences;
}

/**
 * 核心发现总结
 */
function generateCoreFindings(sequences) {
  console.log('========================================');
  console.log('核心发现总结');
  console.log('========================================\n');

  const findings = {
    '反直觉发现 #1: 早期狙击是劣策略': {
      evidence: '早期参与者（位置<20%）的成功率只有56.2%，是所有角色中最低的',
      implication: '在代币刚创建时立即买入（狙击）并不是好策略',
      data: '后期参与者（位置>50%）成功率反而高达69.4%'
    },

    '反直觉发现 #2: 网络中心性与涨幅负相关': {
      evidence: '包含高PageRank钱包的代币平均涨幅282.5%，低于不包含的335.8%',
      implication: '"热门钱包"参与的代币不一定表现更好',
      data: '与高PageRank钱包重叠度高的代币平均涨幅只有123%'
    },

    '反直觉发现 #3: 新钱包比例无关': {
      evidence: '新钱包比例与涨幅相关性仅为-0.025',
      implication: '新钱包涌入并不能预测代币表现',
      data: '净流入与涨幅相关性为0.278（中等正相关）'
    },

    '正面发现 #1: 缓涨型最优': {
      evidence: '缓涨型代币平均涨幅487.9%，高涨幅占比70%',
      implication: '持续稳定买入比急涨更好',
      data: '急涨型代币只有195.4%涨幅'
    },

    '正面发现 #2: 大额交易预示成功': {
      evidence: '大额交易比例>30%的代币，高涨幅占比72.2%',
      implication: '大额投资者（巨鲸）的参与有预测价值',
      data: '无大额交易的代币高涨幅占比只有48.9%'
    },

    '正面发现 #3: 持有者模式成功': {
      evidence: '持有者（买卖比>=2）的成功率高达71.1%',
      implication: '持续持有比快进快出更好',
      data: '快进快出者成功率只有56.4%'
    },

    '模式发现 #1: 极简暴利': {
      evidence: '22个代币交易<=5笔但涨幅>=200%，平均涨幅353%',
      implication: '极少数早期投资者买入后极少交易的代币可能暴利',
      data: '这些代币平均只有3.1笔交易，2.5个唯一钱包'
    },

    '模式发现 #2: 赢家通吃': {
      evidence: '基尼系数9.619，顶部10%代币占据51.2%涨幅',
      implication: '代币表现极度不平等，少数代币贡献大部分收益',
      data: '顶部1%代币占据17.4%涨幅'
    },

    '时间发现 #1: 后期更关键': {
      evidence: '120-180s的净流入与涨幅相关性0.138，高于0-30s的0.000',
      implication: '代币的表现更多取决于后期而非早期的交易',
      data: '高涨幅代币在120-180s平均净流入$419，低涨幅只有$72'
    },

    '时间发现 #2: 连续买入3-5次是谷底': {
      evidence: '3-5笔连续买入的代币平均涨幅只有175%',
      implication: '连续买入3-5次可能是"拉高出货"的信号',
      data: '1-2笔连续买入的代币平均涨幅459%'
    },

    '聚类发现 #1: 极简暴利簇': {
      evidence: '聚类分析发现一个只有15个代币的小簇，平均涨幅452.9%',
      implication: '存在一个"小而精"的代币类别',
      data: '该簇代币平均序列长度只有82.7笔'
    }
  };

  // 打印核心发现
  Object.entries(findings).forEach(([title, finding], i) => {
    console.log(`${i + 1}. ${title}`);
    console.log(`   证据: ${finding.evidence}`);
    console.log(`   启示: ${finding.implication}`);
    console.log(`   数据: ${finding.data}\n`);
  });

  return findings;
}

/**
 * 预测因子排名
 */
function predictorRanking(sequences) {
  console.log('\n========================================');
  console.log('预测因子排名（按预测力排序）');
  console.log('========================================\n');

  const predictors = [
    { name: '净流入 (Net Flow)', correlation: 0.278, iv: 0.078, category: '整体指标' },
    { name: '大额买入次数', correlation: 0.15, iv: 0.046, category: '整体指标' },
    { name: '唯一钱包数', correlation: 0.189, iv: 0.040, category: '整体指标' },
    { name: '序列长度', correlation: 0.25, iv: 0.035, category: '结构特征' },
    { name: '买卖比例', correlation: 0.20, iv: 0.030, category: '行为特征' },
    { name: '120-180s净流入', correlation: 0.138, iv: 0.025, category: '时间特征' },
    { name: '大额交易比例', correlation: 0.12, iv: 0.022, category: '行为特征' },
    { name: '早期净流入 (0-30s)', correlation: 0.000, iv: 0.004, category: '时间特征' },
    { name: '新钱包比例', correlation: -0.025, iv: 0.002, category: '结构特征' },
    { name: '首次买入金额', correlation: 0.05, iv: 0.001, category: '时间特征' },
    { name: '钱包中心性', correlation: -0.10, iv: 0.001, category: '网络特征' }
  ];

  // 按IV排序
  const sorted = [...predictors].sort((a, b) => b.iv - a.iv);

  console.log('排名 | 因子名称 | 类别 | IV值 | 相关系数');
  console.log('-----|----------|------|-----|----------');
  sorted.forEach((p, i) => {
    const rank = i + 1;
    const name = p.name.padEnd(30);
    const category = p.category.padEnd(10);
    const iv = p.iv.toFixed(3);
    const corr = p.correlation.toFixed(3);
    console.log(`${rank.toString().padStart(4)} | ${name} | ${category} | ${iv} | ${corr}`);
  });

  return sorted;
}

/**
 * 交易策略建议
 */
function tradingStrategies(sequences) {
  console.log('\n========================================');
  console.log('基于数据的交易策略建议');
  console.log('========================================\n');

  const strategies = [
    {
      name: '策略1: 等待确认',
      description: '不要在代币刚创建时立即买入',
      reasoning: '早期参与者成功率只有56.2%，是所有角色中最低的',
      action: '等待至少60-90秒，观察代币是否展现出"缓涨型"特征'
    },
    {
      name: '策略2: 识别序列形状',
      description: '识别代币的交易序列形状',
      reasoning: '缓涨型代币平均涨幅487.9%，远高于急涨型的195.4%',
      action: '寻找持续稳定买入（而非早期暴拉）的代币'
    },
    {
      name: '策略3: 关注大额投资者',
      description: '关注有大额交易的代币',
      reasoning: '大额交易比例>30%的代币，高涨幅占比72.2%',
      action: '优先选择有大额投资者持续参与的代币'
    },
    {
      name: '策略4: 警惕连续买入',
      description: '警惕连续买入3-5次的模式',
      reasoning: '3-5笔连续买入的代币平均涨幅只有175%（谷底）',
      action: '如果看到连续买入3-5次后开始卖出，可能是"拉高出货"信号'
    },
    {
      name: '策略5: 避免"热门钱包"代币',
      description: '避免高PageRank钱包集中参与的代币',
      reasoning: '与高PageRank钱包重叠度高的代币平均涨幅只有123%',
      action: '不要追逐"大V"或"网红"钱包参与的代币'
    },
    {
      name: '策略6: 关注后期净流入',
      description: '关注120-180秒的净流入情况',
      reasoning: '120-180s的净流入与涨幅相关性0.138，高于早期的0.000',
      action: '早期表现不如后期重要，等待2-3分钟后再做决策'
    }
  ];

  strategies.forEach((s, i) => {
    console.log(`${i + 1}. ${s.name}`);
    console.log(`   描述: ${s.description}`);
    console.log(`   依据: ${s.reasoning}`);
    console.log(`   行动: ${s.action}\n`);
  });

  return strategies;
}

/**
 * 风险警示
 */
function riskWarnings(sequences) {
  console.log('\n========================================');
  console.log('风险警示');
  console.log('========================================\n');

  const warnings = [
    {
      level: '高风险',
      pattern: '抛售型序列',
      description: '后期大量卖出的代币',
      stat: '平均涨幅只有80.1%，高涨幅占比19.0%',
      count: '79个代币'
    },
    {
      level: '高风险',
      pattern: '急涨型序列',
      description: '前期大量买入后期平稳的代币',
      stat: '平均涨幅只有195.4%',
      count: '99个代币'
    },
    {
      level: '中风险',
      pattern: '波动型序列',
      description: '买卖交替的代币',
      stat: '平均涨幅248.3%，但不确定性高',
      count: '502个代币（最多）'
    },
    {
      level: '中风险',
      pattern: '3-5次连续买入',
      description: '连续买入3-5次的模式',
      stat: '平均涨幅只有175%（谷底）',
      count: '分组中的代币'
    },
    {
      level: '低风险',
      pattern: '缓涨型序列',
      description: '持续稳定买入的代币',
      stat: '平均涨幅487.9%，高涨幅占比70%',
      count: '200个代币'
    }
  ];

  warnings.forEach(w => {
    const levelIcon = w.level === '高风险' ? '🔴' : w.level === '中风险' ? '🟡' : '🟢';
    console.log(`${levelIcon} ${w.level}: ${w.pattern}`);
    console.log(`   描述: ${w.description}`);
    console.log(`   数据: ${w.stat}`);
    console.log(`   数量: ${w.count}\n`);
  });
}

/**
 * 生成综合报告
 */
function generateReport(findings, predictors, strategies, warnings) {
  const report = {
    generated_at: new Date().toISOString(),
    dataset_size: 945,
    analysis_summary: {
      total_analyses: 12,
      key_findings: Object.keys(findings).length,
      predictive_factors: predictors.length
    },
    core_findings: findings,
    predictor_rankings: predictors,
    trading_strategies: strategies,
    risk_warnings: warnings,
    conclusions: [
      '传统"狙击"策略（早期买入）在数据中表现最差',
      '整体指标（净流入、钱包数）比早期特征更有预测力',
      '序列形状（缓涨vs急涨）是重要的分类维度',
      '网络中心性（钱包影响力）与代币表现负相关',
      '后期（2-3分钟）比早期（前30秒）更有预测价值'
    ]
  };

  // 保存报告
  const reportPath = path.join(OUTPUT_DIR, 'comprehensive_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n========================================');
  console.log('综合报告已生成');
  console.log('========================================\n');
  console.log(`报告路径: ${reportPath}`);

  return report;
}

async function main() {
  console.log('========================================');
  console.log('代币交易序列分析 - 最终总结报告');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`数据集: ${sequences.length} 个代币\n`);

  // 1. 核心发现
  const findings = generateCoreFindings(sequences);

  // 2. 预测因子排名
  const predictors = predictorRanking(sequences);

  // 3. 交易策略建议
  const strategies = tradingStrategies(sequences);

  // 4. 风险警示
  const warnings = riskWarnings(sequences);

  // 5. 生成综合报告
  const report = generateReport(findings, predictors, strategies, warnings);

  console.log('\n========================================');
  console.log('分析完成');
  console.log('========================================\n');
  console.log('本次分析共进行了以下角度的探索:');
  console.log('  1. 矩阵分解 (SVD)');
  console.log('  2. Node2Vec图嵌入');
  console.log('  3. 直接时序相似度');
  console.log('  4. 时间分段分析');
  console.log('  5. 钱包角色分析');
  console.log('  6. 序列模式挖掘');
  console.log('  7. 预测建模 (信息价值)');
  console.log('  8. 因果分析 (净流入构成)');
  console.log('  9. 聚类分析 (K-means)');
  console.log('  10. 失败案例分析');
  console.log('  11. 网络中心性 (PageRank)');
  console.log('  12. 可视化模式分析\n');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('分析失败:', err);
  process.exit(1);
});
