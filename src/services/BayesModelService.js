/**
 * 贝叶斯推断服务
 * 基于钱包画像预测代币性质
 */

const fs = require('fs').promises;
const path = require('path');
const { dbManager } = require('../services/dbManager');

class BayesModelService {
  constructor() {
    this.modelPath = path.join(__dirname, '../../data/bayes_model.json');
    this.model = null;
  }

  /**
   * 加载模型
   */
  async loadModel() {
    try {
      const content = await fs.readFile(this.modelPath, 'utf8');
      this.model = JSON.parse(content);
      return this.model;
    } catch (error) {
      console.log('模型不存在，返回null');
      return null;
    }
  }

  /**
   * 保存模型
   */
  async saveModel(model) {
    // 确保 data 目录存在
    const dataDir = path.dirname(this.modelPath);
    try {
      await fs.access(dataDir);
    } catch {
      await fs.mkdir(dataDir, { recursive: true });
    }

    await fs.writeFile(this.modelPath, JSON.stringify(model, null, 2), 'utf8');
    this.model = model;
  }

  /**
   * 训练模型 - 从标注数据构建
   */
  async trainModel(onProgress) {
    const supabase = dbManager.getClient();

    onProgress?.({ status: 'running', progress: 10, message: '获取标注代币...' });

    // 1. 获取所有标注代币（分批获取）
    const tokens = await this._getAnnotatedTokens(supabase);

    if (tokens.length === 0) {
      throw new Error('没有找到已标注的代币，无法训练模型');
    }

    // 2. 获取钱包画像
    onProgress?.({ status: 'running', progress: 20, message: '获取钱包画像...' });
    const { data: profiles } = await supabase
      .from('wallet_profiles')
      .select('*');

    if (!profiles || profiles.length === 0) {
      throw new Error('没有找到钱包画像，请先生成钱包画像');
    }

    const walletMap = new Map(profiles.map(p => [p.wallet_address, p]));

    // 3. 构建数据：代币性质 -> 参与钱包列表
    onProgress?.({ status: 'running', progress: 30, message: '构建训练数据...' });

    // 按性质分组
    const categoryToTokens = {};
    for (const token of tokens) {
      const category = token.human_judges.category;
      if (!categoryToTokens[category]) {
        categoryToTokens[category] = [];
      }
      categoryToTokens[category].push(token);
    }

    // 4. 获取每个代币的早期交易者
    onProgress?.({ status: 'running', progress: 40, message: '获取早期交易者数据...' });

    const categoryToWallets = {};  // 性质 -> 钱包频率统计
    for (const category of Object.keys(categoryToTokens)) {
      categoryToWallets[category] = {};
    }

    // 存储训练数据：用于后续测试时无需重新获取
    const trainingData = [];  // [{ tokenAddress, category, wallets }]

    const { WalletAnalysisDataService } = require('../web/services/WalletAnalysisDataService');
    const walletService = new WalletAnalysisDataService();

    let processed = 0;
    const total = tokens.length;

    // 批量处理，每批2个代币，批次间延迟8秒，每个代币间延迟3秒
    // 这样约每10秒处理2个代币，996个代币约需83分钟
    const batchSize = 2;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);

      for (const token of batch) {
        try {
          const traders = await walletService.getEarlyTraders(token.token_address, token.blockchain);

          const category = token.human_judges.category;
          for (const wallet of traders) {
            categoryToWallets[category][wallet] = (categoryToWallets[category][wallet] || 0) + 1;
          }

          // 存储训练数据
          trainingData.push({
            tokenAddress: token.token_address,
            tokenSymbol: token.token_symbol,
            category: category,
            wallets: Array.from(traders),
            blockchain: token.blockchain
          });

          processed++;

          // 更新进度
          if (processed % 10 === 0 || processed === total) {
            const progress = 40 + Math.floor((processed / total) * 40);
            onProgress?.({ status: 'running', progress, message: `处理 ${processed}/${total} 个代币...` });
          }

          // 每个代币间延迟3秒
          if (batch.indexOf(token) < batch.length - 1) {
            await this._delay(3000);
          }
        } catch (e) {
          console.warn(`获取代币 ${token.token_address} 早期交易者失败:`, e.message);
          // 即使失败也记录，钱包集合为空
          trainingData.push({
            tokenAddress: token.token_address,
            tokenSymbol: token.token_symbol,
            category: token.human_judges.category,
            wallets: [],
            blockchain: token.blockchain,
            error: e.message
          });
        }
      }

