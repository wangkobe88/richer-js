#!/usr/bin/env node

/**
 * 实验数据分析工具
 *
 * 使用方法:
 *   node main.js --id <实验ID> [选项]
 *
 * 选项:
 *   --id <实验ID>           要分析的实验ID (必需)
 *   --module <模块名>       只分析指定模块 (overview|missed-opportunities|bad-buys|bad-sells)
 *   --format <格式>         输出格式 (text|json|html) 默认: text
 *   --output <文件>         输出到文件
 *   --base-url <URL>        API基础URL (默认: http://localhost:3010/api)
 *   --min-return <数字>     最小最高涨幅阈值 (默认: 100)
 *   --no-fake-pump          排除流水盘 (默认: true)
 *   --no-low-quality        排除低质量 (默认: false)
 */

const { DataLoader } = require('./core/data-loader');
const { OverviewAnalyzer } = require('./analyzers/overview-analyzer');
const { MissedOpportunitiesAnalyzer } = require('./analyzers/missed-opportunities-analyzer');
const { BadBuysAnalyzer } = require('./analyzers/bad-buys-analyzer');
const { BadSellsAnalyzer } = require('./analyzers/bad-sells-analyzer');
const { PreCheckRejectionAnalyzer } = require('./analyzers/precheck-rejection-analyzer');
const { StrategyOptimizer } = require('./analyzers/strategy-optimizer');
const { ReportGenerator } = require('./core/report-generator');

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    id: null,
    module: null,
    format: 'text',
    output: null,
    baseUrl: 'http://localhost:3010/api',
    minReturn: 100,
    noFakePump: true,
    noLowQuality: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--id':
        options.id = args[++i];
        break;
      case '--module':
        options.module = args[++i];
        break;
      case '--format':
        options.format = args[++i];
        break;
      case '--output':
        options.output = args[++i];
        break;
      case '--base-url':
        options.baseUrl = args[++i];
        break;
      case '--min-return':
        options.minReturn = parseFloat(args[++i]);
        break;
      case '--no-fake-pump':
        options.noFakePump = true;
        break;
      case '--fake-pump':
        options.noFakePump = false;
        break;
      case '--no-low-quality':
        options.noLowQuality = true;
        break;
      case '--low-quality':
        options.noLowQuality = false;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  if (!options.id) {
    console.error('错误: 必须指定实验ID (--id)');
    console.error('使用 --help 查看帮助');
    process.exit(1);
  }

  return options;
}

/**
 * 打印帮助信息
 */
function printHelp() {
  console.log(`
实验数据分析工具

使用方法:
  node main.js --id <实验ID> [选项]

选项:
  --id <实验ID>           要分析的实验ID (必需)
  --module <模块名>       只分析指定模块
                          可选值: overview|missed-opportunities|bad-buys|bad-sells|precheck-rejection|optimizer
  --format <格式>         输出格式 (text|json|html) 默认: text
  --output <文件>         输出到文件
  --base-url <URL>        API基础URL (默认: http://localhost:3010/api)
  --min-return <数字>     最小最高涨幅阈值 (默认: 100)
  --fake-pump             包含流水盘代币
  --no-low-quality        排除低质量代币

模块说明:
  overview               概览分析 (实验整体表现)
  missed-opportunities   漏掉的好票分析
  bad-buys              错误购买分析
  bad-sells             错误卖出分析
  precheck-rejection    预检查拒绝分析 (哪些好票因预检查被拒绝)
  optimizer             策略优化建议 (综合分析)

示例:
  # 完整分析
  node main.js --id 543f039c-c1bd-45ba-94fa-b1490c123513

  # 只分析漏掉的好票
  node main.js --id 543f039c-c1bd-45ba-94fa-b1490c123513 --module missed-opportunities

  # 输出JSON格式
  node main.js --id 543f039c-c1bd-45ba-94fa-b1490c123513 --format json

  # 输出HTML报告到文件
  node main.js --id 543f039c-c1bd-45ba-94fa-b1490c123513 --format html --output report.html
`);
}

/**
 * 主函数
 */
