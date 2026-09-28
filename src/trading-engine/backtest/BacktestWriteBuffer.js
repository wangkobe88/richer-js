/**
 * 回测批量写入缓冲区
 * 将信号、交易、快照的逐条 DB 写入改为每轮结束时批量 flush
 */

const BATCH_INSERT_LIMIT = 500;

class BacktestWriteBuffer {
  constructor(supabase, logger) {
    this._supabase = supabase;
    this._logger = logger;

    this._pendingSignalInserts = [];
    this._pendingTradeInserts = [];
    this._pendingSnapshotInserts = [];
    this._pendingSignalUpdates = []; // { signalId, updateData }
    this._pendingEarlyTradesInserts = [];
    this._pendingAnalysisInserts = []; // TPA token_position_analyses 行（回迁批 4；upsert 通道）
    this._pendingTokenInserts = [];           // experiment_tokens INSERT 行（P1-3）
    this._pendingTokenStatusUpdates = [];     // { experimentId, tokenAddress, status }（P1-3，按入队序重放）
  }

  /**
   * 添加信号插入记录
   * @param {Object} dbData - toDatabaseFormat() 的输出
   */
  addSignalInsert(dbData) {
    this._pendingSignalInserts.push(dbData);
  }

  /**
   * 添加交易插入记录
   * @param {Object} dbData - toDatabaseFormat() 的输出
   */
  addTradeInsert(dbData) {
    this._pendingTradeInserts.push(dbData);
  }

  /**
   * 添加快照插入记录
   * @param {Object} snapshotData
   */
  addSnapshotInsert(snapshotData) {
    this._pendingSnapshotInserts.push(snapshotData);
  }

  /**
   * 添加早期交易者缓存插入记录
   */
  addEarlyTradesInsert(dbData) {
    this._pendingEarlyTradesInserts.push(dbData);
  }

  /**
   * 添加 experiment_tokens INSERT 记录（P1-3，bc4f756e 性能案）：行形状由引擎侧
   * 构造（镜像 ExperimentDataService.saveToken 的字段组装；material_id 提取省略
   * ——回放 raw_api_data 无 URL 字段，提取恒 null）。flush 与其他 INSERT 同段并行
   */
  addTokenInsert(dbData) {
    this._pendingTokenInserts.push(dbData);
  }

  /**
   * 添加 token 状态更新（P1-3）：{ experimentId, tokenAddress, status }。
   * flush 末段按入队序串行重放（同 token 可能 monitoring→bought→sold→bought
   * 多轮迁移，乱序/并行会丢中间态）
   */
  addTokenStatusUpdate(entry) {
    this._pendingTokenStatusUpdates.push(entry);
  }

  /**
   * 添加 TPA 持仓分析落表记录（回迁批 4）：TPA._persist 经 persistSink 注入本通道，
   * flush 时批量 upsert token_position_analyses（onConflict 三列，防 --force 重跑撞
   * UNIQUE duplicate key）。决策路径不依赖落表（verdict/holding 因子在 _persist 前
   * 已内存生效），仅写库时机后移。
   */
  addAnalysisInsert(dbData) {
    this._pendingAnalysisInserts.push(dbData);
  }

  /**
   * 添加信号更新（替代逐条 _directUpdateSignal 的即时写入）
   * 同一个 signalId 的多次更新会被合并；update 的 metadata 与尚未 flush 的
   * insert 行 metadata 深合并（supabase update 整列覆盖，部分键会把 insert 时
   * 写入的 price/strategyId/strategyName 等丢掉）
   * @param {string} signalId
   * @param {Object} updateData
   */
  addSignalUpdate(signalId, updateData) {
    // 与 insert 缓冲中的原始 metadata 合并（update 键优先；toDatabaseFormat 的
    // metadata 恒为对象）
    if (updateData.metadata) {
      const insertRow = this._pendingSignalInserts.find(r => r.id === signalId);
      if (insertRow && insertRow.metadata) {
        const merged = { ...insertRow.metadata, ...updateData.metadata };
        insertRow.metadata = merged;
        updateData = { ...updateData, metadata: { ...merged } };
      }
    }

    const existing = this._pendingSignalUpdates.find(u => u.signalId === signalId);
    if (existing) {
      // 合并：新数据覆盖旧数据，metadata 深度合并
      if (updateData.metadata && existing.updateData.metadata) {
        existing.updateData = {
          ...existing.updateData,
          ...updateData,
          metadata: { ...existing.updateData.metadata, ...updateData.metadata }
        };
      } else {
        existing.updateData = { ...existing.updateData, ...updateData };
      }
    } else {
      this._pendingSignalUpdates.push({ signalId, updateData: { ...updateData } });
    }
  }