      // 批次间延迟8秒
      if (i + batchSize < tokens.length) {
        await this._delay(8000);
      }
    }

    // 5. 计算先验概率
    onProgress?.({ status: 'running', progress: 85, message: '计算模型参数...' });
    const totalTokens = tokens.length;
    const prior = {};
    for (const [category, tokenList] of Object.entries(categoryToTokens)) {
      prior[category] = tokenList.length / totalTokens;
    }

    // 6. 计算条件概率 P(wallet | category)
    const likelihood = {};
    for (const [category, walletFreq] of Object.entries(categoryToWallets)) {
      likelihood[category] = {};
      const categoryTokenCount = categoryToTokens[category].length;

      for (const [wallet, count] of Object.entries(walletFreq)) {
        // P(wallet | category) = count / categoryTokenCount
        likelihood[category][wallet] = count / categoryTokenCount;
      }
    }

    // 7. 构建钱包索引
    const walletIndex = {};
    for (const profile of profiles) {
      walletIndex[profile.wallet_address] = {
        totalParticipations: profile.total_participations,
        earlyTradeCount: profile.early_trade_count,
        dominantCategory: profile.dominant_category,
        trustScore: this._calculateTrustScore(profile)
      };
    }

    // 8. 保存模型
    const model = {
      modelId: `bayes_model_v${Date.now()}`,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stats: {
        totalTokens,
        categoryDistribution: Object.fromEntries(
          Object.entries(categoryToTokens).map(([k, v]) => [k, v.length])
        )
      },
      prior,
      likelihood,
      walletIndex,
      trainingData,  // 存储训练集数据，用于测试时无需重新获取
      metadata: {
        minWalletSupport: 3,
        smoothingFactor: 0.001,
        confidenceThreshold: 0.6
      }
    };

    await this.saveModel(model);

    onProgress?.({ status: 'completed', progress: 100, message: '训练完成！' });

    return { success: true, modelId: model.modelId, stats: model.stats };
  }

  /**
   * 获取所有标注代币（分批获取）
   */
  async _getAnnotatedTokens(supabase) {
    const allTokens = [];
    let offset = 0;
    const pageSize = 100;

    while (true) {
      const { data, error } = await supabase
        .from('experiment_tokens')
        .select('token_address, token_symbol, blockchain, human_judges')
        .not('human_judges', 'is', null)
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw new Error(`获取标注代币失败: ${error.message}`);
      }

      if (!data || data.length === 0) break;

      allTokens.push(...data);

      if (data.length < pageSize) break;

      offset += pageSize;
    }

    return allTokens;
  }

  /**
   * 计算钱包信任度
   */
  _calculateTrustScore(profile) {
    const logParticipations = Math.log(profile.total_participations + 1);
    const earlyRatio = profile.early_trade_count / profile.total_participations;
    const fakePumpRatio = (profile.categories?.fake_pump || 0) / profile.total_participations;

    // 信任度 = log(参与数) × (1 + 早期倾向) × (1 - 流水盘倾向)
    const score = logParticipations * (1 + earlyRatio) * (1 - fakePumpRatio);

    // 归一化到 0-1
    return Math.min(1, Math.max(0, score / 10));
  }

  /**
   * 预测代币性质
   */
  async predictToken(tokenAddress, chain = 'bsc') {
    // 加载模型
    if (!this.model) {
      await this.loadModel();
    }

    if (!this.model) {
      throw new Error('模型不存在，请先训练模型');
    }

    // 获取早期交易者
    const { WalletAnalysisDataService } = require('../web/services/WalletAnalysisDataService');
    const walletService = new WalletAnalysisDataService();
    const traders = await walletService.getEarlyTraders(tokenAddress, chain);

    return this._predictWithWallets(tokenAddress, traders);
  }

  /**
   * 使用钱包集合进行预测（内部方法，避免重复获取数据）
   */
  _predictWithWallets(tokenAddress, traders) {
    if (traders.size === 0) {
      return {
        tokenAddress,
        prediction: this.model.prior,
        confidence: 0,
        method: 'prior_only',
        message: '无早期交易者数据，使用先验概率',
        walletCount: 0,
        keyWallets: [],
        predictedCategory: Object.entries(this.model.prior).sort((a, b) => b[1] - a[1])[0][0]
      };
    }

    // 计算后验概率（对数空间）
    const categories = Object.keys(this.model.prior);
    let scores = {};

    for (const category of categories) {
      // log(P(C))
      scores[category] = Math.log(this.model.prior[category]);

      // 累加每个钱包的贡献
      for (const wallet of traders) {
        // P(wallet | C) with smoothing
        let p = this.model.likelihood[category]?.[wallet] || this.model.metadata.smoothingFactor;

        // 钱包权重
        const walletData = this.model.walletIndex[wallet];
        const walletWeight = walletData ? 1 + walletData.trustScore : 1;

        scores[category] += Math.log(p) * walletWeight;
      }
    }

    // softmax 归一化
    const maxScore = Math.max(...Object.values(scores));
    const expScores = {};
    let expSum = 0;

    for (const [category, score] of Object.entries(scores)) {
      expScores[category] = Math.exp(score - maxScore);
      expSum += expScores[category];
    }

    const prediction = {};
    for (const category of categories) {
      prediction[category] = expScores[category] / expSum;
    }

    // 计算置信度（基于熵）
    const entropy = -Object.values(prediction).reduce((sum, p) => sum + p * Math.log(p), 0);
    const maxEntropy = Math.log(categories.length);
    const confidence = 1 - (entropy / maxEntropy);

    // 找出关键钱包
    const keyWallets = this._findKeyWallets(Array.from(traders), prediction);

    return {
      tokenAddress,
      prediction,
      confidence: Math.round(confidence * 1000) / 1000,
      method: 'bayesian',
      walletCount: traders.size,
      keyWallets,
      predictedCategory: Object.entries(prediction).sort((a, b) => b[1] - a[1])[0][0]
    };
  }

  /**
   * 找出对预测贡献最大的钱包
   */
  _findKeyWallets(wallets, prediction) {
    const contributions = [];

    for (const wallet of wallets) {
      let contribution = 0;

      // 计算该钱包对各个类别预测的贡献
      for (const [category, prob] of Object.entries(prediction)) {
        const p = this.model.likelihood[category]?.[wallet] || this.model.metadata.smoothingFactor;
        contribution += prob * Math.log(p);
      }

      const walletData = this.model.walletIndex[wallet];

      contributions.push({
        wallet,
        contribution: Math.abs(contribution),
        trustScore: walletData?.trustScore || 0,
        dominantCategory: walletData?.dominantCategory || 'unknown'
      });
    }

    // 按贡献排序，返回前5个
    return contributions
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 5)
      .map(w => ({
        address: w.wallet,
        influence: Math.round(w.contribution * 100) / 100,
        trustScore: Math.round(w.trustScore * 100) / 100,
        dominantCategory: w.dominantCategory
      }));
  }

  /**
   * 获取模型信息
   */
  async getModelInfo() {
    if (!this.model) {
      await this.loadModel();
    }

    if (!this.model) {
      return { exists: false };
    }

    return {
      exists: true,
      modelId: this.model.modelId,
      version: this.model.version,
      createdAt: this.model.createdAt,
      updatedAt: this.model.updatedAt,
      stats: this.model.stats
    };
  }

  /**
   * 延迟函数
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 辅助函数：获取对象中的最大值
   */
  _maxObject(obj) {
    return Math.max(...Object.values(obj));
  }

  /**
   * 评估训练集准确率
   */
  async evaluateTrainingSet() {
    // 加载模型
    if (!this.model) {
      await this.loadModel();
    }

    if (!this.model || !this.model.trainingData) {
      throw new Error('模型不存在或没有训练数据');
    }

    const results = [];
    let correct = 0;
    let total = 0;
    const byCategory = {};

    for (const item of this.model.trainingData) {
      const { tokenAddress, category: trueCategory, wallets } = item;
      const traders = new Set(wallets);

      const prediction = this._predictWithWallets(tokenAddress, traders);
      const isCorrect = trueCategory === prediction.predictedCategory;

      if (isCorrect) correct++;
      total++;

      if (!byCategory[trueCategory]) {
        byCategory[trueCategory] = { correct: 0, total: 0 };
      }
      if (isCorrect) byCategory[trueCategory].correct++;
      byCategory[trueCategory].total++;

      results.push({
        tokenAddress,
        tokenSymbol: item.tokenSymbol,
        trueCategory,
        predictedCategory: prediction.predictedCategory,
        confidence: prediction.confidence,
        method: prediction.method,
        walletCount: prediction.walletCount,
        correct: isCorrect
      });
    }

    // 计算各类别准确率
    const categoryAccuracy = {};
    for (const [cat, stats] of Object.entries(byCategory)) {
      categoryAccuracy[cat] = {
        correct: stats.correct,
        total: stats.total,
        accuracy: stats.correct / stats.total
      };
    }

    return {
      overall: {
        correct,
        total,
        accuracy: correct / total
      },
      byCategory: categoryAccuracy,
      results: results.slice(0, 100)  // 返回前100个结果
    };
  }
}

module.exports = { BayesModelService };
