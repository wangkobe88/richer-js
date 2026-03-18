const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 从项目根目录读取.env
const envPath = path.resolve(__dirname, '../../config/.env');
const envContent = fs.readFileSync(envPath, 'utf-8');

// 解析环境变量
const envVars = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match && !line.startsWith('#')) {
    envVars[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
});

const SUPABASE_URL = envVars.SUPABASE_URL;
const SUPABASE_ANON_KEY = envVars.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Supabase配置未找到');
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const experiments = {
  '70fea05f': '70fea05f-2ed5-4b82-86d2-3dcddf27ab11',
  '7855de6d': '7855de6d-5f74-4884-a44e-3c2c2b351259',
  'e3c37811': 'e3c37811-f050-436e-b446-f51f6895bfb8'
};

async function getTrades(expId) {
  const { data } = await client
    .from('trades')
    .select('*')
    .eq('experiment_id', expId)
    .eq('success', true)
    .order('executed_at', { ascending: true });
  return data || [];
}

function calculatePnL(trades, excludeTokens = new Set()) {
  const buyQueue = [];
  let totalSpent = 0;
  let totalReceived = 0;

  const filteredTrades = trades.filter(t => !excludeTokens.has(t.token_address));

  filteredTrades.forEach(trade => {
    const isBuy = trade.trade_direction === 'buy';
    const inputAmount = parseFloat(trade.input_amount || 0);
    const outputAmount = parseFloat(trade.output_amount || 0);

    if (isBuy) {
      if (outputAmount > 0) {
        buyQueue.push({ amount: outputAmount, cost: inputAmount });
        totalSpent += inputAmount;
      }
    } else {
      let remainingToSell = inputAmount;
      let pairCost = 0;

      while (remainingToSell > 0 && buyQueue.length > 0) {
        const oldestBuy = buyQueue[0];
        const sellAmount = Math.min(remainingToSell, oldestBuy.amount);
        const unitCost = oldestBuy.cost / oldestBuy.amount;

        pairCost += unitCost * sellAmount;
        remainingToSell -= sellAmount;
        oldestBuy.amount -= sellAmount;

        if (oldestBuy.amount <= 0.00000001) {
          buyQueue.shift();
        }
      }

      totalReceived += parseFloat(trade.output_amount || 0);
    }
  });

  const totalPnL = totalReceived - totalSpent;
  const totalReturnRate = totalSpent > 0 ? (totalPnL / totalSpent) * 100 : 0;

  return {
    totalTrades: trades.length,
    filteredTrades: trades.length - filteredTrades.length,
    effectiveTrades: filteredTrades.length,
    totalSpent,
    totalReceived,
    totalPnL,
    totalReturnRate
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('           规则评分 vs LLM评分 - 投资收益对比');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 加载LLM评分数据
  const llmData = JSON.parse(fs.readFileSync('data/llm_narrative_scores.json', 'utf-8'));
  const ruleData = JSON.parse(fs.readFileSync('data/combined_narrative_scores.json', 'utf-8'));

  // 收集低质量代币地址
  const ruleLowQuality = new Set();
  const llmLowQuality = new Set();

  for (const [expId, expData] of Object.entries(ruleData)) {
    for (const t of expData.tokens) {
      if (t.narrative_category === 'low') {
        ruleLowQuality.add(t.address);
      }
    }
  }

  for (const [expId, expData] of Object.entries(llmData)) {
    for (const t of expData.tokens) {
      if (t.llmCategory === 'low') {
        llmLowQuality.add(t.address);
      }
    }
  }

  console.log('规则低质量代币:', ruleLowQuality.size, '个');
  console.log('LLM低质量代币:', llmLowQuality.size, '个');
  console.log('重叠:', [...ruleLowQuality].filter(x => llmLowQuality.has(x)).length, '个\n');

  // 计算各实验收益
  const results = {};

  for (const [shortId, expId] of Object.entries(experiments)) {
    const trades = await getTrades(expId);

    const original = calculatePnL(trades, new Set());
    const ruleFiltered = calculatePnL(trades, ruleLowQuality);
    const llmFiltered = calculatePnL(trades, llmLowQuality);

    results[shortId] = {
      expId,
      original,
      ruleFiltered,
      llmFiltered
    };
  }

  // 汇总
  const sumMetrics = (key, filterType) => {
    return Object.values(results).reduce((sum, r) => sum + r[filterType][key], 0);
  };

  const calculateAggregated = (filterType) => {
    const totalSpent = sumMetrics('totalSpent', filterType);
    const totalReceived = sumMetrics('totalReceived', filterType);
    const totalPnL = totalReceived - totalSpent;
    const totalReturnRate = totalSpent > 0 ? (totalPnL / totalSpent) * 100 : 0;

    return { totalSpent, totalReceived, totalPnL, totalReturnRate };
  };

  const original = calculateAggregated('original');
  const ruleFiltered = calculateAggregated('ruleFiltered');
  const llmFiltered = calculateAggregated('llmFiltered');

  // 打印对比表
  console.log('┌──────────────────┬─────────────┬─────────────┬─────────────┐');
  console.log('│   评分方式       │   收益率    │   总投入    │   总收回    │');
  console.log('├──────────────────┼─────────────┼─────────────┼─────────────┤');

  console.log('│ 原始（无过滤）   │ ' + original.totalReturnRate.toFixed(5).padStart(9) + '% │ ' + original.totalSpent.toFixed(2).padStart(9) + ' │ ' + original.totalReceived.toFixed(2).padStart(9) + ' │');
  console.log('│ 规则评分过滤     │ ' + ruleFiltered.totalReturnRate.toFixed(5).padStart(9) + '% │ ' + ruleFiltered.totalSpent.toFixed(2).padStart(9) + ' │ ' + ruleFiltered.totalReceived.toFixed(2).padStart(9) + ' │');
  console.log('│ LLM评分过滤      │ ' + llmFiltered.totalReturnRate.toFixed(5).padStart(9) + '% │ ' + llmFiltered.totalSpent.toFixed(2).padStart(9) + ' │ ' + llmFiltered.totalReceived.toFixed(2).padStart(9) + ' │');

  console.log('└──────────────────┴─────────────┴─────────────┴─────────────┘');

  // 计算改进幅度
  const ruleImprovement = ruleFiltered.totalReturnRate - original.totalReturnRate;
  const llmImprovement = llmFiltered.totalReturnRate - original.totalReturnRate;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                          结论');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('规则评分过滤: 收益率 ' + (ruleImprovement >= 0 ? '+' : '') + ruleImprovement.toFixed(2) + '%');
  console.log('LLM评分过滤:  收益率 ' + (llmImprovement >= 0 ? '+' : '') + llmImprovement.toFixed(2) + '%');

  if (Math.abs(ruleImprovement - llmImprovement) < 1) {
    console.log('\n✅ 两种评分方法效果相当');
  } else if (llmImprovement > ruleImprovement) {
    console.log('\n🎯 LLM评分效果更好！');
  } else {
    console.log('\n🎯 规则评分效果更好！');
  }

  // 保存对比结果
  const outputPath = 'data/scoring_comparison.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    original,
    ruleFiltered,
    llmFiltered,
    ruleImprovement,
    llmImprovement,
    perExperiment: results
  }, null, 2));

  console.log('\n💾 对比结果已保存: ' + outputPath);
}

main().catch(console.error);