async function main() {
  const options = parseArgs();

  console.log(`🔍 开始分析实验 ${options.id.slice(0, 8)}...\n`);

  // 创建数据加载器
  const dataLoader = new DataLoader(options.id, options.baseUrl);

  // 创建报告生成器
  const report = new ReportGenerator();

  try {
    // 验证实验是否存在
    const experiment = await dataLoader.getExperiment();
    if (!experiment) {
      throw new Error('实验不存在');
    }

    const experimentName = experiment.experimentName || experiment.name || '未命名实验';

    // 运行分析器
    const analyzerResults = {};

    // 1. 概览分析 (总是运行)
    if (!options.module || options.module === 'overview') {
      console.log('📊 分析概览...');
      const overviewAnalyzer = new OverviewAnalyzer(dataLoader);
      await overviewAnalyzer.analyze();
      analyzerResults.overview = overviewAnalyzer.getResults();
      report.addSection('一、概览', overviewAnalyzer.formatReport());
    }

    // 2. 漏掉的好票分析
    if (!options.module || options.module === 'missed-opportunities') {
      console.log('🎯 分析漏掉的好票...');
      const missedAnalyzer = new MissedOpportunitiesAnalyzer(dataLoader);
      await missedAnalyzer.analyze({
        minHighestReturn: options.minReturn,
        requireNonFakePump: options.noFakePump,
        requireNonLowQuality: options.noLowQuality
      });
      analyzerResults.missedOpportunities = missedAnalyzer.getResults();
      report.addSection('二、漏掉的好票', missedAnalyzer.formatReport());
    }

    // 3. 错误购买分析
    if (!options.module || options.module === 'bad-buys') {
      console.log('❌ 分析错误购买...');
      const badBuysAnalyzer = new BadBuysAnalyzer(dataLoader);
      await badBuysAnalyzer.analyze();
      analyzerResults.badBuys = badBuysAnalyzer.getResults();
      report.addSection('三、错误购买', badBuysAnalyzer.formatReport());
    }

    // 4. 错误卖出分析
    if (!options.module || options.module === 'bad-sells') {
      console.log('🔻 分析错误卖出...');
      const badSellsAnalyzer = new BadSellsAnalyzer(dataLoader);
      await badSellsAnalyzer.analyze();
      analyzerResults.badSells = badSellsAnalyzer.getResults();
      report.addSection('四、错误卖出', badSellsAnalyzer.formatReport());
    }

    // 5. 预检查拒绝分析
    if (!options.module || options.module === 'precheck-rejection') {
      console.log('🛡️  分析预检查拒绝...');
      const precheckAnalyzer = new PreCheckRejectionAnalyzer(dataLoader);
      await precheckAnalyzer.analyze({ minReturn: options.minReturn });
      analyzerResults.precheckRejection = precheckAnalyzer.getResults();
      report.addSection('五、预检查拒绝', precheckAnalyzer.formatReport());
    }

    // 6. 策略优化建议
    if (!options.module || options.module === 'optimizer') {
      console.log('⚙️  生成优化建议...');
      const optimizer = new StrategyOptimizer(dataLoader);
      optimizer.setAnalyzerResults(analyzerResults);
      await optimizer.analyze();
      analyzerResults.optimizer = optimizer.getResults();
      report.addSection('六、优化建议', optimizer.formatReport());
    }

    // 生成报告
    let output;
    switch (options.format) {
      case 'json':
        output = report.generateJSON();
        break;
      case 'html':
        output = report.generateHTML();
        break;
      case 'text':
      default:
        // 添加标题
        const title = `实验分析报告 - ${experimentName} (${options.id.slice(0, 8)}...)`;
        report.sections.unshift({ title: title, content: '' });
        output = report.generateText();
        break;
    }

    // 输出结果
    if (options.output) {
      const fs = require('fs');
      fs.writeFileSync(options.output, output, 'utf8');
      console.log(`\n✅ 报告已保存到: ${options.output}`);
    } else {
      console.log('\n' + output);
    }

    // 如果是JSON格式，同时保存原始数据
    if (options.format === 'json' && options.output) {
      const fs = require('fs');
      const dataFile = options.output.replace('.json', '.data.json');
      fs.writeFileSync(dataFile, JSON.stringify(analyzerResults, null, 2), 'utf8');
      console.log(`📊 原始数据已保存到: ${dataFile}`);
    }

  } catch (error) {
    console.error('\n❌ 分析失败:', error.message);
    if (error.message.includes('ECONNREFUSED')) {
      console.error('\n💡 提示: 请确保Web服务器正在运行 (npm run web)');
    }
    process.exit(1);
  }
}

// 运行主函数
main().catch(error => {
  console.error('未捕获的错误:', error);
  process.exit(1);
});
