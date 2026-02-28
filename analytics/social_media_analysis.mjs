/**
 * 社交媒体信息分析
 * 分析代币的人工标注类别与其社交媒体信息（推特/网站）的关系
 * 验证假设：流水盘、低质量代币是否更倾向于缺失社交媒体信息
 */

import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
import { resolve, fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenvConfig({ path: resolve(__dirname, 'config/.env') });

const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭' },
  no_user: { label: '无人玩', emoji: '👻' },
  low_quality: { label: '低质量', emoji: '📉' },
  mid_quality: { label: '中质量', emoji: '📊' },
  high_quality: { label: '高质量', emoji: '🚀' }
};

/**
 * 社交媒体分析服务
 */
class SocialMediaAnalysisService {
  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * 获取所有有人工标注的代币
   * 使用两步查询避免获取大 JSONB 列导致超时
   */
  async getAnnotatedTokens() {
    console.log('📋 获取所有人工标注的代币...');

    // 第一步：获取所有标注代币的基本信息和分类
    const allTokens = [];
    let page = 0;
    const pageSize = 50;  // 进一步减小分页大小
    let hasMore = true;

    while (hasMore) {
      try {
        // 只选择代币标识字段，human_judges 和 raw_api_data 在第二个查询中获取
        const { data, error } = await this.supabase
          .from('experiment_tokens')
          .select('token_address, token_symbol, blockchain')
          .not('human_judges', 'is', null)
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          if (error.code === '57014') {
            console.warn(`   ⚠️  第 ${page + 1} 页查询超时，已获取 ${allTokens.length} 条，停止查询`);
            break;
          }
          throw error;
        }

        if (data && data.length > 0) {
          allTokens.push(...data);
          hasMore = data.length === pageSize;
          page++;

          if (page % 5 === 0) {
            console.log(`   已获取 ${allTokens.length} 条标注数据...`);
          }
        } else {
          hasMore = false;
        }
      } catch (err) {
        if (err.code === '57014') {
          console.warn(`   ⚠️  第 ${page + 1} 页查询超时，已获取 ${allTokens.length} 条，停止查询`);
          break;
        }
        throw err;
      }
    }

