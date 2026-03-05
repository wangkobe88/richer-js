// 快速评估贝叶斯模型 - 测试100个随机标注代币
import { dbManager } from '../src/services/dbManager.js';
import { BayesModelService } from '../src/services/BayesModelService.js';

const supabase = dbManager.getClient();
const bayesService = new BayesModelService();

async function quickEvaluate() {
  console.log('=== 贝叶斯模型快速评估 ===\n');
  console.log('从标注代币中随机抽取100个进行测试...\n');

  // 获取所有标注代币
  const { data: allTokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, human_judges')
    .not('human_judges', 'is', null);

  if (!allTokens || allTokens.length === 0) {
    console.error('没有找到标注代币');
    process.exit(1);
  }

  console.log(`找到 ${allTokens.length} 个标注代币\n`);

  // 按类别分组
  const byCategory = {};
  for (const token of allTokens) {
    const cat = token.human_judges.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(token);
  }

  console.log('类别分布:');
  for (const [cat, tokens] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${tokens.length}`);
  }

  // 每个类别随机抽取一定数量
  const toTest = [];
  const perCategory = 25;  // 每个类别最多25个

  for (const [cat, tokens] of Object.entries(byCategory)) {
    const shuffled = tokens.sort(() => Math.random() - 0.5);
    toTest.push(...shuffled.slice(0, Math.min(perCategory, tokens.length)));
  }

  console.log(`\n选取 ${toTest.length} 个代币进行测试\n`);

  // 加载模型
  await bayesService.loadModel();
  console.log('模型已加载\n');

  // 测试
  const results = [];
  let correct = 0;
  let total = 0;
  let withData = 0;
  const categoryStats = {};

  for (const token of toTest) {
    const trueCat = token.human_judges.category;
    const addr = token.token_address;

    if (!categoryStats[trueCat]) {
      categoryStats[trueCat] = { correct: 0, total: 0, withData: 0 };
    }

    try {
      const pred = await bayesService.predictToken(addr, 'bsc');
      const predCat = pred.predictedCategory;

      const isCorrect = trueCat === predCat;
      if (isCorrect) correct++;
      total++;
      categoryStats[trueCat].total++;
      if (isCorrect) categoryStats[trueCat].correct++;

      if (pred.walletCount > 0) {
        withData++;
        categoryStats[trueCat].withData++;
      }

      results.push({
        symbol: token.token_symbol || addr.slice(0, 8),
        address: addr.slice(0, 12) + '...',
        true: trueCat,
        predicted: predCat,
        confidence: Math.round(pred.confidence * 100),
        method: pred.method,
        walletCount: pred.walletCount,
        correct: isCorrect
      });

      // 每10个显示一次进度
      if (total % 10 === 0) {
        console.log(`进度: ${total}/${toTest.length} (${Math.round(total/toTest.length*100)}%)`);
      }

    } catch (e) {
      console.warn(`${token.token_symbol || addr.slice(0, 8)}: 预测失败 - ${e.message}`);
    }

    // 延迟避免速率限制
    await new Promise(r => setTimeout(r, 2000));
  }

  // 输出结果
  console.log('\n\n=== 评估结果 ===\n');

  console.log(`总准确率: ${correct}/${total} = ${(correct/total*100).toFixed(1)}%\n`);
  console.log(`有早期交易者数据的代币: ${withData}/${total} (${Math.round(withData/total*100)}%)`);
  console.log(`有数据的准确率: ${withData > 0 ? (correct/withData*100).toFixed(1) : 'N/A'}%\n`);

  console.log('各类别准确率:');
  for (const [cat, stats] of Object.entries(categoryStats)) {
    console.log(`  ${cat}:`);
    console.log(`    总数: ${stats.total}, 正确: ${stats.correct}, 准确率: ${(stats.correct/stats.total*100).toFixed(1)}%`);
    console.log(`    有数据: ${stats.withData}`);
  }

  console.log('\n错误案例 (前10个):');
  const errors = results.filter(r => !r.correct).slice(0, 10);
  for (const e of errors) {
    console.log(`  ${e.symbol}: ${e.true} -> ${e.predicted} (${e.walletCount} 交易者, ${e.method})`);
  }

  console.log('\n正确案例 (每类别前2个):');
  const corrects = results.filter(r => r.correct);
  const byCatCorrect = {};
  for (const r of corrects) {
    if (!byCatCorrect[r.true]) byCatCorrect[r.true] = [];
    byCatCorrect[r.true].push(r);
  }
  for (const [cat, rs] of Object.entries(byCatCorrect)) {
    console.log(`\n  ${cat}:`);
    for (const r of rs.slice(0, 2)) {
      console.log(`    ${r.symbol}: ${r.predicted} (${r.confidence}% 置信度, ${r.walletCount} 交易者)`);
    }
  }

  process.exit(0);
}

quickEvaluate().catch(err => {
  console.error('评估失败:', err);
  process.exit(1);
});
