require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  console.log('检查源实验 0c616581 的原始数据分布...\n');

  // 1. 获取所有不同的 loop_count 值
  const PAGE_SIZE = 100;
  let allLoops = [];
  let page = 0;
  let hasMore = true;

  while (hasMore && page < 200) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from('experiment_time_series_data')
      .select('loop_count')
      .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
      .order('loop_count', { ascending: true })
      .range(from, to);

    if (error) {
      console.log('Error:', error.message);
      break;
    }

    if (data && data.length > 0) {
      allLoops = allLoops.concat(data.map(d => d.loop_count));
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }

    page++;
  }

  console.log('总计获取:', allLoops.length, '条数据');

  if (allLoops.length > 0) {
    const uniqueLoops = [...new Set(allLoops)].sort((a, b) => a - b);
    console.log('不同的 loop 值数量:', uniqueLoops.length);
    console.log('loop 范围:', Math.min(...uniqueLoops), '-', Math.max(...uniqueLoops));
    console.log('\n前20个 loop 值:', uniqueLoops.slice(0, 20).join(', '));
    console.log('后20个 loop 值:', uniqueLoops.slice(-20).join(', '));

    // 检查数据分布
    const loopCounts = {};
    allLoops.forEach(loop => {
      loopCounts[loop] = (loopCounts[loop] || 0) + 1;
    });

    console.log('\n每个 loop 的数据点数分布:');
    const sortedLoopKeys = Object.keys(loopCounts).map(Number).sort((a, b) => a - b);
    sortedLoopKeys.forEach(loop => {
      console.log(`  loop ${loop}: ${loopCounts[loop]} 个数据点`);
    });

    // 分析问题
    console.log('\n=== 问题分析 ===');
    if (uniqueLoops.length < 100) {
      console.log(`只有 ${uniqueLoops.length} 个不同的 loop 值`);
      console.log('这说明回测引擎确实只处理了这么多个轮次');
      console.log('需要检查为什么源实验只有这么少的数据');
    } else {
      console.log(`源实验有 ${uniqueLoops.length} 个不同的 loop 值`);
      console.log('如果回测只处理了 83 轮，说明有其他问题导致提前退出');
    }

    // 检查 loop 1166 是否存在
    const has1166 = uniqueLoops.includes(1166);
    console.log('\n包含 loop 1166:', has1166);
    if (has1166) {
      console.log(`  loop 1166 有 ${loopCounts[1166]} 个数据点`);
    }
  }

  // 2. 检查实验的基本信息
  const { data: expData } = await supabase
    .from('experiments')
    .select('id, status, started_at, completed_at, created_at')
    .eq('id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .single();

  if (expData) {
    console.log('\n=== 源实验信息 ===');
    console.log('ID:', expData.id);
    console.log('状态:', expData.status);
    console.log('创建时间:', expData.created_at);
    console.log('开始时间:', expData.started_at);
    console.log('完成时间:', expData.completed_at);
  }
})();
