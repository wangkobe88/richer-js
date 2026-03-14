/**
 * 清理孤立的 token_holders 数据
 *
 * 此脚本会删除 token_holders 表中所有引用已删除实验的数据
 * 即：token_holders.experiment_id 不在 experiments 表中的记录
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

// 从环境变量加载配置
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ 错误: 缺少 Supabase 配置');
  console.error('请确保 config/.env 文件中包含 SUPABASE_URL 和 SUPABASE_ANON_KEY');
  process.exit(1);
}

// 创建 Supabase 客户端
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * 获取所有 token_holders 记录（分页获取）
 */
async function getAllTokenHolders() {
  console.log('📊 获取所有 token_holders 记录...');

  const PAGE_SIZE = 1000;
  let allRecords = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from('token_holders')
      .select('id, experiment_id, token_address, created_at')
      .range(from, to)
      .order('id', { ascending: true });

    if (error) {
      console.error(`❌ 获取第 ${page + 1} 页数据失败:`, error.message);
      throw error;
    }

    if (data && data.length > 0) {
      allRecords.push(...data);
      console.log(`   已获取 ${allRecords.length} 条记录...`);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }

  console.log(`✅ 共获取 ${allRecords.length} 条 token_holders 记录\n`);
  return allRecords;
}

/**
 * 获取所有有效的实验 ID
 */
async function getValidExperimentIds() {
  console.log('📊 获取所有有效的实验 ID...');

  const { data, error } = await supabase
    .from('experiments')
    .select('id');

  if (error) throw error;

  console.log(`✅ 找到 ${data.length} 个有效实验\n`);
  return new Set(data.map(e => e.id));
}

/**
 * 主清理函数
 */
