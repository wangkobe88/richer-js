/**
 * 钱包标签比较工具 - 对比 Supabase 中已有的钱包标签与新生成的标签
 */

import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenvConfig({ path: resolve(__dirname, '../config/.env') });

/**
 * 钱包标签比较服务
 */
class WalletLabelCompareService {
  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY 环境变量');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.localLabels = new Map();
  }

  /**
   * 从本地文件加载新生成的标签
   */
  loadLocalLabels() {
    console.log('\n📂 加载本地标签数据...');

    const pattern = resolve(__dirname, 'output', 'wallet_labels_*.json');
    const files = glob.sync(pattern);

    if (files.length === 0) {
      console.warn('   ⚠️  未找到本地标签文件');
      return false;
    }

    files.sort().reverse();
    const latestFile = files[0];
    console.log(`   📄 读取文件: ${latestFile}`);

    try {
      const data = JSON.parse(readFileSync(latestFile, 'utf8'));

      for (const [wallet, labelData] of Object.entries(data.wallets)) {
        this.localLabels.set(wallet.toLowerCase(), labelData);
      }

      console.log(`   ✅ 成功加载 ${this.localLabels.size} 个本地标签`);
      return true;

    } catch (error) {
      console.error(`   ❌ 加载本地标签失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 从 Supabase 下载钱包数据
   */
  async downloadSupabaseWallets() {
    console.log('\n📥 从 Supabase 下载钱包数据...');

    const PAGE_SIZE = 1000;
    let allWallets = [];
    let page = 0;

    while (true) {
      const start = page * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;

      const { data, error } = await this.supabase
        .from('wallets')
        .select('*')
        .range(start, end);

      if (error) {
        console.error(`   ❌ 获取钱包数据失败: ${error.message}`);
        if (allWallets.length > 0) {
          console.log(`   ⚠️  使用已获取的 ${allWallets.length} 个钱包`);
          return allWallets;
        }
        return [];
      }

      if (!data || data.length === 0) break;

      allWallets.push(...data);
      console.log(`   📄 获取第 ${page + 1} 页: ${data.length} 个钱包`);
      page++;

      if (data.length < PAGE_SIZE) break;
    }

    console.log(`   ✅ 成功下载 ${allWallets.length} 个钱包数据`);
    return allWallets;
  }

  /**
   * 比较标签
   */
  compareLabels(supabaseWallets) {
    console.log('\n🔍 比较标签数据...');

    const comparison = {
      totalInSupabase: supabaseWallets.length,
      totalInLocal: this.localLabels.size,
      commonWallets: 0,
      onlyInSupabase: 0,
      onlyInLocal: 0,

      // 标签一致性和差异
      labelMatches: 0,
      labelMismatches: 0,
      noLabelInSupabase: 0,

      // 详细差异
      mismatches: [],

      // 按标签统计
      bySupabaseLabel: {},
      byLocalLabel: {},
      agreementMatrix: {}
    };

    for (const wallet of supabaseWallets) {
      const address = (wallet.wallet_address || wallet.address || '').toLowerCase();
      if (!address) continue;

      const localLabel = this.localLabels.get(address);
      const supabaseLabel = wallet.category || null;

      // 统计 Supabase 标签分布
      if (supabaseLabel) {
        comparison.bySupabaseLabel[supabaseLabel] = (comparison.bySupabaseLabel[supabaseLabel] || 0) + 1;
      }

      if (!localLabel) {
        comparison.onlyInSupabase++;
        continue;
      }

      comparison.commonWallets++;

      // 统计本地标签分布
      const localLabelName = localLabel.label;
      comparison.byLocalLabel[localLabelName] = (comparison.byLocalLabel[localLabelName] || 0) + 1;

      // 比较标签
      if (!supabaseLabel) {
        comparison.noLabelInSupabase++;
      } else if (supabaseLabel === localLabelName) {
        comparison.labelMatches++;
        this._updateAgreementMatrix(comparison.agreementMatrix, supabaseLabel, localLabelName);
      } else {
        comparison.labelMismatches++;
        comparison.mismatches.push({
          address,
          supabaseLabel,
          localLabel: localLabelName,
          localReason: localLabel.reason,
          localConfidence: localLabel.confidence,
          localStats: localLabel.stats
        });
        this._updateAgreementMatrix(comparison.agreementMatrix, supabaseLabel, localLabelName);
      }
    }

    // 计算只在本地存在的钱包
    comparison.onlyInLocal = this.localLabels.size - comparison.commonWallets;

    return comparison;
  }

  /**
   * 更新一致性矩阵
   */
  _updateAgreementMatrix(matrix, supabaseLabel, localLabel) {
    if (!matrix[supabaseLabel]) {
      matrix[supabaseLabel] = {};
    }
    matrix[supabaseLabel][localLabel] = (matrix[supabaseLabel][localLabel] || 0) + 1;
  }

  /**
   * 打印比较结果
   */
  printComparison(comparison) {
    console.log('\n========================================');
    console.log('   标签比较结果');
    console.log('========================================');

    console.log(`\n📊 数据覆盖:`);
    console.log(`   Supabase 钱包数: ${comparison.totalInSupabase}`);
    console.log(`   本地标签数: ${comparison.totalInLocal}`);
    console.log(`   共同钱包数: ${comparison.commonWallets}`);
    console.log(`   仅在 Supabase: ${comparison.onlyInSupabase}`);
    console.log(`   仅在本地: ${comparison.onlyInLocal}`);

    if (comparison.commonWallets > 0) {
      const matchRate = (comparison.labelMatches / comparison.commonWallets * 100).toFixed(2);
      console.log(`\n🏷️  标签一致性:`);
      console.log(`   一致: ${comparison.labelMatches} (${matchRate}%)`);
      console.log(`   不一致: ${comparison.labelMismatches}`);
      console.log(`   Supabase 无标签: ${comparison.noLabelInSupabase}`);
    }

    console.log(`\n📋 Supabase 标签分布:`);
    for (const [label, count] of Object.entries(comparison.bySupabaseLabel).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${label}: ${count}`);
    }

    console.log(`\n📋 本地标签分布:`);
    for (const [label, count] of Object.entries(comparison.byLocalLabel).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${label}: ${count}`);
    }

    if (Object.keys(comparison.agreementMatrix).length > 0) {
      console.log(`\n📊 标签对应关系 (Supabase → 本地):`);
      for (const [supabaseLabel, localLabels] of Object.entries(comparison.agreementMatrix)) {
        console.log(`   ${supabaseLabel}:`);
        for (const [localLabel, count] of Object.entries(localLabels).sort((a, b) => b[1] - a[1])) {
          const total = comparison.bySupabaseLabel[supabaseLabel] || 1;
          const pct = (count / total * 100).toFixed(1);
          console.log(`     → ${localLabel}: ${count} (${pct}%)`);
        }
      }
    }

    if (comparison.mismatches.length > 0) {
      console.log(`\n⚠️  标签不一致示例 (前20个):`);
      for (const m of comparison.mismatches.slice(0, 20)) {
        console.log(`   ${m.address.slice(0, 10)}...`);
        console.log(`     Supabase: ${m.supabaseLabel} | 本地: ${m.localLabel} (${m.localReason})`);
        console.log(`     流水盘: ${m.localStats.fakePumpCount}次 | 占比: ${(m.localStats.fakePumpRatio * 100).toFixed(1)}%`);
      }
    }
  }

  /**
   * 保存比较结果
   */
  saveComparison(comparison) {
    console.log('\n💾 保存比较结果...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const outputDir = resolve(__dirname, 'output');
    const jsonPath = resolve(outputDir, `label_comparison_${timestamp}.json`);

    // 不保存完整的 mismatches 数组（可能太大）
    const summaryData = {
      generated_at: new Date().toISOString(),
      summary: {
        totalInSupabase: comparison.totalInSupabase,
        totalInLocal: comparison.totalInLocal,
        commonWallets: comparison.commonWallets,
        onlyInSupabase: comparison.onlyInSupabase,
        onlyInLocal: comparison.onlyInLocal,
        labelMatches: comparison.labelMatches,
        labelMismatches: comparison.labelMismatches,
        noLabelInSupabase: comparison.noLabelInSupabase,
        matchRate: comparison.commonWallets > 0 ?
          (comparison.labelMatches / comparison.commonWallets * 100).toFixed(2) + '%' : 'N/A'
      },
      bySupabaseLabel: comparison.bySupabaseLabel,
      byLocalLabel: comparison.byLocalLabel,
      agreementMatrix: comparison.agreementMatrix,
      mismatchesSample: comparison.mismatches.slice(0, 100)
    };

    writeFileSync(jsonPath, JSON.stringify(summaryData, null, 2));
    console.log(`   📄 JSON: ${jsonPath}`);
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('   钱包标签比较工具');
  console.log('   Supabase vs 本地生成');
  console.log('========================================');

  const service = new WalletLabelCompareService();

  try {
    // 1. 加载本地标签
    const loaded = service.loadLocalLabels();
    if (!loaded) {
      console.error('\n❌ 无法继续，缺少本地标签数据');
      return;
    }

    // 2. 下载 Supabase 钱包数据
    const supabaseWallets = await service.downloadSupabaseWallets();

    if (supabaseWallets.length === 0) {
      console.log('\n⚠️  Supabase 中没有钱包数据');
      return;
    }

    // 3. 比较标签
    const comparison = service.compareLabels(supabaseWallets);

    // 4. 打印结果
    service.printComparison(comparison);

    // 5. 保存结果
    service.saveComparison(comparison);

  } catch (error) {
    console.error('\n❌ 比较失败:', error);
  }

  console.log('\n✅ 比较完成');
}

// 运行
main().catch(console.error);
