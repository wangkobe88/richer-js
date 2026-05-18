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
 * 检测孤儿数据 — 使用 not.in 过滤让数据库端筛选，避免全表扫描
 */
async function detectOrphanData() {
  console.log('🔍 开始检测孤儿数据...\n');

  const supabase = dbManager.getClient();

  // 步骤1: 获取所有有效的 experiment_id
  console.log('📊 步骤1: 获取所有有效的 experiment_id...');
  const { data: expData, error: expError } = await queryWithRetry(
    async () => await supabase
      .from('experiments')
      .select('id'),
    '获取 experiments'
  );
  if (expError) {
    console.error('❌ 获取 experiments 失败:', expError.message);
    throw expError;
  }
  const validIds = expData.map(e => e.id);
  console.log(`✅ 有效实验数量: ${validIds.length}\n`);

  // 步骤2: 用 planned count 获取近似总数（exact count 在大表上会超时）
  console.log('📊 步骤2: 获取时序数据总数...');
  const { count: totalCount, error: totalError } = await queryWithRetry(
    async () => await supabase
      .from('experiment_time_series_data')
      .select('*', { count: 'planned', head: true }),
    '获取时序数据总数'
  );
  if (totalError) {
    console.error('❌ 获取总数失败:', totalError.message);
    throw totalError;
  }
  console.log(`✅ 时序数据总数（近似）: ${totalCount}\n`);

  // 步骤3: 统计每个有效实验的记录数，同时收集孤儿 ID
  console.log('📊 步骤3: 统计有效实验记录数...');
  let validTotal = 0;
  for (const id of validIds) {
    const { count, error } = await queryWithRetry(
      async () => await supabase
        .from('experiment_time_series_data')
        .select('*', { count: 'exact', head: true })
        .eq('experiment_id', id),
      `统计有效实验 ${id.substring(0, 8)}...`,
      2
    );
    if (!error && count > 0) {
      console.log(`   ✓ 有效 ${id.substring(0, 8)}... : ${count} 条`);
      validTotal += count;
    }
  }
  const approxOrphanTotal = totalCount - validTotal;
  console.log(`\n✅ 有效数据: ${validTotal} 条，孤儿数据（近似）: ${approxOrphanTotal} 条\n`);

  if (approxOrphanTotal <= 0) {
    console.log('🎉 没有发现孤儿数据！');
    return { orphanExperimentIds: [], orphanRecordCount: 0, details: [] };
  }

  // 步骤4: 分页扫描收集所有唯一的 experiment_id（只取 experiment_id 列）
  console.log('📊 步骤骤4: 扫描唯一 experiment_id...');
  const validIdSet = new Set(validIds);
  const orphanExperimentIds = new Set();
  let offset = 0;
  const pageSize = 10000;
  let hasMore = true;
  let lastNewAt = 0;

  while (hasMore) {
    const { data, error } = await queryWithRetry(
      async () => await supabase
        .from('experiment_time_series_data')
        .select('experiment_id')
        .range(offset, offset + pageSize - 1),
      '扫描 experiment_id'
    );
    if (error) {
      console.error('❌ 扫描失败:', error.message);
      throw error;
    }
    if (data && data.length > 0) {
      const prevSize = orphanExperimentIds.size;
      for (const r of data) {
        if (!validIdSet.has(r.experiment_id)) {
          orphanExperimentIds.add(r.experiment_id);
        }
      }
      if (orphanExperimentIds.size > prevSize) lastNewAt = offset;
      offset += pageSize;
      hasMore = data.length === pageSize;

      if (offset % 100000 === 0) {
        console.log(`   已扫描 ${offset} 条，发现 ${orphanExperimentIds.size} 个孤儿实验...`);
      }

      // 如果连续 50 万条都没发现新的孤儿 ID，提前停止
      if (offset - lastNewAt > 500000) {
        console.log(`   连续 50 万条无新孤儿 ID，提前停止扫描`);
        hasMore = false;
      }
    } else {
      hasMore = false;
    }
  }

  const orphanIds = Array.from(orphanExperimentIds);
  console.log(`✅ 发现孤儿实验: ${orphanIds.length} 个\n`);

  // 步骤5: 统计每个孤儿实验的记录数
  console.log('📊 步骤5: 统计每个孤儿实验的记录数...');
  const details = [];
  for (const expId of orphanIds) {
    let count = null;
    // 先尝试精确计数
    const { count: exactCount, error } = await queryWithRetry(
      async () => await supabase
        .from('experiment_time_series_data')
        .select('*', { count: 'exact', head: true })
        .eq('experiment_id', expId),
      `统计孤儿实验 ${expId.substring(0, 8)}... (exact)`,
      1
    );
    if (!error && exactCount !== null) {
      count = exactCount;
    } else {
      // 精确计数超时，改用 planned count
      const { count: plannedCount, error: e2 } = await queryWithRetry(
        async () => await supabase
          .from('experiment_time_series_data')
          .select('*', { count: 'planned', head: true })
          .eq('experiment_id', expId),
        `统计孤儿实验 ${expId.substring(0, 8)}... (planned)`,
        2
      );
      if (!e2 && plannedCount !== null) {
        count = plannedCount;
        console.log(`   ⚠️  精确计数超时，使用近似值`);
      }
    }
    if (count !== null) {
      details.push({ experimentId: expId, recordCount: count });
      console.log(`   ✓ ${expId.substring(0, 8)}... : ~${count} 条`);
    } else {
      console.warn(`   ⚠️  统计 ${expId.substring(0, 8)}... 失败`);
    }
  }

  details.sort((a, b) => b.recordCount - a.recordCount);
  const orphanRecordCount = details.reduce((sum, d) => sum + d.recordCount, 0);

  return {
    orphanExperimentIds: orphanIds,
    orphanRecordCount,
    details
  };
}