async function cleanupOrphanedTokenHolders() {
  console.log('🔍 开始清理孤立的 token_holders 数据...\n');

  try {
    // Step 1: 获取所有有效的 experiment_id
    const validExperimentIds = await getValidExperimentIds();

    // Step 2: 获取所有 token_holders 记录
    const allHolders = await getAllTokenHolders();

    // Step 3: 找出孤立的记录（experiment_id 不在有效实验列表中）
    console.log('📊 识别孤立记录...');
    const orphanedRecords = [];

    for (const holder of allHolders) {
      // 跳过没有 experiment_id 的记录（这些可能是其他来源的）
      if (!holder.experiment_id || holder.experiment_id === 'null' || holder.experiment_id === '') {
        continue;
      }

      // 检查 experiment_id 是否有效
      if (!validExperimentIds.has(holder.experiment_id)) {
        orphanedRecords.push(holder);
      }
    }

    console.log(`✅ 找到 ${orphanedRecords.length} 条孤立记录\n`);

    if (orphanedRecords.length === 0) {
      console.log('🎉 没有需要清理的孤立数据！');
      return;
    }

    // 显示前几条孤立记录作为示例
    console.log('📋 孤立记录示例 (最多显示 5 条):');
    orphanedRecords.slice(0, 5).forEach((record, idx) => {
      console.log(`   ${idx + 1}. ID: ${record.id}`);
      console.log(`      Token: ${record.token_address}`);
      console.log(`      实验 ID: ${record.experiment_id}`);
      console.log(`      创建时间: ${record.created_at}`);
    });

    if (orphanedRecords.length > 5) {
      console.log(`   ... 还有 ${orphanedRecords.length - 5} 条记录`);
    }
    console.log('');

    // Step 4: 删除孤立记录
    console.log('📊 删除孤立记录...');
    console.log('⚠️  即将删除数据，按 Ctrl+C 取消...');
    console.log('⏳ 3 秒后开始删除...');

    await new Promise(resolve => setTimeout(resolve, 3000));

    // 按 experiment_id 分组后批量删除（更高效且更可靠）
    const orphanedByExperiment = new Map();
    for (const holder of orphanedRecords) {
      const current = orphanedByExperiment.get(holder.experiment_id) || [];
      current.push(holder.id);
      orphanedByExperiment.set(holder.experiment_id, current);
    }

    let deletedCount = 0;
    let errorCount = 0;
    let batchNum = 1;

    for (const [experimentId, holderIds] of orphanedByExperiment) {
      const shortId = experimentId.length > 12
        ? `${experimentId.substring(0, 8)}...${experimentId.substring(experimentId.length - 4)}`
        : experimentId;

      // 每个实验的记录可能很多，分批删除
      const ID_BATCH_SIZE = 100;
      for (let i = 0; i < holderIds.length; i += ID_BATCH_SIZE) {
        const batchIds = holderIds.slice(i, i + ID_BATCH_SIZE);

        const { error: deleteError } = await supabase
          .from('token_holders')
          .delete()
          .in('id', batchIds);

        if (deleteError) {
          console.error(`❌ 批次 ${batchNum} (${shortId}) 删除失败:`, deleteError.message);
          errorCount += batchIds.length;
        } else {
          deletedCount += batchIds.length;
          console.log(`✅ 批次 ${batchNum} (${shortId}): 已删除 ${batchIds.length} 条记录 [总进度: ${deletedCount}/${orphanedRecords.length}]`);
        }
        batchNum++;
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('🎉 清理完成！');
    console.log(`✅ 成功删除: ${deletedCount} 条记录`);
    if (errorCount > 0) {
      console.log(`❌ 删除失败: ${errorCount} 条记录`);
    }
    console.log('='.repeat(50));

  } catch (error) {
    console.error('\n❌ 清理过程中发生错误:', error.message);
    console.error(error);
    process.exit(1);
  }
}

/**
 * 仅分析不删除（干运行模式）
 */
async function dryRun() {
  console.log('🔍 干运行模式: 仅分析不删除\n');

  try {
    const validExperimentIds = await getValidExperimentIds();
    const allHolders = await getAllTokenHolders();

    // 统计每个孤立实验的记录数
    const orphanedByExperiment = new Map();
    let orphanedCount = 0;

    for (const holder of allHolders) {
      if (holder.experiment_id &&
          holder.experiment_id !== 'null' &&
          holder.experiment_id !== '' &&
          !validExperimentIds.has(holder.experiment_id)) {
        orphanedCount++;
        const current = orphanedByExperiment.get(holder.experiment_id) || 0;
        orphanedByExperiment.set(holder.experiment_id, current + 1);
      }
    }

    console.log('📊 分析结果:');
    console.log(`   token_holders 总记录数: ${allHolders.length}`);
    console.log(`   孤立记录总数: ${orphanedCount}`);
    console.log(`   涉及已删除实验数: ${orphanedByExperiment.size}`);

    if (orphanedByExperiment.size > 0) {
      console.log('\n📋 各已删除实验的孤立记录数:');
      const sorted = Array.from(orphanedByExperiment.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      sorted.forEach(([expId, count]) => {
        const shortId = expId.length > 12
          ? `${expId.substring(0, 8)}...${expId.substring(expId.length - 4)}`
          : expId;
        console.log(`   ${shortId}: ${count} 条`);
      });

      if (orphanedByExperiment.size > 10) {
        console.log(`   ... 还有 ${orphanedByExperiment.size - 10} 个实验`);
      }
    }

    console.log('\n💡 运行 `node scripts/cleanup_orphaned_token_holders.js --execute` 执行实际删除');

  } catch (error) {
    console.error('\n❌ 分析过程中发生错误:', error.message);
    process.exit(1);
  }
}

// 主入口
(async () => {
  const args = process.argv.slice(2);

  if (args.includes('--dry-run') || args.includes('-d')) {
    await dryRun();
  } else if (args.includes('--execute') || args.includes('-e')) {
    await cleanupOrphanedTokenHolders();
  } else {
    console.log('🔍 孤立 token_holders 数据清理工具\n');
    console.log('用法:');
    console.log('  node scripts/cleanup_orphaned_token_holders.js --dry-run   # 仅分析，不删除');
    console.log('  node scripts/cleanup_orphaned_token_holders.js --execute   # 执行删除\n');
    console.log('默认运行干运行模式...\n');
    await dryRun();
  }
})();
