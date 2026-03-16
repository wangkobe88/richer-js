/**
 * 序列构建脚本
 * 从采集的原始数据中提取交易序列，用于无监督聚类分析
 */

const fs = require('fs');
const path = require('path');
const { TradeParser } = require('./utils/trade_parser');

// 目录配置
const RAW_DATA_DIR = path.join(__dirname, 'data', 'raw');
const PROCESSED_DATA_DIR = path.join(__dirname, 'data', 'processed');

/**
 * 读取所有原始数据文件
 */
function readRawDataFiles() {
  if (!fs.existsSync(RAW_DATA_DIR)) {
    console.error(`错误: 原始数据目录不存在: ${RAW_DATA_DIR}`);
    console.log('请先运行 collect_data.js 采集数据');
    process.exit(1);
  }

  const files = fs.readdirSync(RAW_DATA_DIR)
    .filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    console.error(`错误: 原始数据目录中没有文件: ${RAW_DATA_DIR}`);
    console.log('请先运行 collect_data.js 采集数据');
    process.exit(1);
  }

  console.log(`找到 ${files.length} 个原始数据文件\n`);

  const allData = [];

  for (const file of files) {
    const filepath = path.join(RAW_DATA_DIR, file);
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const data = JSON.parse(content);
      allData.push(data);
      console.log(`✓ 读取: ${file} (${data.tokens?.length || 0} 个代币)`);
    } catch (error) {
      console.error(`✗ 读取失败: ${file} - ${error.message}`);
    }
  }

  return allData;
}

/**
 * 处理单个代币，生成序列
 */
function processToken(token, experimentId) {
  const tokenAddress = token.token_address;
  const aveResponse = token.ave_api_response;

  // 验证 API 响应
  const { valid, errors } = TradeParser.validateResponse(aveResponse);
  if (!valid) {
    return {
      error: 'Invalid API response',
      errors
    };
  }

  // 解析序列
  const sequence = TradeParser.parseSequence(aveResponse, tokenAddress);

  // 如果序列为空
  if (sequence.length === 0) {
    return {
      error: 'No trades found'
    };
  }

  // 计算统计信息
  const stats = TradeParser.calculateStats(sequence);

  return {
    token_address: tokenAddress,
    token_symbol: token.token_symbol,
    chain: token.chain,
    platform: token.platform,
    experiment_id: experimentId,
    max_change_percent: token.max_change_percent || 0,
    sequence: sequence,
    stats: stats
  };
}

/**
 * 处理所有数据
 */
function processAllData(rawDataList) {
  console.log('\n开始构建交易序列...\n');

  const allSequences = [];
  let errorCount = 0;

  for (const experimentData of rawDataList) {
    const experimentId = experimentData.experiment_id;
    const tokens = experimentData.tokens || [];

    console.log(`【实验 ${experimentId.slice(0, 8)}...】 ${tokens.length} 个代币`);

    for (const token of tokens) {
      const processed = processToken(token, experimentId);

      if (processed.error) {
        errorCount++;
        continue;
      }

      allSequences.push(processed);
    }

    console.log(`  成功: ${allSequences.length}/${tokens.length}\n`);
  }

  return { allSequences, errorCount };
}

/**
 * 保存序列数据
 */
