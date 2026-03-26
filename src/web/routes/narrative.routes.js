/**
 * 叙事分析API路由
 */

const express = require('express');
const router = express.Router();
const path = require('path');

// 动态导入ES模块
let NarrativeAnalyzer;

async function loadAnalyzer() {
  if (!NarrativeAnalyzer) {
    const module = await import('../../narrative/analyzer/NarrativeAnalyzer.mjs');
    NarrativeAnalyzer = module.NarrativeAnalyzer;
  }
  return NarrativeAnalyzer;
}

/**
 * POST /api/narrative/analyze
 * 分析代币叙事
 */
router.post('/analyze', async (req, res) => {
  try {
    const { address, ignoreExpired = false, ignoreCache = false } = req.body;

    if (!address) {
      return res.status(400).json({
        success: false,
        error: '请提供代币地址'
      });
    }

    const Analyzer = await loadAnalyzer();
    const result = await Analyzer.analyze(address, { ignoreExpired, ignoreCache });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('叙事分析失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/narrative/result/:address
 * 获取分析结果（不重新分析）
 */
router.get('/result/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { NarrativeRepository } = await import('../../narrative/db/NarrativeRepository.mjs');
    const Analyzer = await loadAnalyzer();

    const result = await NarrativeRepository.findByAddress(address);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: '未找到分析结果'
      });
    }

    // 使用formatResult格式化数据，与analyze接口保持一致
    const formattedResult = Analyzer.formatResult(result);

    res.json({
      success: true,
      data: formattedResult
    });
  } catch (error) {
    console.error('获取结果失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/narrative/list
 * 获取所有分析结果列表
 */
router.get('/list', async (req, res) => {
  try {
    const { category, limit = 50, offset = 0 } = req.query;
    const { NarrativeRepository } = await import('../../narrative/db/NarrativeRepository.mjs');

    const results = await NarrativeRepository.findAll({
      category,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('获取列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/narrative/reanalyze/:address
 * 重新分析代币（忽略缓存）
 */
router.post('/reanalyze/:address', async (req, res) => {
  // 设置服务器端超时（180秒，适应GLM-5等慢速模型）
  const timeout = 180000;
  const timeoutId = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        error: '请求超时，分析时间过长'
      });
    }
  }, timeout);

  try {
    const { address } = req.params;
    const { ignoreExpired = false } = req.body;
    const { NarrativeRepository } = await import('../../narrative/db/NarrativeRepository.mjs');

    // 先标记旧结果为无效
    await NarrativeRepository.save({
      token_address: address,
      is_valid: false
    });

    const Analyzer = await loadAnalyzer();
    const result = await Analyzer.analyze(address, { ignoreExpired });

    clearTimeout(timeoutId);

    if (!res.headersSent) {
      res.json({
        success: true,
        data: result
      });
    }
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('重新分析失败:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

module.exports = router;
