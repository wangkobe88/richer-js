/**
 * 直接调用 /api/token-early-trades API
 * 获取并展示原始交易数据，寻找拉盘砸盘的深层规律
 */

const http = require('http');

// 辅助函数：调用API
function callEarlyTradesAPI(tokenAddress, chain, timeWindowMinutes = 5) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      tokenAddress,
      chain,
      timeWindowMinutes,
      limit: 300
    });

    const options = {
      hostname: 'localhost',
      port: 3010,
      path: '/api/token-early-trades',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.success) {
            resolve(result.data);
          } else {
            reject(new Error(result.error || 'API调用失败'));
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

// 辅助函数：转换为北京时间
function toBeijingTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp * 1000);
  const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return beijingTime.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').substring(0, 19);
}

async function analyzePumpDumpTokens() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    拉盘砸盘代币：早期交易原始数据分析                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 用户提供的代币地址
  const tokensToAnalyze = [
    { address: '0x67e4c7e7b6b0a3431dd9fed80df2c56ecdfb4444', name: 'FREEDOM', chain: 'bsc', expectedPattern: '拉盘砸盘' },
    { address: '0xfc295e1d2b4202baf68a07ffd1cde7bbe7d34444', name: 'AND', chain: 'bsc', expectedPattern: '拉盘砸盘' },
    { address: '0x30a8dc7efe946872277afb5da71aed4010f54444', name: 'UNKNOWN', chain: 'bsc', expectedPattern: '未知' }
  ];

  // 获取好票对比
  const goodTokens = [
    { address: '0x616ddfe8a24f95984f35de866e1570550b1a4444', name: '巨鲸', chain: 'bsc', expectedPattern: '好票' },
    { address: '0xddfcf4aa4e9bb93e5713545b581862e97d384444', name: '鲸落', chain: 'bsc', expectedPattern: '好票' }
  ];

  // 分析拉盘砸盘代币
  console.log('【拉盘砸盘代币】\n');

  for (const token of tokensToAnalyze) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`代币: ${token.name} (${token.address})`);
    console.log(`预期模式: ${token.expectedPattern}`);
    console.log(`${'='.repeat(100)}\n`);

    try {
      const data = await callEarlyTradesAPI(token.address, token.chain, 3);

      console.log(`📊 API返回信息:`);
      console.log(`   Token: ${data.tokenInfo?.token?.symbol || token.name}`);
      console.log(`   Platform: ${data.tokenInfo?.token?.platform || 'unknown'}`);
      console.log(`   Launch At: ${toBeijingTime(data.debug?.launchAt || data.tokenInfo?.token?.launch_at)}`);
      console.log(`   总交易数: ${data.debug?.totalTrades || 0}`);
      console.log(`   返回交易数: ${data.debug?.returnedTrades || 0}`);
      console.log(`   分页次数: ${data.debug?.pagination?.totalPages || 0}`);
      console.log('');

      // 展示原始交易数据（前50笔）
      const trades = data.earlyTrades || [];
      console.log(`📋 早期交易序列 (前50笔):\n`);

      console.log('序号   时间(秒)   类型        方向              from                  to                 USD        时间');
      console.log('─'.repeat(115));

      trades.slice(0, 50).forEach((t, i) => {
        // 计算相对时间
        const launchAt = data.debug?.launchAt || data.tokenInfo?.token?.launch_at;
        const secondsFromLaunch = t.time - launchAt;
        const timeStr = `${secondsFromLaunch.toFixed(1).padStart(6)}s`;

        // 判断是买入还是卖出
        const tokenLower = token.address.toLowerCase();
        const isBuy = t.to_token?.toLowerCase?.() === tokenLower ||
                     t.to_token_address?.toLowerCase?.() === tokenLower;
        const type = isBuy ? '买入' : '卖出';

        // 获取代币地址
        const fromToken = t.from_token_address || t.from_token || 'unknown';
        const toToken = t.to_token_address || t.to_token || 'unknown';

        // 判断方向
        let direction = '';
        if (fromToken.toLowerCase().startsWith('0xbb4c') || fromToken.toLowerCase().startsWith('0x55d3')) {
          // WBNB or BNB
          direction = isBuy ? 'BNB→Token' : 'Token→BNB';
        } else if (toToken.toLowerCase().startsWith('0xbb4c') || toToken.toLowerCase().startsWith('0x55d3')) {
          direction = isBuy ? 'BNB→Token' : 'Token→BNB';
        }

        const fromSymbol = t.from_token_symbol || '';
        const toSymbol = t.to_token_symbol || '';
        const fromAmount = t.from_amount || t.from_token_amount || 0;
        const toAmount = t.to_amount || t.to_token_amount || 0;
        const usdValue = t.amount_usd || t.from_usd || t.to_usd || 0;
        const beijingTime = toBeijingTime(t.time);

        // 只显示有意义的交易
        if (fromAmount > 0 || toAmount > 0) {
          console.log(`${(i + 1).toString().padStart(3)}  ${timeStr}  ${type.padStart(4)}  ${direction.padStart(10)}  ${fromToken.substring(0, 8)}...  ${toToken.substring(0, 8)}...  ${usdValue.toFixed(0).padStart(8)}  ${beijingTime}`);
        }
      });

      // 分析交易模式
      console.log('\n');
      console.log('🔍 交易模式分析:\n');

      // 统计买入/卖出
      const buyTrades = trades.filter(t => {
        const tokenLower = token.address.toLowerCase();
        return t.to_token_address?.toLowerCase?.() === tokenLower;
      });
      const sellTrades = trades.filter(t => {
        const tokenLower = token.address.toLowerCase();
        return t.from_token_address?.toLowerCase?.() === tokenLower;
      });

      console.log(`   买入: ${buyTrades.length}笔, 卖出: ${sellTrades.length}笔`);

      if (buyTrades.length > 0) {
        const buyUSD = buyTrades.reduce((sum, t) => sum + (t.amount_usd || t.from_usd || t.to_usd || 0), 0);
        console.log(`   买入总额: $${buyUSD.toFixed(0)}`);
      }

      if (sellTrades.length > 0) {
        const sellUSD = sellTrades.reduce((sum, t) => sum + (t.amount_usd || t.from_usd || t.to_usd || 0), 0);
        console.log(`   卖出总额: $${sellUSD.toFixed(0)}`);
      }

      // 分析时间间隔
      if (trades.length > 1) {
        const intervals = [];
        for (let i = 1; i < Math.min(50, trades.length); i++) {
          intervals.push(trades[i].time - trades[i-1].time);
        }

        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const minInterval = Math.min(...intervals);
        const maxInterval = Math.max(...intervals);

        console.log(`   交易间隔: 平均${avgInterval.toFixed(2)}秒, 最小${minInterval.toFixed(2)}秒, 最大${maxInterval.toFixed(2)}秒`);

        // 分析是否有大量交易在同一时间
        const sameTimeTrades = intervals.filter(i => i < 1).length;
        if (sameTimeTrades > 10) {
          console.log(`   ⚠️  发现${sameTimeTrades}笔交易几乎同时发生（可能脚本交易）`);
        }
      }

      // 分析参与地址
      const wallets = new Set();
      trades.forEach(t => {
        if (t.wallet_address) wallets.add(t.wallet_address);
        if (t.sender_address) wallets.add(t.sender_address);
      });
      console.log(`   唯一地址数: ${wallets.size}`);

    } catch (error) {
      console.error(`   ❌ 获取失败: ${error.message}`);
    }

    // 避免API限速
    await new Promise(r => setTimeout(r, 2000));
  }

  // 分析好票对比
  console.log('\n\n');
  console.log('【好票对比】\n');

  for (const token of goodTokens) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`代币: ${token.name} (${token.address})`);
    console.log(`预期模式: ${token.expectedPattern}`);
    console.log(`${'='.repeat(100)}\n`);

    try {
      const data = await callEarlyTradesAPI(token.address, token.chain, 3);

      console.log(`📊 API返回信息:`);
      console.log(`   Token: ${data.tokenInfo?.token?.symbol || token.name}`);
      console.log(`   总交易数: ${data.debug?.totalTrades || 0}`);
      console.log('');

      // 展示原始交易数据（前30笔）
      const trades = data.earlyTrades || [];
      console.log(`📋 早期交易序列 (前30笔):\n`);

      console.log('序号   时间(秒)   类型        USD        时间');
      console.log('─'.repeat(70));

      trades.slice(0, 30).forEach((t, i) => {
        const launchAt = data.debug?.launchAt || data.tokenInfo?.token?.launch_at;
        const secondsFromLaunch = t.time - launchAt;
        const timeStr = `${secondsFromLaunch.toFixed(1).padStart(6)}s`;

        const tokenLower = token.address.toLowerCase();
        const isBuy = t.to_token_address?.toLowerCase?.() === tokenLower;
        const type = isBuy ? '买入' : '卖出';

        const usdValue = t.amount_usd || t.from_usd || t.to_usd || 0;
        const beijingTime = toBeijingTime(t.time);

        console.log(`${(i + 1).toString().padStart(3)}  ${timeStr}  ${type.padStart(4)}  ${usdValue.toFixed(0).padStart(8)}  ${beijingTime}`);
      });

    } catch (error) {
      console.error(`   ❌ 获取失败: ${error.message}`);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n\n');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzePumpDumpTokens().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
