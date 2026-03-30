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
 * GET /api/narrative/token/:address
 * 获取代币基础信息
 */
router.get('/token/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { NarrativeAnalyzer } = await import('../../narrative/analyzer/NarrativeAnalyzer.mjs');

    // 使用静态方法 fetchTokenData 获取代币数据
    const tokenData = await NarrativeAnalyzer.fetchTokenData(address);

    if (!tokenData) {
      return res.status(404).json({
        success: false,
        error: '代币不存在'
      });
    }

    // 从 raw_api_data 提取更多信息
    const rawData = tokenData.raw_api_data || {};
    const name = rawData.name || rawData.token_name || tokenData.symbol;

    res.json({
      success: true,
      data: {
        symbol: tokenData.token_symbol,
        name: name,
        address: address,
        icon: (name || tokenData.token_symbol || '?')[0]?.toUpperCase()
      }
    });
  } catch (error) {
    console.error('获取代币信息失败:', error);
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

    // 先标记旧结果为无效（仅更新 is_valid 字段）
    await NarrativeRepository.updateIsValid(address, false);

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

/**
 * GET /api/narrative/tasks
 * 获取任务列表（带分页和筛选）
 */
router.get('/tasks', async (req, res) => {
  try {
    const { NarrativeRepository } = await import('../../narrative/db/NarrativeRepository.mjs');
    const supabase = NarrativeRepository.getSupabase();

    const {
      status,
      page = 1,
      pageSize = 20,
      search = '',
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    // 构建查询
    let query = supabase
      .from('narrative_analysis_tasks')
      .select('*', { count: 'exact' });

    // 状态筛选
    if (status) {
      query = query.eq('status', status);
    }

    // 搜索（代币符号或地址）
    if (search) {
      query = query.or(`token_symbol.ilike.%${search}%,token_address.ilike.%${search}%`);
    }

    // 排序
    const validSortFields = ['created_at', 'priority', 'updated_at', 'token_symbol'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    query = query.order(sortField, { ascending: sortOrder === 'asc' });

    // 分页
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      success: true,
      data: data || [],
      pagination: {
        page: parseInt(page),
        pageSize: limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('获取任务列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/narrative/tasks/stats
 * 获取任务统计信息
 */
router.get('/tasks/stats', async (req, res) => {
  try {
    const { NarrativeRepository } = await import('../../narrative/db/NarrativeRepository.mjs');
    const supabase = NarrativeRepository.getSupabase();

    // 获取各状态的任务数量
    const { data: statusCounts, error } = await supabase
      .from('narrative_analysis_tasks')
      .select('status');

    if (error) throw error;

    const stats = {
      total: statusCounts.length,
      pending: 0,
      stage1_processing: 0,
      stage1_completed: 0,
      stage2_processing: 0,
      completed: 0,
      failed: 0
    };

    statusCounts.forEach(task => {
      if (stats.hasOwnProperty(task.status)) {
        stats[task.status]++;
      }
    });

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('获取任务统计失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/narrative/tasks/:id
 * 获取单个任务详情
 */
router.get('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { NarrativeRepository } = await import('../../narrative/db/NarrativeRepository.mjs');
    const supabase = NarrativeRepository.getSupabase();

    const { data, error } = await supabase
      .from('narrative_analysis_tasks')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: '任务不存在'
        });
      }
      throw error;
    }

    // 如果任务已完成，尝试获取关联的叙事分析结果
    let narrativeResult = null;
    if (data.status === 'completed' && data.narrative_id) {
      const { data: narrative } = await supabase
        .from('token_narrative')
        .select('*')
        .eq('id', data.narrative_id)
        .maybeSingle();

      if (narrative) {
        narrativeResult = narrative;
      }
    }

    res.json({
      success: true,
      data: {
        ...data,
        narrative: narrativeResult
      }
    });
  } catch (error) {
    console.error('获取任务详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/narrative/tasks/:id
 * 更新任务（优先级、状态等）
 */
router.put('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { priority, status } = req.body;

    const { NarrativeRepository } = await import('../../narrative/db/NarrativeRepository.mjs');
    const supabase = NarrativeRepository.getSupabase();

    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (priority !== undefined) {
      updateData.priority = parseInt(priority);
    }

    if (status !== undefined) {
      const validStatuses = ['pending', 'stage1_processing', 'stage1_completed', 'stage2_processing', 'completed', 'failed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: '无效的状态值'
        });
      }
      updateData.status = status;
    }

    const { data, error } = await supabase
      .from('narrative_analysis_tasks')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: '任务不存在'
        });
      }
      throw error;
    }

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('更新任务失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/narrative/tasks/:id/reset
 * 重置任务状态为 pending
 */
router.post('/tasks/:id/reset', async (req, res) => {
  try {
    const { id } = req.params;
    const { NarrativeRepository } = await import('../../narrative/db/NarrativeRepository.mjs');
    const supabase = NarrativeRepository.getSupabase();

    const { data, error } = await supabase
      .from('narrative_analysis_tasks')
      .update({
        status: 'pending',
        current_stage: 0,
        retry_count: 0,
        error_message: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: '任务不存在'
        });
      }
      throw error;
    }

    res.json({
      success: true,
      data,
      message: '任务已重置为 pending 状态'
    });
  } catch (error) {
    console.error('重置任务失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/narrative/tasks
 * 手动添加任务
 */
router.post('/tasks', async (req, res) => {
  try {
    const { tokenAddress, tokenSymbol, experimentId, priority = 50 } = req.body;

    if (!tokenAddress) {
      return res.status(400).json({
        success: false,
        error: '请提供代币地址'
      });
    }

    const { NarrativeRepository } = await import('../../narrative/db/NarrativeRepository.mjs');
    const supabase = NarrativeRepository.getSupabase();

    // 检查任务是否已存在
    const { data: existing } = await supabase
      .from('narrative_analysis_tasks')
      .select('id')
      .eq('token_address', tokenAddress)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        success: false,
        error: '该代币的叙事分析任务已存在',
        existingTaskId: existing.id
      });
    }

    // 如果没有提供代币符号，尝试获取
    let symbol = tokenSymbol;
    if (!symbol) {
      try {
        const { NarrativeAnalyzer } = await import('../../narrative/analyzer/NarrativeAnalyzer.mjs');
        const tokenData = await NarrativeAnalyzer.fetchTokenData(tokenAddress);
        if (tokenData) {
          symbol = tokenData.symbol;
        }
      } catch (e) {
        // 忽略获取代币信息失败
      }
    }

    // 创建任务
    const { data, error } = await supabase
      .from('narrative_analysis_tasks')
      .insert({
        token_address: tokenAddress.toLowerCase(),
        token_symbol: symbol || tokenAddress.substring(0, 6),
        status: 'pending',
        priority: parseInt(priority),
        triggered_by_experiment_id: experimentId || null,
        current_stage: 0,
        retry_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data,
      message: '任务已创建'
    });
  } catch (error) {
    console.error('创建任务失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/narrative/tasks/:id
 * 删除单个任务
 */
router.delete('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { NarrativeRepository } = await import('../../narrative/db/NarrativeRepository.mjs');
    const supabase = NarrativeRepository.getSupabase();

    const { error } = await supabase
      .from('narrative_analysis_tasks')
      .delete()
      .eq('id', id);

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: '任务不存在'
        });
      }
      throw error;
    }

    res.json({
      success: true,
      message: '任务已删除'
    });
  } catch (error) {
    console.error('删除任务失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/narrative/tasks/batch
 * 批量删除任务
 */
router.delete('/tasks/batch', async (req, res) => {
  try {
    const { taskIds } = req.body;

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请提供要删除的任务ID列表'
      });
    }

    const { NarrativeRepository } = await import('../../narrative/db/NarrativeRepository.mjs');
    const supabase = NarrativeRepository.getSupabase();

    const { error } = await supabase
      .from('narrative_analysis_tasks')
      .delete()
      .in('id', taskIds);

    if (error) throw error;

    res.json({
      success: true,
      message: `已删除 ${taskIds.length} 个任务`
    });
  } catch (error) {
    console.error('批量删除任务失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
