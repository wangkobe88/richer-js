const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeStrongTraderDistribution() {
  // 获取所有信号（分批处理，因为不能直接查询 execution_reason）
  const batchSize = 100;
  let offset = 0;
  let allSignals = [];

  while (true) {
    const { data: batch } = await supabase
      .from('strategy_signals')
      .select('id, token_address, token_symbol, executed, metadata')
      .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
      .range(offset, offset + batchSize - 1);

    if (!batch || batch.length === 0) break;
    allSignals.push(...batch);
    offset += batchSize;

    if (batch.length < batchSize) break;
  }

  console.log('总信号数:', allSignals.length);

  // 分析 strongTraderNetPositionRatio
  const executed = [];
  const notExecuted = [];
  const noFactor = [];

  allSignals.forEach(s => {
    const ratio = s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio;
    if (ratio === undefined || ratio === null) {
      noFactor.push(s);
    } else if (s.executed) {
      executed.push({ ...s, ratio });
    } else {
      notExecuted.push({ ...s, ratio });
    }
  });

  console.log('\n=== 分类统计 ===');
  console.log('执行:', executed.length);
  console.log('未执行:', notExecuted.length);
  console.log('无因子数据:', noFactor.length);

  if (executed.length > 0) {
    const ratios = executed.map(s => s.ratio);
    ratios.sort((a, b) => a - b);
    console.log('\n=== 执行信号的 strongTraderNetPositionRatio ===');
    console.log('最小值:', ratios[0]);
    console.log('最大值:', ratios[ratios.length - 1]);
    console.log('平均值:', (ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(2));

    const thresholds = [0, 1, 2, 3, 4, 5, 10];
    console.log('\n分布:');
    thresholds.forEach(th => {
      const count = ratios.filter(r => r >= th).length;
      console.log(`  >= ${th}%: ${count} 个`);
    });
  }

  if (notExecuted.length > 0) {
    const ratios = notExecuted.map(s => s.ratio);
    ratios.sort((a, b) => a - b);
    console.log('\n=== 未执行信号的 strongTraderNetPositionRatio ===');
    console.log('最小值:', ratios[0]);
    console.log('最大值:', ratios[ratios.length - 1]);
    console.log('平均值:', (ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(2));

    const thresholds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20];
    console.log('\n分布:');
    thresholds.forEach(th => {
      const count = ratios.filter(r => r >= th).length;
      console.log(`  >= ${th}%: ${count} 个`);
    });

    // 分析如果阈值不同，会多买入多少
    console.log('\n=== 阈值影响分析 ===');
    console.log('当前阈值: < 5% (条件是 strongTraderNetPositionRatio < 5 才执行)');
    const currentFiltered = notExecuted.filter(s => s.ratio >= 5);
    console.log(`被阈值 5% 过滤: ${currentFiltered.length} 个`);

    const alternativeThresholds = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 15];
    console.log('\n如果使用其他阈值:');
    alternativeThresholds.forEach(th => {
      const filtered = notExecuted.filter(s => s.ratio >= th);
      const additionalBuy = notExecuted.filter(s => s.ratio >= 5 && s.ratio < th).length;
      const totalBuy = executed.length + (notExecuted.length - filtered.length);
      console.log(`  阈值 < ${th}%: 过滤 ${filtered.length} 个, 总买入 ${totalBuy} 个 (比阈值5% ${additionalBuy >= 0 ? '+' : ''}${additionalBuy})`);
    });

    // 显示被 5% 过滤的代币
    if (currentFiltered.length > 0) {
      console.log('\n=== 被 5% 阈值过滤的代币 (ratio >= 5) ===');
      currentFiltered.sort((a, b) => b.ratio - a.ratio);
      currentFiltered.forEach(s => {
        console.log(`  ${s.token_symbol}: ${s.ratio.toFixed(2)}%`);
      });
    }
  }
}

analyzeStrongTraderDistribution().catch(console.error);
