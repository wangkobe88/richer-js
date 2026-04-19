/**
 * 检测和清理 experiment_time_series_data 表中的孤儿数据
 *
 * 孤儿数据定义：experiment_id 在 experiments 表中不存在的时序数据记录
 *
 * 使用方法：
 *   node scripts/clean_orphan_time_series_data.js --check    # 仅检测，不删除
 *   node scripts/clean_orphan_time_series_data.js --clean    # 检测并删除
 *   node scripts/clean_orphan_time_series_data.js --stats    # 显示统计信息
 */

require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const { dbManager } = require('../src/services/dbManager');

/**
 * 带重试的查询
 */
async function queryWithRetry(queryFn, operation, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt) throw error;

      console.warn(`⚠️  ${operation} 失败 (尝试 ${attempt}/${maxRetries}): ${error.message}`);
      console.log(`   等待 3 秒后重试...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

/**
 * 检测孤儿数据（使用 SQL 查询优化）
 */
async function detectOrphanData() {
  console.log('🔍 开始检测孤儿数据...\n');

  const supabase = dbManager.getClient();

  // 步骤1: 获取 experiments 表中所有的 experiment_id
  console.log('📊 步骤1: 获取所有有效的 experiment_id...');
  let validExperimentIds = new Set();
  let offset = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const result = await queryWithRetry(
      async () => await supabase
        .from('experiments')
        .select('id')
        .range(offset, offset + pageSize - 1),
      '获取 experiments'
    );

    const { data, error } = result;
    if (error) {
      console.error('❌ 获取 experiments 失败:', error.message);
      throw error;
    }

    if (data && data.length > 0) {
      data.forEach(exp => validExperimentIds.add(exp.id));
      offset += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  console.log(`✅ 有效实验数量: ${validExperimentIds.size}\n`);

  // 步骤2: 使用 RPC 或 SQL 获取时序数据中的唯一 experiment_id
  // 由于数据量大，直接使用 SQL 查询会更快
  console.log('📊 步骤2: 扫描时序数据中的唯一 experiment_id...');

  // 方法：使用带 distinct 的查询，只获取 experiment_id
  const allTimeSeriesExperiments = new Set();
  hasMore = true;
  offset = 0;

  while (hasMore) {
    // 使用更大的页面大小来加速获取唯一值
    const result = await queryWithRetry(
      async () => await supabase
        .from('experiment_time_series_data')
        .select('experiment_id')
        .range(offset, offset + pageSize - 1),
      '获取时序数据 experiment_id'
    );

    const { data, error } = result;
    if (error) {
      console.error('❌ 获取时序数据失败:', error.message);
      throw error;
    }

    if (data && data.length > 0) {
      for (const record of data) {
        allTimeSeriesExperiments.add(record.experiment_id);
      }
      offset += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }

    // 每处理 10000 条记录显示一次进度
    if (offset % 10000 === 0 && allTimeSeriesExperiments.size > 0) {
      console.log(`   已扫描 ${offset} 条记录，发现 ${allTimeSeriesExperiments.size} 个唯一实验...`);
    }
  }

  console.log(`✅ 时序数据中发现的实验数量: ${allTimeSeriesExperiments.size}\n`);

  // 步骤3: 找出孤儿 experiment_id
  console.log('📊 步骤3: 识别孤儿实验...');
  const orphanExperimentIds = Array.from(allTimeSeriesExperiments).filter(
    expId => !validExperimentIds.has(expId)
  );

  console.log(`✅ 发现孤儿实验数量: ${orphanExperimentIds.size}\n`);

  if (orphanExperimentIds.length === 0) {
    console.log('🎉 没有发现孤儿数据！');
    return {
      orphanExperimentIds: [],
      orphanRecordCount: 0,
      details: []
    };
  }

  // 步骤4: 统计每个孤儿实验的记录数
  console.log('📊 步骤4: 统计孤儿数据记录数...');
  const orphanDataCounts = new Map();

  for (const expId of orphanExperimentIds) {
    // 使用 count 查询
    const result = await queryWithRetry(
      async () => await supabase
        .from('experiment_time_series_data')
        .select('*', { count: 'exact', head: true })
        .eq('experiment_id', expId),
      `统计实验 ${expId.substring(0, 8)}... 的记录数`,
      2
    );

    const { count, error } = result;
    if (error) {
      console.warn(`   ⚠️  统计实验 ${expId.substring(0, 8)}... 失败: ${error.message}`);
      orphanDataCounts.set(expId, -1);
    } else {
      orphanDataCounts.set(expId, count);
      console.log(`   ✓ 实验 ${expId.substring(0, 8)}... : ${count} 条记录`);
    }
  }

  // 计算总记录数
  let totalOrphanRecords = 0;
  const details = [];

  for (const [expId, count] of orphanDataCounts.entries()) {
    if (count > 0) {
      totalOrphanRecords += count;
      details.push({
        experimentId: expId,
        recordCount: count
      });
    }
  }

  // 按记录数排序
  details.sort((a, b) => b.recordCount - a.recordCount);

  return {
    orphanExperimentIds,
    orphanRecordCount: totalOrphanRecords,
    details
  };
}

/**
 * 使用原生 SQL 删除孤儿数据（服务器端执行，避免多次往返超时）
 */
async function deleteOrphanData(orphanExperimentIds) {
  console.log('\n🗑️  开始删除孤儿数据...\n');
  console.log('💡 使用分批删除（每批 500 条），避免超时\n');

  const supabase = dbManager.getClient();
  const BATCH_SIZE = 500;
  let totalExperimentsDeleted = 0;
  let failedCount = 0;
  const failedList = [];

  // 逐个删除孤儿实验的数据
  for (let i = 0; i < orphanExperimentIds.length; i++) {
    const expId = orphanExperimentIds[i];
    const shortId = expId.substring(0, 8) + '...';

    console.log(`\n[${i + 1}/${orphanExperimentIds.length}] 删除实验 ${shortId} 的数据...`);

    try {
      let batchNum = 0;
      let totalDeletedForExp = 0;

      while (true) {
        batchNum++;
        // 先查出一批记录的 id
        const { data: rows, error: selectError } = await queryWithRetry(
          async () => await supabase
            .from('experiment_time_series_data')
            .select('id')
            .eq('experiment_id', expId)
            .limit(BATCH_SIZE),
          `查询实验 ${shortId} 第 ${batchNum} 批`
        );

        if (selectError) throw selectError;
        if (!rows || rows.length === 0) break;

        const ids = rows.map(r => r.id);

        // 按 id 批量删除
        const { error: deleteError } = await queryWithRetry(
          async () => await supabase
            .from('experiment_time_series_data')
            .delete()
            .in('id', ids),
          `删除实验 ${shortId} 第 ${batchNum} 批`
        );

        if (deleteError) throw deleteError;

        totalDeletedForExp += ids.length;
        console.log(`   第 ${batchNum} 批: 删除 ${ids.length} 条，累计 ${totalDeletedForExp} 条`);
      }

      totalExperimentsDeleted++;
      console.log(`   ✅ 实验 ${shortId} 的数据已全部删除 (共 ${totalDeletedForExp} 条)`);
    } catch (err) {
      console.error(`   ❌ 删除失败: ${err.message}`);
      failedCount++;
      failedList.push(expId);
    }
  }

  return {
    totalDeleted: totalExperimentsDeleted,
    failedCount,
    failedList
  };
}

/**
 * 显示详细统计信息
 */
async function showStats() {
  console.log('📊 获取数据统计信息...\n');

  const supabase = dbManager.getClient();

  // 统计总记录数
  try {
    const result = await queryWithRetry(
      async () => await supabase
        .from('experiment_time_series_data')
        .select('*', { count: 'exact', head: true }),
      '获取总记录数'
    );
    const { count: totalRecords, error: totalError } = result;
    if (totalError) {
      console.error('❌ 获取总记录数失败:', totalError.message);
    } else {
      console.log(`📊 时序数据总记录数: ${totalRecords}`);
    }
  } catch (e) {
    console.error('❌ 获取总记录数失败:', e.message);
  }

  // 统计唯一实验数
  try {
    const result = await queryWithRetry(
      async () => await supabase
        .from('experiment_time_series_data')
        .select('experiment_id'),
      '获取实验列表'
    );
    const { data: expData, error: expError } = result;
    if (expError) {
      console.error('❌ 获取实验列表失败:', expError.message);
    } else {
      const uniqueExps = new Set(expData?.map(d => d.experiment_id) || []);
      console.log(`📊 时序数据中唯一实验数: ${uniqueExps.size}`);
    }
  } catch (e) {
    console.error('❌ 获取实验列表失败:', e.message);
  }

  // 统计有效实验数
  try {
    const result = await queryWithRetry(
      async () => await supabase
        .from('experiments')
        .select('*', { count: 'exact', head: true }),
      '获取有效实验数'
    );
    const { count: validExps, error: validError } = result;
    if (validError) {
      console.error('❌ 获取有效实验数失败:', validError.message);
    } else {
      console.log(`📊 experiments 表中的实验数: ${validExps}`);
    }
  } catch (e) {
    console.error('❌ 获取有效实验数失败:', e.message);
  }

  console.log('');
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--check';

  // 增加超时时间到 180 秒（3分钟）
  dbManager.setTimeout(180000);

  try {
    console.log('═══════════════════════════════════════════════════════');
    console.log(' 孤儿时序数据检测和清理工具');
    console.log('═══════════════════════════════════════════════════════\n');

    if (mode === '--stats') {
      await showStats();
      return;
    }

    // 检测孤儿数据
    const result = await detectOrphanData();

    // 显示检测结果
    console.log('═══════════════════════════════════════════════════════');
    console.log(' 检测结果');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log(`孤儿实验数量: ${result.orphanExperimentIds.length}`);
    console.log(`孤儿数据记录总数: ${result.orphanRecordCount}`);

    if (result.details.length > 0) {
      console.log('\n详细列表 (按记录数排序):');
      console.log('─────────────────────────────────────────────────────────');
      console.log('序号 | 实验 ID | 记录数');
      console.log('─────────────────────────────────────────────────────────');

      result.details.forEach((detail, index) => {
        const shortId = detail.experimentId.substring(0, 8) + '...';
        console.log(`${(index + 1).toString().padStart(4)} | ${shortId.padEnd(37)} | ${detail.recordCount}`);
      });
      console.log('─────────────────────────────────────────────────────────');
    }

    if (mode === '--clean') {
      if (result.orphanExperimentIds.length === 0) {
        console.log('\n🎉 没有需要删除的孤儿数据！');
        return;
      }

      // 确认删除
      console.log(`\n⚠️  即将删除 ${result.orphanExperimentIds.length} 个孤儿实验的 ${result.orphanRecordCount} 条记录`);
      console.log('这些数据将无法恢复！');
      console.log('请在 5 秒内按 Ctrl+C 取消...\n');

      await new Promise(resolve => setTimeout(resolve, 5000));

      // 执行删除
      const deleteResult = await deleteOrphanData(result.orphanExperimentIds);

      console.log('\n═══════════════════════════════════════════════════════');
      console.log(' 删除结果');
      console.log('═══════════════════════════════════════════════════════\n');
      console.log(`已删除孤儿实验数: ${deleteResult.totalDeleted}`);
      if (deleteResult.failedCount > 0) {
        console.log(`删除失败: ${deleteResult.failedCount}`);
      }
      console.log('\n✅ 清理完成！');
    } else {
      console.log('\n💡 提示: 使用 --clean 参数执行删除操作');
    }

  } catch (error) {
    console.error('\n❌ 执行失败:', error.message);
    process.exit(1);
  } finally {
    dbManager.cleanup();
  }
}

// 运行
main();
