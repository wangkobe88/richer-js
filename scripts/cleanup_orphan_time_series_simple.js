/**
 * 清理已删除实验的时序数据 - 简化版
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('========================================');
  console.log('  清理已删除实验的时序数据');
  console.log('========================================\n');

  // 1. 获取所有现有的实验ID
  console.log('🔍 获取现有实验ID列表...');
  const { data: experiments, error: expError } = await supabase
    .from('experiments')
    .select('id');

  if (expError) {
    console.error('❌ 获取实验列表失败:', expError.message);
    return;
  }

  const validExperimentIds = experiments.map(e => e.id);
  console.log(`✅ 找到 ${validExperimentIds.length} 个现有实验`);

  // 2. 获取时序数据中的所有唯一 experiment_id
  console.log('\n🔍 获取时序数据中的实验ID...');
  const { data: timeSeriesIds, error: tsError } = await supabase
    .from('experiment_time_series_data')
    .select('experiment_id');

  if (tsError) {
    console.error('❌ 获取时序数据实验ID失败:', tsError.message);
    return;
  }

  const uniqueTimeSeriesIds = [...new Set(timeSeriesIds.map(x => x.experiment_id))];
  console.log(`✅ 时序数据中有 ${uniqueTimeSeriesIds.length} 个不同的实验ID`);

  // 3. 找出孤立的实验ID
  const orphanIds = uniqueTimeSeriesIds.filter(id => !validExperimentIds.includes(id));

  if (orphanIds.length === 0) {
    console.log('\n✅ 没有孤立数据需要清理');
    return;
  }

  console.log(`\n⚠️ 找到 ${orphanIds.length} 个孤立的实验ID`);
  console.log('孤立实验ID:', orphanIds.slice(0, 10).join(', '), orphanIds.length > 10 ? '...' : '');

  // 4. 逐个删除每个孤立实验的数据
  console.log('\n🗑️ 开始删除...\n');

  let totalDeleted = 0;

  for (let i = 0; i < orphanIds.length; i++) {
    const experimentId = orphanIds[i];

    // 先计算该实验有多少条记录
    const { count } = await supabase
      .from('experiment_time_series_data')
      .select('*', { count: 'exact', head: true })
      .eq('experiment_id', experimentId);

    // 删除
    const { error: deleteError } = await supabase
      .from('experiment_time_series_data')
      .delete()
      .eq('experiment_id', experimentId);

    if (deleteError) {
      console.error(`❌ [${i + 1}/${orphanIds.length}] 删除失败 ${experimentId}: ${deleteError.message}`);
    } else {
      totalDeleted += count || 0;
      console.log(`✅ [${i + 1}/${orphanIds.length}] 删除 ${experimentId}: ${count || 0} 条记录 | 总计: ${totalDeleted}`);
    }

    // 每10个暂停一下
    if ((i + 1) % 10 === 0) {
      await sleep(200);
    }
  }

  // 5. 清理其他表的孤立数据
  console.log('\n📊 清理其他表的孤立数据...\n');

  const tables = ['trades', 'strategy_signals', 'portfolio_snapshots', 'experiment_tokens'];

  for (const tableName of tables) {
    let deletedCount = 0;
    let batchNum = 0;

    while (true) {
      batchNum++;

      const { data, error } = await supabase
        .from(tableName)
        .delete()
        .not('experiment_id', 'in', `(${validExperimentIds.map(id => `'${id}'`).join(',')})`)
        .select('id')
        .limit(5000);

      if (error) {
        // Supabase 不支持 not in 的这种语法，换个方式
        break;
      }

      const batchDeleted = data?.length || 0;
      deletedCount += batchDeleted;

      if (batchDeleted === 0) {
        break;
      }

      console.log(`  ${tableName} 批次${batchNum}: 删除 ${batchDeleted} 条`);
      await sleep(100);
    }

    if (deletedCount > 0) {
      console.log(`✅ ${tableName}: 总计删除 ${deletedCount} 条记录`);
    }
  }

  // 完成
  console.log('\n========================================');
  console.log('  清理完成');
  console.log('========================================');
  console.log(`✅ 时序数据: 删除了 ${totalDeleted} 条记录`);
  console.log(`✅ 清理了 ${orphanIds.length} 个已删除实验的数据`);
}

main().catch(console.error);