  /**
   * 获取待处理数量
   */
  get pendingCount() {
    return this._pendingSignalInserts.length
      + this._pendingTradeInserts.length
      + this._pendingSnapshotInserts.length
      + this._pendingSignalUpdates.length
      + this._pendingEarlyTradesInserts.length
      + this._pendingAnalysisInserts.length
      + this._pendingTokenInserts.length
      + this._pendingTokenStatusUpdates.length;
  }

  /**
   * 批量刷新所有缓冲数据到数据库
   * @param {string} experimentId - 用于日志
   * @returns {Promise<Object>} flush 结果统计
   */
  async flush(experimentId) {
    const stats = {
      signalsInserted: 0,
      tradesInserted: 0,
      snapshotsInserted: 0,
      signalsUpdated: 0,
      earlyTradesInserted: 0,
      analysesUpserted: 0,
      tokensInserted: 0,
      tokenStatusUpdated: 0,
      errors: []
    };

    // 第一阶段：信号先落库（trades.signal_id / early_participant_trades 外键引用
    // strategy_signals，并行发出时 trades 请求可能先到 → FK 23503 整批丢弃，
    // 降级单条也在同一竞态窗口内失败——必须等 signals INSERT 完成后再插其余）
    if (this._pendingSignalInserts.length > 0) {
      stats.signalsInserted = await this._batchInsert(
        'strategy_signals',
        this._pendingSignalInserts,
        experimentId
      );
    }

    // 第二阶段：其余 INSERT 并行执行（表间无外键依赖）
    const insertTasks = [];

    // 批量插入交易
    if (this._pendingTradeInserts.length > 0) {
      insertTasks.push(this._batchInsert(
        'trades',
        this._pendingTradeInserts,
        experimentId
      ).then(count => { stats.tradesInserted = count; }));
    }

    // 批量插入快照
    if (this._pendingSnapshotInserts.length > 0) {
      insertTasks.push(this._batchInsert(
        'portfolio_snapshots',
        this._pendingSnapshotInserts,
        experimentId
      ).then(count => { stats.snapshotsInserted = count; }));
    }

    // 批量插入早期交易者缓存
    if (this._pendingEarlyTradesInserts.length > 0) {
      insertTasks.push(this._batchInsert(
        'early_participant_trades',
        this._pendingEarlyTradesInserts,
        experimentId
      ).then(count => { stats.earlyTradesInserted = count; }));
    }

    // 批量 upsert TPA 持仓分析行（回迁批 4；与其他表无外键依赖，同段并行）
    if (this._pendingAnalysisInserts.length > 0) {
      insertTasks.push(this._batchUpsert(
        'token_position_analyses',
        this._pendingAnalysisInserts,
        'experiment_id,token_address,trigger_no',
        experimentId
      ).then(count => { stats.analysesUpserted = count; }));
    }

    // 批量插入 experiment_tokens 行（P1-3；experiment_id FK 指向早已存在的实验行，
    // 与其他表无依赖，同段并行；状态 UPDATE 在末段等 INSERT 完成后按序重放）
    if (this._pendingTokenInserts.length > 0) {
      insertTasks.push(this._batchInsert(
        'experiment_tokens',
        this._pendingTokenInserts,
        experimentId
      ).then(count => { stats.tokensInserted = count; }));
    }

    await Promise.all(insertTasks);

    // 第三阶段：信号更新（必须等 INSERT 完成，否则 UPDATE 找不到记录）
    if (this._pendingSignalUpdates.length > 0) {
      const count = await this._batchSignalUpdates(experimentId);
      stats.signalsUpdated = count;
    }

    // 第四阶段：token 状态更新——按入队序串行重放（同 token 多轮迁移保序；
    // 且必须等 experiment_tokens INSERT 落地，否则 UPDATE 空匹配）
    if (this._pendingTokenStatusUpdates.length > 0) {
      stats.tokenStatusUpdated = await this._batchTokenStatusUpdates(experimentId);
    }

    // 清空缓冲区
    this._pendingSignalInserts = [];
    this._pendingTradeInserts = [];
    this._pendingSnapshotInserts = [];
    this._pendingSignalUpdates = [];
    this._pendingEarlyTradesInserts = [];
    this._pendingAnalysisInserts = [];
    this._pendingTokenInserts = [];
    this._pendingTokenStatusUpdates = [];

    if (this._logger && (stats.signalsInserted || stats.tradesInserted || stats.snapshotsInserted || stats.signalsUpdated || stats.earlyTradesInserted || stats.analysesUpserted || stats.tokensInserted || stats.tokenStatusUpdated)) {
      this._logger.info(experimentId, 'BacktestWriteBuffer',
        `flush 完成 | signals=${stats.signalsInserted}, trades=${stats.tradesInserted}, snapshots=${stats.snapshotsInserted}, signalUpdates=${stats.signalsUpdated}, earlyTrades=${stats.earlyTradesInserted}, analyses=${stats.analysesUpserted}, tokens=${stats.tokensInserted}, tokenStatus=${stats.tokenStatusUpdated}`);
    }

    return stats;
  }

