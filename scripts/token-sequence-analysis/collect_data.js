/**
 * 代币早期交易数据采集脚本
 * 从实验中获取代币列表，并采集每个代币前3分钟的交易记录
 * 支持重试机制处理 429 错误
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// API 配置
const API_BASE = 'http://localhost:3010/api';

// 四个实验 ID
const EXPERIMENT_IDS = [
  '14bbd262-6464-4962-bc44-15be5de04ed5',
  '015db965-0b33-4d98-88b1-386203886381',
  '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1',
  '431ffc1c-9b68-491b-8707-08117a1d7b74'
];

// 数据保存目录
const DATA_DIR = path.join(__dirname, 'data', 'raw');
const TIME_WINDOW_SECONDS = 180; // 3分钟

// 并发控制
const MAX_CONCURRENT_REQUESTS = 2;  // 降低并发避免 429
const REQUEST_DELAY_MS = 200;       // 增加延迟

// 重试配置
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000; // 429 错误后等待 2 秒

/**
 * 延迟函数
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * HTTP GET 请求
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * HTTP POST 请求
 */
function httpPost(url, postData) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(postData);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = http.request(url, options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * 获取实验中的代币列表
 */
async function getExperimentTokens(experimentId) {
  console.log(`   获取实验 ${experimentId.slice(0, 8)}... 的代币列表...`);

  const result = await httpGet(
    `${API_BASE}/experiment/${experimentId}/tokens?limit=1000`
  );

  const tokens = result.tokens || result.data || result || [];

  console.log(`   找到 ${tokens.length} 个代币`);
  return tokens;
}

/**
 * 获取代币的早期交易数据（带重试机制）
 */
async function getTokenEarlyTrades(tokenAddress, chain, tokenSymbol, retryCount = 0) {
  const url = `${API_BASE}/token-early-trades`;

  try {
    const response = await httpPost(url, {
      tokenAddress,
      chain,
      timeWindowMinutes: TIME_WINDOW_SECONDS / 60
    });

    // 打印第一个成功/失败的详细信息用于调试
    if (!global._debugPrinted && retryCount === 0) {
      global._debugPrinted = true;
      if (response) {
        console.log(`      [DEBUG] 首次请求: ${tokenSymbol}`);
        console.log(`      [DEBUG] response.success: ${response.success}`);
        console.log(`      [DEBUG] response.error: ${response.error || '(none)'}`);
        console.log(`      [DEBUG] response.data exists: ${!!response.data}`);
      } else {
        console.log(`      [DEBUG] 首次请求返回 null: ${tokenSymbol}`);
      }
    }

    // 检查是否是 429 错误
    if (response && !response.success) {
      const errorMsg = response.error || '';
      if (errorMsg.includes('429') || res?.statusCode === 429) {
        if (retryCount < MAX_RETRIES) {
          const waitTime = RETRY_DELAY_MS * Math.pow(2, retryCount); // 指数退避: 2s, 4s, 8s, 16s, 32s
          console.log(`      ⏳ ${tokenSymbol}: 429 错误，${waitTime / 1000}秒后重试 (${retryCount + 1}/${MAX_RETRIES})`);
          await delay(waitTime);
          return getTokenEarlyTrades(tokenAddress, chain, tokenSymbol, retryCount + 1);
        } else {
          console.error(`      ✗ ${tokenSymbol}: 429 错误，已重试 ${MAX_RETRIES} 次，放弃`);
          return null;
        }
      }
    }

    return response;
  } catch (error) {
    // 网络错误也重试
    if (retryCount < MAX_RETRIES) {
      const waitTime = RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.log(`      ⏳ ${tokenSymbol}: 网络错误，${waitTime / 1000}秒后重试 (${retryCount + 1}/${MAX_RETRIES})`);
      await delay(waitTime);
      return getTokenEarlyTrades(tokenAddress, chain, tokenSymbol, retryCount + 1);
    }
    console.error(`      ✗ ${tokenSymbol}: 获取交易数据失败 - ${error.message}`);
    return null;
  }
}

/**
 * 并发处理代币列表（限制并发数）
 */
async function processTokensBatch(tokens, experimentId) {
  const results = [];
  let processed = 0;
  let failed = 0;

  // 分批处理
  for (let i = 0; i < tokens.length; i += MAX_CONCURRENT_REQUESTS) {
    const batch = tokens.slice(i, i + MAX_CONCURRENT_REQUESTS);

    const batchResults = await Promise.all(
      batch.map(async (token) => {
        await delay(REQUEST_DELAY_MS);

        const aveResponse = await getTokenEarlyTrades(
          token.token_address,
          token.blockchain,
          token.token_symbol
        );

        processed++;

        if (processed % 5 === 0 || processed === tokens.length) {
          console.log(`      进度: ${processed}/${tokens.length} (失败: ${failed})`);
        }

        if (!aveResponse || !aveResponse.success) {
          failed++;
          return null;
        }

        return {
          token_address: token.token_address,
          token_symbol: token.token_symbol,
          chain: token.blockchain,
          platform: token.raw_api_data?.issue_platform || 'fourmeme',
          max_change_percent: token.analysis_results?.max_change_percent ||
                             token.analysisResults?.max_change_percent ||
                             token.max_change_percent || 0,
          ave_api_response: aveResponse,
          collected_at: new Date().toISOString()
        };
      })
    );

    results.push(...batchResults.filter(r => r !== null));
  }

  return results;
}

/**
 * 采集单个实验的数据
 */
async function collectExperimentData(experimentId) {
  console.log(`\n【实验 ${experimentId.slice(0, 8)}...】`);

  // 获取代币列表
  const tokens = await getExperimentTokens(experimentId);

  if (tokens.length === 0) {
    console.log('   ⚠️ 没有代币，跳过');
    return null;
  }

  // 采集交易数据
  console.log(`   开始采集早期交易数据 (前${TIME_WINDOW_SECONDS / 60}分钟)...`);
  const tokenDataList = await processTokensBatch(tokens, experimentId);

  const experimentData = {
    experiment_id: experimentId,
    total_tokens: tokens.length,
    successful_collected: tokenDataList.length,
    failed: tokens.length - tokenDataList.length,
    time_window_seconds: TIME_WINDOW_SECONDS,
    tokens: tokenDataList,
    collected_at: new Date().toISOString()
  };

  console.log(`   ✓ 采集完成: ${tokenDataList.length}/${tokens.length} 成功`);

  return experimentData;
}

/**
 * 保存数据到文件
 */
function saveData(experimentId, data) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const filename = `exp_${experimentId.slice(0, 8)}.json`;
  const filepath = path.join(DATA_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');

  console.log(`   ✓ 已保存: ${filename}`);
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('代币早期交易数据采集（带重试）');
  console.log('========================================');
  console.log(`实验数量: ${EXPERIMENT_IDS.length}`);
  console.log(`时间窗口: 前 ${TIME_WINDOW_SECONDS / 60} 分钟`);
  console.log(`并发数: ${MAX_CONCURRENT_REQUESTS}`);
  console.log(`请求延迟: ${REQUEST_DELAY_MS}ms`);
  console.log(`最大重试: ${MAX_RETRIES} 次`);
  console.log(`保存目录: ${DATA_DIR}`);
  console.log('========================================\n');

  const startTime = Date.now();
  const summary = [];

  for (const experimentId of EXPERIMENT_IDS) {
    try {
      const data = await collectExperimentData(experimentId);

      if (data) {
        saveData(experimentId, data);
        summary.push({
          experiment_id: experimentId.slice(0, 8),
          total: data.total_tokens,
          success: data.successful_collected,
          failed: data.failed
        });
      }
    } catch (error) {
      console.error(`   ✗ 实验处理失败: ${error.message}`);
      summary.push({
        experiment_id: experimentId.slice(0, 8),
        total: 0,
        success: 0,
        failed: -1,
        error: error.message
      });
    }
  }

  // 汇总
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalTokens = summary.reduce((sum, s) => sum + s.total, 0);
  const totalSuccess = summary.reduce((sum, s) => sum + s.success, 0);
  const totalFailed = summary.reduce((sum, s) => sum + (s.failed || 0), 0);

  console.log('\n========================================');
  console.log('采集完成汇总');
  console.log('========================================');
  console.log(`总耗时: ${duration} 秒`);
  console.log(`总代币数: ${totalTokens}`);
  console.log(`成功采集: ${totalSuccess}`);
  console.log(`失败数量: ${totalFailed}`);
  console.log('\n各实验详情:');
  summary.forEach(s => {
    console.log(`  ${s.experiment_id}: ${s.success}/${s.total} 成功${s.failed > 0 ? ` (${s.failed} 失败)` : ''}`);
  });
  console.log('========================================\n');
}

// 运行
main().catch(err => {
  console.error('采集失败:', err);
  process.exit(1);
});
