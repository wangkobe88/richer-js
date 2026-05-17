/**
 * 更新 Supabase 钱包标签
 * 以本地生成的标签为准，跳过 dev/negative_holder 标签
 */

import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { readFileSync } from 'fs';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenvConfig({ path: resolve(__dirname, '../config/.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 跳过更新的标签
const SKIP_LABELS = new Set(['dev', 'negative_holder', 'test']);

async function main() {
  console.log('========================================');
  console.log('   更新 Supabase 钱包标签');
  console.log('   以本地标签为准');
  console.log('========================================');

  // 1. 加载本地标签
  console.log('\n📂 加载本地标签...');
  const pattern = resolve(__dirname, 'output', 'wallet_labels_*.json');
  const files = glob.sync(pattern).sort().reverse();
  const latestFile = files[0];
  const labelData = JSON.parse(readFileSync(latestFile, 'utf8'));

  console.log(`   📄 读取文件: ${latestFile}`);

  // 2. 下载 Supabase 钱包数据
  console.log('\n📥 下载 Supabase 钱包数据...');
  const PAGE_SIZE = 1000;
  let allWallets = [];
  let page = 0;

  while (true) {
    const { data, error } = await supabase
      .from('wallets')
      .select('address, category')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;
    allWallets.push(...data);
    page++;
  }

  // 构建地址到钱包的映射
  const supabaseWallets = new Map();
  for (const w of allWallets) {
    supabaseWallets.set(w.address.toLowerCase(), w);
  }

  console.log(`   ✅ Supabase 中有 ${allWallets.length} 个钱包`);

  // 3. 分析需要更新/插入的钱包
  console.log('\n🔍 分析需要更新/插入的钱包...');

  const updates = []; // 已存在需要更新的
  const inserts = []; // 不存在需要插入的
  const skips = {
    skipLabels: 0,
    alreadyCorrect: 0
  };

  for (const [address, labelInfo] of Object.entries(labelData.wallets)) {
    const addrLower = address.toLowerCase();
    const supabaseWallet = supabaseWallets.get(addrLower);
    const localLabel = labelInfo.label;
    const localReason = labelInfo.reason;
    const localStats = labelInfo.stats;

    // 钱包不在 Supabase 中，需要插入
    if (!supabaseWallet) {
      inserts.push({
        address: address,
        chain: 'bsc',
        category: localLabel,
        name: `钱包画像-${localLabel}`
      });
      continue;
    }

    const supabaseLabel = supabaseWallet.category;

    // 跳过 dev/negative_holder 等特殊标签
    if (supabaseLabel && SKIP_LABELS.has(supabaseLabel)) {
      skips.skipLabels++;
      continue;
    }

    // 标签一致则跳过
    if (supabaseLabel === localLabel) {
      skips.alreadyCorrect++;
      continue;
    }

    // 需要更新
    updates.push({
      address: address,
      category: localLabel,
      name: `钱包画像-${localLabel}`
    });
  }

  console.log(`   📊 统计:`);
  console.log(`      需要更新: ${updates.length} 个`);
  console.log(`      需要插入: ${inserts.length} 个`);
  console.log(`      跳过(特殊标签): ${skips.skipLabels} 个`);
  console.log(`      跳过(已正确): ${skips.alreadyCorrect} 个`);

  if (updates.length === 0 && inserts.length === 0) {
    console.log('\n✅ 没有需要更新或插入的钱包');
    return;
  }

  // 4. 显示预览
  console.log('\n📋 预览:');

  if (inserts.length > 0) {
    console.log(`\n   新插入 (${inserts.length}个，前10个):`);
    for (const u of inserts.slice(0, 10)) {
      console.log(`   + ${u.address.slice(0, 10)}...   ${u.category}`);
    }
    if (inserts.length > 10) {
      console.log(`   ... 还有 ${inserts.length - 10} 个`);
    }
  }

  if (updates.length > 0) {
    console.log(`\n   更新 (${updates.length}个，前10个):`);
    for (const u of updates.slice(0, 10)) {
      const currentLabel = supabaseWallets.get(u.address.toLowerCase())?.category || 'null';
      console.log(`   ~ ${u.address.slice(0, 10)}...   ${currentLabel} → ${u.category}`);
    }
    if (updates.length > 10) {
      console.log(`   ... 还有 ${updates.length - 10} 个`);
    }
  }

  // 5. 先批量插入新钱包
  let inserted = 0;
  let insertFailed = 0;
  const insertErrors = [];

  if (inserts.length > 0) {
    console.log(`\n📥 开始批量插入 ${inserts.length} 个新钱包...`);

    const BATCH_SIZE = 100;
    for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
      const batch = inserts.slice(i, i + BATCH_SIZE);

      for (const insert of batch) {
        const { data, error } = await supabase
          .from('wallets')
          .insert({ address: insert.address, chain: insert.chain, category: insert.category, name: insert.name })
          .select();

        if (error) {
          insertFailed++;
          insertErrors.push({ address: insert.address, error: error.message });
        } else {
          inserted++;
        }

        if (inserted % 50 === 0) {
          process.stdout.write(`\r   进度: ${inserted}/${inserts.length}`);
        }
      }

      if (i + BATCH_SIZE < inserts.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    console.log(`\r   ✅ 插入完成: ${inserted} 个`);

    if (insertFailed > 0) {
      console.log(`   ❌ 失败: ${insertFailed} 个`);
      for (const e of insertErrors.slice(0, 5)) {
        console.log(`      ${e.address}: ${e.error}`);
      }
    }
  }

  // 6. 再批量更新现有钱包
  console.log(`\n🔄 开始批量更新 ${updates.length} 个钱包...`);

  const BATCH_SIZE = 100;
  let updated = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);

    // 逐个更新（upsert 需要唯一键，使用 address）
    for (const update of batch) {
      const { data, error } = await supabase
        .from('wallets')
        .update({ category: update.category, name: update.name })
        .eq('address', update.address)
        .select();

      if (error) {
        failed++;
        errors.push({ address: update.address, error: error.message });
      } else {
        updated++;
      }

      // 进度显示
      if (updated % 50 === 0) {
        process.stdout.write(`\r   进度: ${updated}/${updates.length}`);
      }
    }

    // 批次间延迟
    if (i + BATCH_SIZE < updates.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log(`\r   ✅ 更新完成: ${updated} 个`);

  if (failed > 0) {
    console.log(`   ❌ 失败: ${failed} 个`);
    console.log('\n失败详情:');
    for (const e of errors.slice(0, 10)) {
      console.log(`   ${e.address}: ${e.error}`);
    }
  }

  // 6. 验证更新结果
  console.log('\n🔍 验证更新结果...');
  const { data: verifyData, error: verifyError } = await supabase
    .from('wallets')
    .select('category')
    .not('category', 'is', null);

  if (!verifyError && verifyData) {
    const counts = {};
    for (const w of verifyData) {
      counts[w.category] = (counts[w.category] || 0) + 1;
    }
    console.log('   更新后的标签分布:');
    for (const [label, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`      ${label}: ${count}`);
    }
  }

  console.log('\n✅ 完成');
}

main().catch(console.error);
