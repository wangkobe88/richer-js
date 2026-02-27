/**
 * 导出标签不一致的钱包数据
 */

import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenvConfig({ path: resolve(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function main() {
  console.log('========================================');
  console.log('   导出标签不一致数据');
  console.log('========================================');

  // 1. 加载本地标签
  console.log('\n📂 加载本地标签...');
  const pattern = resolve(__dirname, 'output', 'wallet_labels_*.json');
  const files = glob.sync(pattern).sort().reverse();
  const latestFile = files[0];
  const labelData = JSON.parse(readFileSync(latestFile, 'utf8'));

  const localLabels = new Map();
  for (const [wallet, data] of Object.entries(labelData.wallets)) {
    localLabels.set(wallet.toLowerCase(), data);
  }
  console.log(`   ✅ 加载 ${localLabels.size} 个本地标签`);

  // 2. 下载 Supabase 钱包数据
  console.log('\n📥 下载 Supabase 钱包数据...');
  const PAGE_SIZE = 1000;
  let allWallets = [];
  let page = 0;

  while (true) {
    const { data, error } = await supabase
      .from('wallets')
      .select('*')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;
    allWallets.push(...data);
    console.log(`   📄 第 ${page + 1} 页: ${data.length} 个`);
    page++;
  }
  console.log(`   ✅ 共 ${allWallets.length} 个钱包`);

  // 3. 找出不一致的钱包
  console.log('\n🔍 分析不一致数据...');
  const mismatches = [];
  const matches = [];

  for (const wallet of allWallets) {
    const address = wallet.address.toLowerCase();
    const supabaseLabel = wallet.category;
    const localLabel = localLabels.get(address);

    if (!localLabel) continue;

    const record = {
      address: wallet.address,
      supabaseLabel: supabaseLabel,
      localLabel: localLabel.label,
      localReason: localLabel.reason,
      localConfidence: localLabel.confidence,
      fakePumpCount: localLabel.stats.fakePumpCount,
      otherCount: localLabel.stats.otherCount,
      totalCount: localLabel.stats.totalCount,
      fakePumpRatio: localLabel.stats.fakePumpRatio,
      // 各类型参与详情
      categories: {}
    };

    // 获取该钱包在各类型代币的参与次数
    const walletProfile = localLabels.get(address);
    if (walletProfile) {
      // 需要从原始画像数据获取categories
      // 重新加载原始画像数据
    }

    if (supabaseLabel !== localLabel.label) {
      mismatches.push(record);
    } else {
      matches.push(record);
    }
  }

  console.log(`   ✅ 不一致: ${mismatches.length} 个, 一致: ${matches.length} 个`);

  // 4. 加载完整画像数据（获取categories详情）
  console.log('\n📂 加载完整画像数据...');
  const profilePattern = resolve(__dirname, 'output', 'wallet_profiles_*.json');
  const profileFiles = glob.sync(profilePattern).filter(f => !f.includes('_summary')).sort().reverse();
  const profileData = JSON.parse(readFileSync(profileFiles[0], 'utf8'));

  // 补充categories信息
  for (const m of mismatches) {
    const profile = profileData.wallets[m.address.toLowerCase()];
    if (profile && profile.categories) {
      m.categories = profile.categories;
    }
  }

  // 5. 保存不一致数据
  console.log('\n💾 保存数据...');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const outputDir = resolve(__dirname, 'output');

  // JSON 格式
  const jsonPath = resolve(outputDir, `label_mismatches_${timestamp}.json`);
  writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    summary: {
      total_compared: matches.length + mismatches.length,
      matches: matches.length,
      mismatches: mismatches.length,
      match_rate: (matches.length / (matches.length + mismatches.length) * 100).toFixed(2) + '%'
    },
    mismatches: mismatches
  }, null, 2));
  console.log(`   📄 JSON: ${jsonPath}`);

  // CSV 格式
  const csvPath = resolve(outputDir, `label_mismatches_${timestamp}.csv`);
  const headers = ['钱包地址', 'Supabase标签', '本地标签', '本地原因', '置信度',
                    '流水盘次数', '其他次数', '总次数', '流水盘占比',
                    'fake_pump', 'no_user', 'low_quality', 'mid_quality', 'high_quality'];

  const rows = [[...headers]];
  for (const m of mismatches) {
    rows.push([
      m.address,
      m.supabaseLabel || '',
      m.localLabel,
      m.localReason,
      m.localConfidence.toFixed(3),
      m.fakePumpCount,
      m.otherCount,
      m.totalCount,
      (m.fakePumpRatio * 100).toFixed(1) + '%',
      m.categories.fake_pump || 0,
      m.categories.no_user || 0,
      m.categories.low_quality || 0,
      m.categories.mid_quality || 0,
      m.categories.high_quality || 0
    ]);
  }

  const csvContent = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  writeFileSync(csvPath, '\ufeff' + csvContent, 'utf8');
  console.log(`   📄 CSV: ${csvPath}`);

  // 按不一致类型分组统计
  console.log('\n📊 不一致类型统计:');
  const byType = {};
  for (const m of mismatches) {
    const key = `${m.supabaseLabel} → ${m.localLabel}`;
    byType[key] = (byType[key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${key}: ${count} 个`);
  }

  console.log('\n✅ 导出完成');
  console.log(`\n文件位置:`);
  console.log(`   JSON: ${jsonPath}`);
  console.log(`   CSV:  ${csvPath}`);
}

main().catch(console.error);