function saveSequences(data) {
  if (!fs.existsSync(PROCESSED_DATA_DIR)) {
    fs.mkdirSync(PROCESSED_DATA_DIR, { recursive: true });
  }

  const { allSequences } = data;

  // 保存所有序列（主文件）
  const allPath = path.join(PROCESSED_DATA_DIR, 'all_sequences.json');
  fs.writeFileSync(allPath, JSON.stringify({
    total_tokens: allSequences.length,
    generated_at: new Date().toISOString(),
    sequences: allSequences
  }, null, 2));
  console.log(`✓ 已保存: all_sequences.json (${allSequences.length} 个代币)`);

  // 为聚类准备：保存特征向量
  const features = extractFeatures(allSequences);
  const featuresPath = path.join(PROCESSED_DATA_DIR, 'features.json');
  fs.writeFileSync(featuresPath, JSON.stringify({
    total_tokens: features.length,
    generated_at: new Date().toISOString(),
    features: features
  }, null, 2));
  console.log(`✓ 已保存: features.json (${features.length} 个特征向量)`);

  // 保存特征说明
  const metaPath = path.join(PROCESSED_DATA_DIR, 'feature_metadata.json');
  fs.writeFileSync(metaPath, JSON.stringify({
    description: '交易序列特征说明',
    features: getFeatureDescriptions(),
    generated_at: new Date().toISOString()
  }, null, 2));
  console.log(`✓ 已保存: feature_metadata.json (特征说明)`);
}

/**
 * 提取特征向量（用于聚类）
 */
function extractFeatures(sequences) {
  return sequences.map(s => ({
    token_address: s.token_address,
    token_symbol: s.token_symbol,
    experiment_id: s.experiment_id,
    max_change_percent: s.max_change_percent,

    // 基础统计特征
    seq_length: s.stats.length,
    unique_wallets: s.stats.unique_wallets,
    total_buys: s.stats.total_buys,
    total_sells: s.stats.total_sells,
    buy_sell_ratio: s.stats.total_sells > 0 ? s.stats.total_buys / s.stats.total_sells : s.stats.total_buys,

    // 金额特征
    total_buy_amount: s.stats.total_buy_amount,
    total_sell_amount: s.stats.total_sell_amount,
    net_flow: s.stats.net_flow,
    avg_buy_amount: s.stats.total_buys > 0 ? s.stats.total_buy_amount / s.stats.total_buys : 0,
    avg_sell_amount: s.stats.total_sells > 0 ? s.stats.total_sell_amount / s.stats.total_sells : 0,

    // 序列特征（基于原始序列）
    wallet_repeat_ratio: calculateWalletRepeatRatio(s.sequence),
    first_buy_amount: getFirstBuyAmount(s.sequence),
    last_buy_amount: getLastBuyAmount(s.sequence),
    time_span_seconds: calculateTimeSpan(s.sequence)
  }));
}

/**
 * 计算钱包重复率（重复出现的钱包占比）
 */
function calculateWalletRepeatRatio(sequence) {
  const walletCounts = {};
  sequence.forEach(([wallet]) => {
    walletCounts[wallet] = (walletCounts[wallet] || 0) + 1;
  });

  const repeatCount = Object.values(walletCounts).filter(c => c > 1).length;
  return sequence.length > 0 ? repeatCount / Object.keys(walletCounts).length : 0;
}

/**
 * 获取第一笔买入金额
 */
function getFirstBuyAmount(sequence) {
  for (const [_, amount] of sequence) {
    if (amount > 0) return amount;
  }
  return 0;
}

/**
 * 获取最后一笔买入金额
 */
function getLastBuyAmount(sequence) {
  for (let i = sequence.length - 1; i >= 0; i--) {
    if (sequence[i][1] > 0) return sequence[i][1];
  }
  return 0;
}

/**
 * 计算序列时间跨度（如果有时间信息）
 * 注意：当前序列格式没有时间戳，返回 0
 * 如果需要时间信息，需要修改采集脚本保存原始交易的时间戳
 */
function calculateTimeSpan(sequence) {
  // 当前序列格式: [[wallet, amount], ...]
  // 如果需要时间跨度，需要修改数据结构
  return 0;
}

/**
 * 获取特征说明
 */
