/**
 * 钱包标签工具 - 根据钱包画像给钱包打标签
 * pump_group: 流水盘钱包
 * good_holder: 正常钱包
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 算法参数
const ALGORITHM_CONFIG = {
  pureFakePumpThreshold: 0.8,    // 纯流水盘阈值 80%
  minFakePumpCount: 3,           // 最小流水盘次数
  mixedFakePumpThreshold: 0.4,   // 混合型流水盘阈值 40%
  singleAttemptThreshold: 1      // 单次试探阈值
};

/**
 * 钱包标签服务
 */
class WalletLabelService {
  constructor() {
    this.walletProfiles = new Map();
  }

  /**
   * 加载钱包画像数据
   */
  loadWalletProfiles() {
    console.log('\n📂 加载钱包画像数据...');

    // 查找最新的钱包画像文件
    const pattern = resolve(__dirname, 'output', 'wallet_profiles_*.json');
    const files = glob.sync(pattern).filter(f => !f.includes('_summary.json'));

    if (files.length === 0) {
      console.warn('   ⚠️  未找到钱包画像文件');
      return false;
    }

    files.sort().reverse();
    const latestFile = files[0];
    console.log(`   📄 读取文件: ${latestFile}`);

    try {
      const data = JSON.parse(readFileSync(latestFile, 'utf8'));
      const walletsData = data.wallets || {};

      for (const [wallet, profile] of Object.entries(walletsData)) {
        this.walletProfiles.set(wallet.toLowerCase(), {
          totalParticipations: profile.total_participations || profile.totalParticipations,
          earlyTradeCount: profile.early_trade_count || profile.earlyTradeCount || 0,
          holderCount: profile.holder_count || profile.holderCount || 0,
          categories: profile.categories || {},
          dominantCategory: profile.dominant_category,
          tokens: profile.tokens
        });
      }

      console.log(`   ✅ 成功加载 ${this.walletProfiles.size} 个钱包画像`);
      return true;

    } catch (error) {
      console.error(`   ❌ 加载钱包画像失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 对单个钱包进行标签判断
   */
  labelWallet(wallet, profile) {
    const cats = profile.categories || {};
    const fakePumpCount = cats.fake_pump || 0;
    const otherCount = (cats.no_user || 0) + (cats.low_quality || 0) +
                       (cats.mid_quality || 0) + (cats.high_quality || 0);
    const totalCount = fakePumpCount + otherCount;

    if (totalCount === 0) {
      return {
        wallet,
        label: 'good_holder',
        confidence: 0,
        reason: '无参与记录',
        stats: { fakePumpCount: 0, otherCount: 0, totalCount: 0, fakePumpRatio: 0 }
      };
    }

    const fakePumpRatio = fakePumpCount / totalCount;

    // 规则1: 无流水盘参与
    if (fakePumpCount === 0) {
      return {
        wallet,
        label: 'good_holder',
        confidence: 1.0,
        reason: '无流水盘参与',
        stats: { fakePumpCount, otherCount, totalCount, fakePumpRatio }
      };
    }

    // 规则2: 纯流水盘钱包 (>=80%)
    if (fakePumpRatio >= ALGORITHM_CONFIG.pureFakePumpThreshold) {
      return {
        wallet,
        label: 'pump_group',
        confidence: fakePumpRatio,
        reason: `纯流水盘占比${(fakePumpRatio * 100).toFixed(1)}%`,
        stats: { fakePumpCount, otherCount, totalCount, fakePumpRatio }
      };
    }

    // 规则3: 混合型精细判断
    // 3a: 多次流水盘参与且占比高
    if (fakePumpCount >= ALGORITHM_CONFIG.minFakePumpCount &&
        fakePumpRatio >= ALGORITHM_CONFIG.mixedFakePumpThreshold) {
      return {
        wallet,
        label: 'pump_group',
        confidence: fakePumpRatio * 0.8,
        reason: `混合型重度流水盘 (${fakePumpCount}次, ${(fakePumpRatio * 100).toFixed(1)}%)`,
        stats: { fakePumpCount, otherCount, totalCount, fakePumpRatio }
      };
    }

    // 3b: 单次试探性参与
    if (fakePumpCount === ALGORITHM_CONFIG.singleAttemptThreshold) {
      return {
        wallet,
        label: 'good_holder',
        confidence: 1.0 - fakePumpRatio,
        reason: '单次试探性参与',
        stats: { fakePumpCount, otherCount, totalCount, fakePumpRatio }
      };
    }

    // 3c: 其他混合情况
    return {
      wallet,
      label: 'good_holder',
      confidence: 0.5,
      reason: `混合型轻度流水盘 (${fakePumpCount}次, ${(fakePumpRatio * 100).toFixed(1)}%)`,
      stats: { fakePumpCount, otherCount, totalCount, fakePumpRatio }
    };
  }

  /**
   * 批量处理所有钱包
   */
  processAllWallets() {
    console.log('\n🏷️  开始处理钱包标签...');

    const results = [];
    const stats = {
      total: 0,
      pump_group: 0,
      good_holder: 0,
      byReason: {}
    };

    for (const [wallet, profile] of this.walletProfiles) {
      const result = this.labelWallet(wallet, profile);
      results.push(result);

      stats.total++;
      stats[result.label]++;
      stats.byReason[result.reason] = (stats.byReason[result.reason] || 0) + 1;
    }

    return { results, stats };
  }

  /**
   * 保存结果
   */
  saveResults(labeledWallets, stats) {
    console.log('\n💾 保存标签结果...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const outputDir = resolve(__dirname, 'output');

    // 保存完整 JSON
    const jsonPath = resolve(outputDir, `wallet_labels_${timestamp}.json`);
    const outputData = {
      generated_at: new Date().toISOString(),
      algorithm: ALGORITHM_CONFIG,
      stats: {
        total: stats.total,
        pump_group: stats.pump_group,
        good_holder: stats.good_holder,
        pump_group_ratio: (stats.pump_group / stats.total * 100).toFixed(2) + '%',
        by_reason: stats.byReason
      },
      wallets: {}
    };

    for (const w of labeledWallets) {
      outputData.wallets[w.wallet] = {
        label: w.label,
        confidence: w.confidence,
        reason: w.reason,
        stats: w.stats
      };
    }

    writeFileSync(jsonPath, JSON.stringify(outputData, null, 2));
    console.log(`   📄 JSON: ${jsonPath}`);

    // 保存 CSV
    const csvPath = resolve(outputDir, `wallet_labels_${timestamp}.csv`);
    const headers = ['钱包地址', '标签', '置信度', '原因', '流水盘次数', '其他次数', '总次数', '流水盘占比'];

    const rows = [[...headers]];
    for (const w of labeledWallets) {
      rows.push([
        w.wallet,
        w.label,
        w.confidence.toFixed(3),
        w.reason,
        w.stats.fakePumpCount,
        w.stats.otherCount,
        w.stats.totalCount,
        (w.stats.fakePumpRatio * 100).toFixed(1) + '%'
      ]);
    }

    const csvContent = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    writeFileSync(csvPath, '\ufeff' + csvContent, 'utf8');
    console.log(`   📄 CSV: ${csvPath}`);

    // 生成 pump_group 地址列表（方便其他程序使用）
    const pumpGroupPath = resolve(outputDir, `pump_group_addresses_${timestamp}.txt`);
    const pumpGroupAddresses = labeledWallets
      .filter(w => w.label === 'pump_group')
      .map(w => w.wallet)
      .sort();
    writeFileSync(pumpGroupPath, pumpGroupAddresses.join('\n') + '\n');
    console.log(`   📄 Pump Group地址列表: ${pumpGroupPath} (${pumpGroupAddresses.length}个)`);

    // 生成 good_holder 地址列表
    const goodHolderPath = resolve(outputDir, `good_holder_addresses_${timestamp}.txt`);
    const goodHolderAddresses = labeledWallets
      .filter(w => w.label === 'good_holder')
      .map(w => w.wallet)
      .sort();
    writeFileSync(goodHolderPath, goodHolderAddresses.join('\n') + '\n');
    console.log(`   📄 Good Holder地址列表: ${goodHolderPath} (${goodHolderAddresses.length}个)`);

    console.log('\n✅ 保存完成');
  }

  /**
   * 打印统计结果
   */
  printStats(stats) {
    console.log('\n========================================');
    console.log('   钱包标签统计结果');
    console.log('========================================');

    console.log(`\n📊 总体统计:`);
    console.log(`   总钱包数: ${stats.total}`);
    console.log(`   pump_group (流水盘钱包): ${stats.pump_group} 个`);
    console.log(`   good_holder (正常钱包): ${stats.good_holder} 个`);

    const pumpRatio = (stats.pump_group / stats.total * 100).toFixed(2);
    console.log(`   流水盘钱包占比: ${pumpRatio}%`);

    console.log(`\n📝 按原因分组:`);
    const sortedReasons = Object.entries(stats.byReason).sort((a, b) => b[1] - a[1]);
    for (const [reason, count] of sortedReasons) {
      const pct = (count / stats.total * 100).toFixed(1);
      console.log(`   ${reason}: ${count} (${pct}%)`);
    }
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('   钱包标签工具');
  console.log('   pump_group | good_holder');
  console.log('========================================');

  const service = new WalletLabelService();

  try {
    // 1. 加载钱包画像数据
    const loaded = service.loadWalletProfiles();
    if (!loaded) {
      console.error('\n❌ 无法继续，缺少钱包画像数据');
      return;
    }

    // 2. 处理所有钱包
    const { results, stats } = service.processAllWallets();

    // 3. 保存结果
    service.saveResults(results, stats);

    // 4. 打印统计
    service.printStats(stats);

  } catch (error) {
    console.error('\n❌ 处理失败:', error);
  }

  console.log('\n✅ 标签完成');
}

// 运行
main().catch(console.error);