    console.log(`✅ 找到 ${allTokens.length} 个有人工标注的代币`);
    return allTokens;
  }

  /**
   * 获取代币的社交媒体信息（只查询 appendix 字段）
   */
  async getTokensSocialInfo(tokens) {
    console.log(`\n📊 获取 ${tokens.length} 个代币的社交媒体信息...`);

    const results = [];
    const batchSize = 20;  // 每批处理20个代币

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);

      for (const token of batch) {
        try {
          // 查询 human_judges->category 和 raw_api_data->appendix
          const { data, error } = await this.supabase
            .from('experiment_tokens')
            .select('human_judges->category, raw_api_data->appendix')
            .eq('token_address', token.token_address)
            .eq('blockchain', token.blockchain)
            .limit(1)
            .single();

          if (!error && data) {
            // 处理不同的返回结构
            let category = null;
            if (data.category !== undefined) {
              category = data.category;  // Supabase 可能将 ->category 直接返回到顶层
            } else if (data.human_judges?.category !== undefined) {
              category = data.human_judges.category;
            }

            // appendix 是 JSON 字符串，需要解析
            let appendix = data.raw_api_data?.appendix || data.appendix || null;
            if (appendix && typeof appendix === 'string' && appendix.trim() !== '') {
              try {
                appendix = JSON.parse(appendix);
              } catch (e) {
                appendix = null;
              }
            }

            results.push({
              tokenAddress: token.token_address,
              tokenSymbol: token.token_symbol,
              blockchain: token.blockchain,
              category: category,
              hasTwitter: this._hasTwitter(appendix),
              hasWebsite: this._hasWebsite(appendix),
              hasTelegram: this._hasTelegram(appendix),
              hasAnySocial: this._hasAnySocial(appendix),
              twitterHandle: this._getTwitterHandle(appendix),
              websiteUrl: this._getWebsiteUrl(appendix)
            });
          }
        } catch (err) {
          // 单个代币失败不影响整体
          console.warn(`   警告: 获取代币 ${token.token_symbol} 社交信息失败:`, err.message);
        }
      }

      // 批次间延迟
      if (i + batchSize < tokens.length) {
        await this._sleep(100);
      }

      if ((i + batchSize) % 100 === 0 || i + batchSize >= tokens.length) {
        console.log(`   进度: ${Math.min(i + batchSize, tokens.length)}/${tokens.length} (${((Math.min(i + batchSize, tokens.length) / tokens.length) * 100).toFixed(1)}%)`);
      }
    }

    console.log(`✅ 完成！获取了 ${results.length} 个代币的社交媒体信息`);
    return results;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _hasTwitter(appendix) {
    if (!appendix) return false;
    return !!(appendix.twitter || appendix.twitter_link);
  }

  _hasWebsite(appendix) {
    if (!appendix) return false;
    return !!(appendix.website || appendix.website_link || appendix.websites);
  }

  _hasTelegram(appendix) {
    if (!appendix) return false;
    return !!(appendix.telegram || appendix.telegram_link);
  }

  _hasAnySocial(appendix) {
    return this._hasTwitter(appendix) || this._hasWebsite(appendix) || this._hasTelegram(appendix);
  }

  _getTwitterHandle(appendix) {
    return appendix?.twitter || appendix?.twitter_link || null;
  }

  _getWebsiteUrl(appendix) {
    return appendix?.website || appendix?.website_link || null;
  }

  /**
   * 按类别分组统计
   */
  analyzeByCategory(tokensWithSocial) {
    const byCategory = {
      fake_pump: { total: 0, hasTwitter: 0, hasWebsite: 0, hasTelegram: 0, hasAnySocial: 0 },
      no_user: { total: 0, hasTwitter: 0, hasWebsite: 0, hasTelegram: 0, hasAnySocial: 0 },
      low_quality: { total: 0, hasTwitter: 0, hasWebsite: 0, hasTelegram: 0, hasAnySocial: 0 },
      mid_quality: { total: 0, hasTwitter: 0, hasWebsite: 0, hasTelegram: 0, hasAnySocial: 0 },
      high_quality: { total: 0, hasTwitter: 0, hasWebsite: 0, hasTelegram: 0, hasAnySocial: 0 }
    };

    for (const token of tokensWithSocial) {
      const cat = token.category;
      if (!cat || !byCategory[cat]) continue;

      const stats = byCategory[cat];
      stats.total++;
      if (token.hasTwitter) stats.hasTwitter++;
      if (token.hasWebsite) stats.hasWebsite++;
      if (token.hasTelegram) stats.hasTelegram++;
      if (token.hasAnySocial) stats.hasAnySocial++;
    }

    return byCategory;
  }

  /**
   * 生成分析报告
   */
  generateReport(byCategory, tokensWithSocial) {
    console.log('\n========================================');
    console.log('   社交媒体信息统计报告');
    console.log('========================================\n');

    const categories = ['fake_pump', 'low_quality', 'mid_quality', 'high_quality', 'no_user'];

    // 1. 按类别统计表格
    console.log('📊 按类别统计：');
    console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 类别        │ 总数  │ Twitter │  网站  │ Telegram │ 任一社交 │ 完全缺失 │ 缺失率 │');
    console.log('├─────────────────────────────────────────────────────────────────────────────┤');

    for (const cat of categories) {
      const stats = byCategory[cat];
      if (stats.total === 0) continue;

      const info = CATEGORY_MAP[cat];
      const twitterRate = ((stats.hasTwitter / stats.total) * 100).toFixed(1);
      const websiteRate = ((stats.hasWebsite / stats.total) * 100).toFixed(1);
      const telegramRate = ((stats.hasTelegram / stats.total) * 100).toFixed(1);
      const anySocialRate = ((stats.hasAnySocial / stats.total) * 100).toFixed(1);
      const missingCount = stats.total - stats.hasAnySocial;
      const missingRate = ((missingCount / stats.total) * 100).toFixed(1);

      console.log(`│ ${info.label.padEnd(10)} │ ${stats.total.toString().padStart(5)} │ ${twitterRate.padStart(6)}% │ ${websiteRate.padStart(6)}% │ ${telegramRate.padStart(7)}% │ ${anySocialRate.padStart(7)}% │ ${missingCount.toString().padStart(7)} │ ${missingRate.padStart(6)}% │`);
    }

    console.log('└─────────────────────────────────────────────────────────────────────────────┘\n');

    // 2. 对比分析
    console.log('🔍 对比分析：流水盘/低质量 vs 中高质量\n');

    const fakePump = byCategory.fake_pump;
    const lowQuality = byCategory.low_quality;
    const midQuality = byCategory.mid_quality;
    const highQuality = byCategory.high_quality;

    // 流水盘 vs 中高质量
    if (fakePump.total > 0 && midQuality.total > 0 && highQuality.total > 0) {
      const midHighTotal = midQuality.total + highQuality.total;
      const midHighHasSocial = midQuality.hasAnySocial + highQuality.hasAnySocial;
      const fakePumpMissingRate = ((fakePump.total - fakePump.hasAnySocial) / fakePump.total * 100).toFixed(1);
      const midHighMissingRate = ((midHighTotal - midHighHasSocial) / midHighTotal * 100).toFixed(1);
      const diff = (fakePumpMissingRate - midHighMissingRate).toFixed(1);

      console.log(`   ${CATEGORY_MAP.fake_pump.emoji} 流水盘 vs ${CATEGORY_MAP.mid_quality.emoji}${CATEGORY_MAP.high_quality.emoji} 中高质量：`);
      console.log(`      流水盘缺失率: ${fakePumpMissingRate}% (${fakePump.total - fakePump.hasAnySocial}/${fakePump.total})`);
      console.log(`      中高质量缺失率: ${midHighMissingRate}% (${midHighTotal - midHighHasSocial}/${midHighTotal})`);
      console.log(`      差异: ${diff} 个百分点`);
      console.log(`      结论: ${parseFloat(diff) > 10 ? '⚠️ 流水盘明显更倾向于缺失社交媒体信息' : '✓ 差异不大'}`);
    }

    // 低质量 vs 中高质量
    if (lowQuality.total > 0 && midQuality.total > 0 && highQuality.total > 0) {
      const midHighTotal = midQuality.total + highQuality.total;
      const midHighHasSocial = midQuality.hasAnySocial + highQuality.hasAnySocial;
      const lowMissingRate = ((lowQuality.total - lowQuality.hasAnySocial) / lowQuality.total * 100).toFixed(1);
      const midHighMissingRate = ((midHighTotal - midHighHasSocial) / midHighTotal * 100).toFixed(1);
      const diff = (lowMissingRate - midHighMissingRate).toFixed(1);

      console.log(`\n   ${CATEGORY_MAP.low_quality.emoji} 低质量 vs ${CATEGORY_MAP.mid_quality.emoji}${CATEGORY_MAP.high_quality.emoji} 中高质量：`);
      console.log(`      低质量缺失率: ${lowMissingRate}% (${lowQuality.total - lowQuality.hasAnySocial}/${lowQuality.total})`);
      console.log(`      中高质量缺失率: ${midHighMissingRate}% (${midHighTotal - midHighHasSocial}/${midHighTotal})`);
      console.log(`      差异: ${diff} 个百分点`);
      console.log(`      结论: ${parseFloat(diff) > 10 ? '⚠️ 低质量明显更倾向于缺失社交媒体信息' : '✓ 差异不大'}`);
    }

    // 3. 详细统计数据
    console.log('\n📈 详细统计数据：');
    for (const cat of categories) {
      const stats = byCategory[cat];
      if (stats.total === 0) continue;

      const info = CATEGORY_MAP[cat];
      console.log(`\n   ${info.emoji} ${info.label}:`);
      console.log(`      总数: ${stats.total}`);
      console.log(`      有 Twitter: ${stats.hasTwitter} (${((stats.hasTwitter / stats.total) * 100).toFixed(1)}%)`);
      console.log(`      有网站: ${stats.hasWebsite} (${((stats.hasWebsite / stats.total) * 100).toFixed(1)}%)`);
      console.log(`      有 Telegram: ${stats.hasTelegram} (${((stats.hasTelegram / stats.total) * 100).toFixed(1)}%)`);
      console.log(`      有任一社交媒体: ${stats.hasAnySocial} (${((stats.hasAnySocial / stats.total) * 100).toFixed(1)}%)`);
      const missingCount = stats.total - stats.hasAnySocial;
      const missingRate = ((missingCount / stats.total) * 100).toFixed(1);
      console.log(`      完全缺失社交媒体: ${missingCount} (${missingRate}%)`);
    }

    return {
      summary: this._formatCategoryStats(byCategory),
      rawData: tokensWithSocial.map(t => ({
        tokenAddress: t.tokenAddress,
        tokenSymbol: t.tokenSymbol,
        category: t.category,
        hasTwitter: t.hasTwitter,
        hasWebsite: t.hasWebsite,
        hasTelegram: t.hasTelegram,
        hasAnySocial: t.hasAnySocial
      }))
    };
  }

  _formatCategoryStats(byCategory) {
    const result = {};
    for (const [cat, stats] of Object.entries(byCategory)) {
      result[cat] = {
        label: CATEGORY_MAP[cat]?.label || cat,
        emoji: CATEGORY_MAP[cat]?.emoji || '',
        total: stats.total,
        hasTwitter: stats.hasTwitter,
        hasTwitterRate: stats.total > 0 ? (stats.hasTwitter / stats.total * 100).toFixed(2) + '%' : '0%',
        hasWebsite: stats.hasWebsite,
        hasWebsiteRate: stats.total > 0 ? (stats.hasWebsite / stats.total * 100).toFixed(2) + '%' : '0%',
        hasTelegram: stats.hasTelegram,
        hasTelegramRate: stats.total > 0 ? (stats.hasTelegram / stats.total * 100).toFixed(2) + '%' : '0%',
        hasAnySocial: stats.hasAnySocial,
        hasAnySocialRate: stats.total > 0 ? (stats.hasAnySocial / stats.total * 100).toFixed(2) + '%' : '0%',
        missingSocial: stats.total - stats.hasAnySocial,
        missingSocialRate: stats.total > 0 ? ((stats.total - stats.hasAnySocial) / stats.total * 100).toFixed(2) + '%' : '0%'
      };
    }
    return result;
  }

  /**
   * 运行分析
   */
  async analyze() {
    console.log('========================================');
    console.log('   社交媒体信息分析');
    console.log('========================================\n');

    try {
      // 1. 获取所有标注代币（只含基本信息和分类）
      const tokens = await this.getAnnotatedTokens();

      if (tokens.length === 0) {
        console.log('⚠️  没有找到人工标注的代币');
        return;
      }

      // 2. 逐个获取代币的社交媒体信息（只查询 appendix 字段）
      const tokensWithSocial = await this.getTokensSocialInfo(tokens);

      // 3. 按类别分析
      const byCategory = this.analyzeByCategory(tokensWithSocial);

      // 4. 生成并打印报告
      const report = this.generateReport(byCategory, tokensWithSocial);

      // 5. 保存结果
      await this.saveResults(report);

      console.log('\n✅ 分析完成！');

      return report;

    } catch (error) {
      console.error('\n❌ 分析失败:', error);
      throw error;
    }
  }

  /**
   * 保存结果
   */
  async saveResults(report) {
    const outputDir = resolve(__dirname, 'output');
    await fs.mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

    // 保存完整 JSON
    const jsonPath = resolve(outputDir, `social_media_analysis_${timestamp}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
    console.log(`\n💾 保存结果:`);
    console.log(`   📄 JSON: ${jsonPath}`);

    // 保存代币详情 CSV
    const csvPath = resolve(outputDir, `social_media_tokens_${timestamp}.csv`);
    const headers = ['代币地址', '代币符号', '类别', 'Twitter', '网站', 'Telegram', '任一社交'];

    const rows = [headers];
    for (const token of report.rawData) {
      rows.push([
        token.tokenAddress,
        token.tokenSymbol || '',
        token.category || '',
        token.hasTwitter ? 'Y' : 'N',
        token.hasWebsite ? 'Y' : 'N',
        token.hasTelegram ? 'Y' : 'N',
        token.hasAnySocial ? 'Y' : 'N'
      ]);
    }

    const csvContent = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    await fs.writeFile(csvPath, '\ufeff' + csvContent, 'utf8');
    console.log(`   📄 代币详情 CSV: ${csvPath}`);

    // 保存统计摘要 CSV
    const statsPath = resolve(outputDir, `social_media_stats_${timestamp}.csv`);
    const statsHeaders = ['类别', '标签', '总数', '有Twitter', 'Twitter率', '有网站', '网站率', '有任一社交', '社交率', '完全缺失', '缺失率'];

    const statsRows = [statsHeaders];
    for (const [cat, stats] of Object.entries(report.summary)) {
      statsRows.push([
        cat,
        stats.label,
        stats.total,
        stats.hasTwitter,
        stats.hasTwitterRate,
        stats.hasWebsite,
        stats.hasWebsiteRate,
        stats.hasAnySocial,
        stats.hasAnySocialRate,
        stats.missingSocial,
        stats.missingSocialRate
      ]);
    }

    const statsContent = statsRows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    await fs.writeFile(statsPath, '\ufeff' + statsContent, 'utf8');
    console.log(`   📄 统计摘要 CSV: ${statsPath}`);
  }
}

/**
 * 主函数
 */
async function main() {
  const service = new SocialMediaAnalysisService();
  await service.analyze();
}

// 运行
main().catch(console.error);
