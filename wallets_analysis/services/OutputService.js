/**
 * 输出服务 - 将分析结果输出为文件
 */

import fs from 'fs/promises';
import path from 'path';
import config from '../config.js';

const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭' },
  no_user: { label: '无人玩', emoji: '👻' },
  low_quality: { label: '低质量', emoji: '📉' },
  mid_quality: { label: '中质量', emoji: '📊' },
  high_quality: { label: '高质量', emoji: '🚀' }
};

export class OutputService {
  constructor() {
    this.outputDir = config.output.dir;
  }

  /**
   * 输出结果
   * @param {Object} data - 分析数据
   */
  async output(data) {
    // 确保输出目录存在
    await this._ensureDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const baseFileName = `wallet_profiles_${timestamp}`;

    // 输出各种格式
    const promises = [];

    if (config.output.formats.includes('json')) {
      promises.push(this._outputJSON(baseFileName, data));
    }

    if (config.output.formats.includes('csv')) {
      promises.push(this._outputCSV(baseFileName, data));
    }

    // 总是输出简化版 JSON
    promises.push(this._outputSummaryJSON(baseFileName, data));

    await Promise.all(promises);
  }

  /**
   * 输出 JSON 格式
   * @private
   */
  async _outputJSON(fileName, data) {
    const filePath = path.join(this.outputDir, `${fileName}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`   📄 JSON: ${filePath}`);
  }

  /**
   * 输出简化版 JSON（仅 Top 钱包）
   * @private
   */
  async _outputSummaryJSON(fileName, data) {
    const summary = {
      generated_at: data.generated_at,
      total_wallets: data.summary.total_wallets,
      total_tokens_analyzed: data.summary.total_tokens_analyzed,
      by_dominant_category: data.summary.by_dominant_category,
      quality_distribution: data.summary.quality_distribution,
      top_wallets: data.summary.top_wallets.slice(0, 100)
    };

    const filePath = path.join(this.outputDir, `${fileName}_summary.json`);
    await fs.writeFile(filePath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`   📄 Summary JSON: ${filePath}`);
  }

  /**
   * 输出 CSV 格式
   * @private
   */
  async _outputCSV(fileName, data) {
    const lines = [];

    // 标题行
    lines.push([
      '钱包地址',
      '总参与次数',
      '流水盘',
      '无人玩',
      '低质量',
      '中质量',
      '高质量',
      '主导分类',
      '质量等级'
    ].join(','));

    // 数据行
    for (const [wallet, profile] of Object.entries(data.wallets)) {
      const cats = profile.categories;
      const dominant = profile.dominant_category;
      const quality = profile.dominant_quality;

      lines.push([
        wallet,
        profile.total_participations,
        cats.fake_pump || 0,
        cats.no_user || 0,
        cats.low_quality || 0,
        cats.mid_quality || 0,
        cats.high_quality || 0,
        dominant,
        quality
      ].join(','));
    }

    const filePath = path.join(this.outputDir, `${fileName}.csv`);
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');
    console.log(`   📄 CSV: ${filePath}`);
  }

  /**
   * 确保输出目录存在
   * @private
   */
  async _ensureDir() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }
}