  /**
   * 分批 INSERT（Supabase 单次 INSERT 建议不超过 500 条）
   */
  async _batchInsert(table, records, experimentId) {
    let inserted = 0;
    for (let i = 0; i < records.length; i += BATCH_INSERT_LIMIT) {
      const batch = records.slice(i, i + BATCH_INSERT_LIMIT);
      const { error } = await this._supabase
        .from(table)
        .insert(batch);

      if (error) {
        const msg = `批量插入 ${table} 失败: ${error.message} (batch ${Math.floor(i / BATCH_INSERT_LIMIT) + 1})`;
        if (this._logger) {
          this._logger.error(experimentId, 'BacktestWriteBuffer', msg);
        }
        // 降级为逐条插入
        for (const record of batch) {
          const { error: singleError } = await this._supabase
            .from(table)
            .insert([record]);
          if (singleError) {
            if (this._logger) {
              this._logger.error(experimentId, 'BacktestWriteBuffer',
                `单条插入 ${table} 失败: ${singleError.message}, id=${record.id}`);
            }
          } else {
            inserted++;
          }
        }
      } else {
        inserted += batch.length;
      }
    }
    return inserted;
  }

  /**
   * token 状态更新按入队序串行重放（P1-3）：逐条 UPDATE（不可并行——同 token
   * monitoring→bought→sold→bought 多轮迁移，乱序会丢中间态/终态错乱；量级
   * ~每买卖轮 2 条，串行无性能压力）。失败仅记日志不中断（与直写路径的
   * updateTokenStatus 吞错返回 false 语义一致）
   */
  async _batchTokenStatusUpdates(experimentId) {
    let updated = 0;
    for (const u of this._pendingTokenStatusUpdates) {
      const { error } = await this._supabase
        .from('experiment_tokens')
        .update({ status: u.status, updated_at: new Date().toISOString() })
        .eq('experiment_id', u.experimentId)
        .eq('token_address', u.tokenAddress);
      if (error) {
        if (this._logger) {
          this._logger.error(experimentId, 'BacktestWriteBuffer',
            `token status UPDATE 失败: ${u.tokenAddress} → ${u.status}: ${error.message}`);
        }
      } else {
        updated++;
      }
    }
    return updated;
  }

  /**
   * 分批 UPSERT（回迁批 4，token_position_analyses 专用）：批级 3 次退避重试
   * （500ms×attempt，对抗 fetch failed 瞬断——supabase-js 网络错误整批丢弃），
   * 耗尽后降级逐条 upsert（定位坏行：好行仍写入，与 _batchInsert 降级语义一致）
   */
  async _batchUpsert(table, records, onConflict, experimentId, maxRetries = 3) {
    let upserted = 0;
    for (let i = 0; i < records.length; i += BATCH_INSERT_LIMIT) {
      const batch = records.slice(i, i + BATCH_INSERT_LIMIT);
      const batchNo = Math.floor(i / BATCH_INSERT_LIMIT) + 1;
      let lastError = null;
      let ok = false;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const { error } = await this._supabase
          .from(table)
          .upsert(batch, { onConflict });
        if (!error) { ok = true; break; }
        lastError = error;
        if (this._logger) {
          this._logger.error(experimentId, 'BacktestWriteBuffer',
            `批量 upsert ${table} 失败 (尝试 ${attempt}/${maxRetries}): ${error.message} (batch ${batchNo})`);
        }
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
      if (ok) {
        upserted += batch.length;
        continue;
      }
      // 重试耗尽 → 降级逐条（确定性 DB 错误在此定位坏行）
      if (this._logger) {
        this._logger.error(experimentId, 'BacktestWriteBuffer',
          `批量 upsert ${table} 重试耗尽，降级单条: ${lastError ? lastError.message : 'unknown'} (batch ${batchNo})`);
      }
      for (const record of batch) {
        const { error: singleError } = await this._supabase
          .from(table)
          .upsert([record], { onConflict });
        if (singleError) {
          if (this._logger) {
            this._logger.error(experimentId, 'BacktestWriteBuffer',
              `单条 upsert ${table} 失败: ${singleError.message}, token=${record.token_address}`);
          }
        } else {
          upserted++;
        }
      }
    }
    return upserted;
  }

  /**
   * 批量信号更新（并行）
   */
  async _batchSignalUpdates(experimentId) {
    let updated = 0;
    const updatePromises = this._pendingSignalUpdates.map(({ signalId, updateData }) => {
      return this._supabase
        .from('strategy_signals')
        .update(updateData)
        .eq('id', signalId)
        .then(({ error }) => {
          if (error) {
            if (this._logger) {
              this._logger.error(experimentId, 'BacktestWriteBuffer',
                `更新信号失败: ${error.message}, signalId=${signalId}`);
            }
          } else {
            updated++;
          }
        });
    });

    await Promise.all(updatePromises);
    return updated;
  }
}

module.exports = { BacktestWriteBuffer };