function getFeatureDescriptions() {
  return {
    seq_length: '序列长度（总交易笔数）',
    unique_wallets: '唯一钱包数',
    total_buys: '总买入笔数',
    total_sells: '总卖出笔数',
    buy_sell_ratio: '买卖比例（买入/卖出）',
    total_buy_amount: '总买入金额（USD）',
    total_sell_amount: '总卖出金额（USD）',
    net_flow: '净流入（买入-卖出）',
    avg_buy_amount: '平均买入金额',
    avg_sell_amount: '平均卖出金额',
    wallet_repeat_ratio: '钱包重复率（重复钱包/总钱包）',
    first_buy_amount: '第一笔买入金额',
    last_buy_amount: '最后一笔买入金额',
    time_span_seconds: '时间跨度（秒）',
    max_change_percent: '代币最大涨幅（%）'
  };
}

/**
 * 打印统计信息
 */
function printStatistics(allSequences, errorCount) {
  console.log('\n========================================');
  console.log('序列统计信息');
  console.log('========================================');

  // 总体统计
  console.log(`总代币数: ${allSequences.length}`);
  console.log(`处理失败: ${errorCount}`);

  // 涨幅分布
  const maxChanges = allSequences.map(s => s.max_change_percent);
  maxChanges.sort((a, b) => a - b);
  console.log(`\n涨幅分布:`);
  console.log(`  最小: ${maxChanges[0].toFixed(1)}%`);
  console.log(`  25分位: ${maxChanges[Math.floor(maxChanges.length * 0.25)].toFixed(1)}%`);
  console.log(`  中位数: ${maxChanges[Math.floor(maxChanges.length * 0.5)].toFixed(1)}%`);
  console.log(`  75分位: ${maxChanges[Math.floor(maxChanges.length * 0.75)].toFixed(1)}%`);
  console.log(`  最大: ${maxChanges[maxChanges.length - 1].toFixed(1)}%`);
  console.log(`  平均: ${(maxChanges.reduce((a, b) => a + b, 0) / maxChanges.length).toFixed(1)}%`);

  // 序列长度统计
  const lengths = allSequences.map(s => s.stats.length);
  lengths.sort((a, b) => a - b);
  console.log(`\n序列长度统计:`);
  console.log(`  最小: ${lengths[0]}`);
  console.log(`  中位数: ${lengths[Math.floor(lengths.length / 2)]}`);
  console.log(`  最大: ${lengths[lengths.length - 1]}`);
  console.log(`  平均: ${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)}`);

  // 唯一钱包数统计
  const uniqueWallets = allSequences.map(s => s.stats.unique_wallets);
  uniqueWallets.sort((a, b) => a - b);
  console.log(`\n唯一钱包数统计:`);
  console.log(`  最小: ${uniqueWallets[0]}`);
  console.log(`  中位数: ${uniqueWallets[Math.floor(uniqueWallets.length / 2)]}`);
  console.log(`  最大: ${uniqueWallets[uniqueWallets.length - 1]}`);

  // 净流入统计
  const netFlows = allSequences.map(s => s.stats.net_flow);
  netFlows.sort((a, b) => a - b);
  console.log(`\n净流入统计:`);
  console.log(`  最小: $${netFlows[0].toFixed(0)}`);
  console.log(`  中位数: $${netFlows[Math.floor(netFlows.length / 2)].toFixed(0)}`);
  console.log(`  最大: $${netFlows[netFlows.length - 1].toFixed(0)}`);
  console.log(`  平均: $${(netFlows.reduce((a, b) => a + b, 0) / netFlows.length).toFixed(0)}`);

  console.log('========================================\n');
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('构建交易序列（用于无监督聚类）');
  console.log('========================================');

  // 读取原始数据
  const rawDataList = readRawDataFiles();

  // 处理数据
  const data = processAllData(rawDataList);

  // 保存序列
  saveSequences(data);

  // 打印统计
  printStatistics(data.allSequences, data.errorCount);

  console.log('✓ 序列构建完成!');
  console.log(`数据保存在: ${PROCESSED_DATA_DIR}\n`);
  console.log('下一步: 可使用 features.json 进行聚类分析\n');
}

// 运行
main().catch(err => {
  console.error('构建失败:', err);
  process.exit(1);
});
