const { createClient } = require('@supabase/supabase-js');
const { AveTxAPI } = require('../../src/core/ave-api');
const config = require('../../config/default.json');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const txApi = new AveTxAPI(config.ave?.apiUrl || 'https://prod.ave-api.com', config.ave?.timeout || 30000, process.env.AVE_API_KEY);

async function analyzeWalletStats() {
  const expId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取信号和代币数据
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', expId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  const executed = signals?.filter(s => s.metadata?.execution_status === 'executed') || [];
  const uniqueSignals = new Map();
  for (const sig of executed) {
    if (!uniqueSignals.has(sig.token_address)) uniqueSignals.set(sig.token_address, sig);
  }
  const signalList = Array.from(uniqueSignals.values()).slice(0, 30);

  const tokenAddresses = signalList.map(s => s.token_address);
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, raw_api_data')
    .eq('experiment_id', expId)
    .in('token_address', tokenAddresses);

  const pairMap = new Map();
  for (const token of tokens || []) {
    if (token.raw_api_data?.main_pair) {
      pairMap.set(token.token_address, token.raw_api_data.main_pair);
    }
  }

  const walletStats = new Map();

  for (const sig of signalList) {
    const mainPair = pairMap.get(sig.token_address);
    if (!mainPair) continue;

    const pairAddress = mainPair + '-bsc';
    const toTime = Math.floor(new Date(sig.created_at).getTime() / 1000);
    const fromTime = toTime - 90;

    try {
      const trades = await txApi.getSwapTransactions(pairAddress, 100, fromTime, toTime, 'asc', 0);

      for (const trade of trades) {
        const wallet = trade.from_address?.toLowerCase();
        if (!wallet) continue;

        if (!walletStats.has(wallet)) {
          walletStats.set(wallet, { buy: 0, sell: 0, trades: 0, tokens: new Set() });
        }

        const stats = walletStats.get(wallet);
        const usdAmount = trade.amount_usd || 0;

        // 判断是买入还是卖出
        // 如果 from_token 是目标代币，则是卖出；否则是买入
        const isSell = trade.from_token_address?.toLowerCase() === sig.token_address?.toLowerCase();

        if (isSell) {
          stats.sell += usdAmount;
        } else {
          stats.buy += usdAmount;
        }
        stats.trades++;
        stats.tokens.add(sig.token_address);
      }
    } catch (e) {
      // 忽略错误
    }
  }

  // 分析分布
  const statsArray = Array.from(walletStats.values()).filter(s => s.trades >= 5);

  console.log('钱包统计分布 (交易次数>=5): ' + statsArray.length);
  console.log('');

  statsArray.sort((a, b) => Math.abs(b.sell - b.buy) - Math.abs(a.sell - a.buy));

  console.log('Top 30 按 |buy-sell| 排序:');
  statsArray.slice(0, 30).forEach((s, i) => {
    const profit = Math.abs(s.sell - s.buy);
    const sellRatio = s.buy > 0 ? s.sell / s.buy : 0;
    console.log((i+1) + '. profit=$' + profit.toFixed(0) + ', buy=$' + s.buy.toFixed(0) + ', sell=$' + s.sell.toFixed(0) + ', trades=' + s.trades + ', tokens=' + s.tokens.size + ', sellRatio=' + sellRatio.toFixed(2));
  });

  // 统计符合各个条件的数量
  const profit30k = statsArray.filter(s => Math.abs(s.sell - s.buy) >= 30000);
  const sellRatio08 = statsArray.filter(s => s.buy > 0 && s.sell / s.buy >= 0.8);
  const trades500 = statsArray.filter(s => s.trades >= 500);
  const tokens3 = statsArray.filter(s => s.tokens.size >= 3);

  console.log('\n条件统计:');
  console.log('|profit| >= $30,000: ' + profit30k.length);
  console.log('sellRatio >= 0.8: ' + sellRatio08.length);
  console.log('trades >= 500: ' + trades500.length);
  console.log('tokens >= 3: ' + tokens3.length);
}

analyzeWalletStats().catch(console.error);