/**
 * 删除孤儿数据 — 先尝试直接按 experiment_id 删除，超时则按 id 范围分批
 */
async function deleteOrphanData(orphanExperimentIds) {
  console.log('\n🗑️  开始删除孤儿数据...\n');

  const supabase = dbManager.getClient();
  let totalExperimentsDeleted = 0;
  let failedCount = 0;
  const failedList = [];

  for (let i = 0; i < orphanExperimentIds.length; i++) {
    const expId = orphanExperimentIds[i];
    const shortId = expId.substring(0, 8) + '...';

    console.log(`\n[${i + 1}/${orphanExperimentIds.length}] 删除实验 ${shortId} 的数据...`);

    try {
      // 策略1: 直接按 experiment_id 删除全部（单条 SQL，最快）
      console.log(`   尝试直接删除...`);
      const { error: deleteError } = await queryWithRetry(
        async () => await supabase
          .from('experiment_time_series_data')
          .delete()
          .eq('experiment_id', expId),
        `直接删除 ${shortId}`,
        2
      );

      if (deleteError) {
        // 直接删除超时，改用 id 范围分批删除
        console.log(`   直接删除失败 (${deleteError.message || '超时'})，改用 id 范围分批删除...`);
        await deleteByRange(supabase, expId, shortId);
      }

      totalExperimentsDeleted++;
      console.log(`   ✅ 实验 ${shortId} 的数据已删除`);
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
 * 按 id 范围分批删除（兜底策略）
 */
async function deleteByRange(supabase, expId, shortId) {
  const BATCH_SIZE = 10000;
  let totalDeleted = 0;

  while (true) {
    // 查出一小批 id
    const { data: rows, error: selectError } = await supabase
      .from('experiment_time_series_data')
      .select('id')
      .eq('experiment_id', expId)
      .limit(BATCH_SIZE);

    if (selectError) throw selectError;
    if (!rows || rows.length === 0) break;

    const ids = rows.map(r => r.id);

    const { error: deleteError } = await supabase
      .from('experiment_time_series_data')
      .delete()
      .in('id', ids);

    if (deleteError) throw deleteError;

    totalDeleted += ids.length;
    console.log(`   已删除 ${totalDeleted} 条...`);

    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`   累计删除 ${totalDeleted} 条`);
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
