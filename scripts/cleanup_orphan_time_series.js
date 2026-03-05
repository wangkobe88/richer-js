/**
 * 清理已删除实验的时序数据
 * 分批删除，避免超时
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const BATCH_SIZE = 5000; // 每批删除 5000 条

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getOrphanExperimentIds() {
  console.log('🔍 查找孤立的实验ID...');

  const { data, error } = await supabase
    .rpc('get_orphan_experiment_ids', {
      max_results: 1000
    });

  if (error) {
    // 如果 RPC 不存在，使用直接查询
    const { data: ids, error: err } = await supabase
      .from('experiment_time_series_data')
      .select('experiment_id')
      .not('experiment_id', 'in', '(select id from experiments)');

    if (err) {
      console.error('❌ 查询失败:', err.message);
      return [];
    }

    // 去重
    const uniqueIds = [...new Set(ids.map(x => x.experiment_id))];
    return uniqueIds;
  }

  return data || [];
}

async function countOrphanRecords() {
  const { count, error } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .not('experiment_id', 'in', '(select id from experiments)');

  if (error) {
    console.error('❌ 计数失败:', error.message);
    return 0;
  }

  return count || 0;
}

async function deleteBatchByExperimentId() {
  console.log('\n📊 方式1: 按 experiment_id 逐个删除\n');

  // 先获取所有孤立的实验ID
  console.log('🔍 查找孤立的实验ID...');

  const { data: orphanIds, error } = await supabase
    .from('experiment_time_series_data')
    .select('experiment_id')
    .not('experiment_id', 'in', '(select id from experiments)');

  if (error) {
    console.error('❌ 查询失败:', error.message);
    return 0;
  }

  // 去重
  const uniqueIds = [...new Set(orphanIds.map(x => x.experiment_id))];
  console.log(`找到 ${uniqueIds.length} 个孤立的实验`);

  let totalDeleted = 0;

  for (let i = 0; i < uniqueIds.length; i++) {
    const experimentId = uniqueIds[i];

    // 计算该实验的记录数
    const { count } = await supabase
      .from('experiment_time_series_data')
      .select('*', { count: 'exact', head: true })
      .eq('experiment_id', experimentId);

    // 删除该实验的所有数据
    const { error: deleteError } = await supabase
      .from('experiment_time_series_data')
      .delete()
      .eq('experiment_id', experimentId);

    if (deleteError) {
      console.error(`❌ 删除失败 [${i + 1}/${uniqueIds.length}] ${experimentId}: ${deleteError.message}`);
    } else {
      totalDeleted += count || 0;
      console.log(`✅ [${i + 1}/${uniqueIds.length}] 删除 ${experimentId}: ${count || 0} 条记录`);
    }

    // 每10个实验暂停一下
    if ((i + 1) % 10 === 0) {
      await sleep(500);
    }
  }

  return totalDeleted;
}

async function deleteBatchFixedSize() {
  console.log('\n📊 方式2: 分批删除（固定批次大小）\n');

  let totalDeleted = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;

    // 先检查还有多少孤立记录
    const remainingCount = await countOrphanRecords();

    if (remainingCount === 0) {
      console.log('\n✅ 所有孤立数据已清理完成！');
      break;
    }

    console.log(`\n批次 #${batchNum}: 剩余 ${remainingCount} 条记录`);

    // 删除一批
    const { data, error } = await supabase
      .from('experiment_time_series_data')
      .delete()
      .not('experiment_id', 'in', '(select id from experiments)')
      .select('id')
      .limit(BATCH_SIZE);

    if (error) {
      console.error(`❌ 批次 #${batchNum} 删除失败:`, error.message);
      // 尝试用更小的批次
      if (BATCH_SIZE > 1000) {
        console.log('⚠️ 尝试使用更小的批次...');
        const { data: retryData, error: retryError } = await supabase
          .from('experiment_time_series_data')
          .delete()
          .not('experiment_id', 'in', '(select id from experiments)')
          .select('id')
          .limit(1000);

        if (retryError) {
          console.error('❌ 重试也失败:', retryError.message);
          break;
        }
        totalDeleted += retryData?.length || 0;
        console.log(`✅ 删除了 ${retryData?.length || 0} 条记录`);
      } else {
        break;
      }
    } else {
      const deleted = data?.length || 0;
      totalDeleted += deleted;
      console.log(`✅ 批次 #${batchNum}: 删除了 ${deleted} 条记录`);
    }

    // 暂停避免过载
    await sleep(300);
  }

  return totalDeleted;
}

async function cleanOtherOrphanTables() {
  console.log('\n📊 清理其他表的孤立数据\n');

  const tables = [
    { name: 'trades', id: 'id' },
    { name: 'strategy_signals', id: 'id' },
    { name: 'portfolio_snapshots', id: 'id' },
    { name: 'experiment_tokens', id: 'id' }
  ];

  for (const table of tables) {
    console.log(`\n清理 ${table.name}...`);

    let totalDeleted = 0;

    while (true) {
      const { data, error } = await supabase
        .from(table.name)
        .delete()
        .not('experiment_id', 'in', '(select id from experiments)')
        .select(table.id)
        .limit(1000);

      if (error) {
        console.error(`❌ 清理 ${table.name} 失败:`, error.message);
        break;
      }

      const deleted = data?.length || 0;
      totalDeleted += deleted;

      if (deleted === 0) {
        break;
      }

      console.log(`  删除了 ${deleted} 条记录`);
      await sleep(100);
    }

    console.log(`✅ ${table.name}: 总计删除 ${totalDeleted} 条记录`);
  }
}

async function main() {
  console.log('========================================');
  console.log('  清理已删除实验的时序数据');
  console.log('========================================\n');

  // 先统计
  const orphanCount = await countOrphanRecords();
  console.log(`📊 孤立时序数据记录总数: ${orphanCount}\n`);

  if (orphanCount === 0) {
    console.log('✅ 没有孤立数据需要清理');
    return;
  }

  // 使用方式1：按实验ID删除（更高效）
  console.log('使用方式1：按 experiment_id 逐个删除');
  const deleted1 = await deleteBatchByExperimentId();

  // 检查是否还有剩余
  const remaining = await countOrphanRecords();
  if (remaining > 0) {
    console.log(`\n⚠️ 方式1完成后还有 ${remaining} 条记录`);
    console.log('使用方式2继续清理...');
    const deleted2 = await deleteBatchFixedSize();
    console.log(`\n方式2删除了 ${deleted2} 条记录`);
  }

  // 清理其他表
  await cleanOtherOrphanTables();

  // 最终统计
  console.log('\n========================================');
  console.log('  清理完成');
  console.log('========================================');
  console.log(`✅ 时序数据: 总计删除 ${deleted1} 条记录`);
}

main().catch(console.error);
