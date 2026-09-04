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
      + this._pendingEarlyTradesInserts.length;
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
      errors: []
    };

    // 第一阶段：所有 INSERT 并行执行
    const insertTasks = [];

    // 批量插入信号
    if (this._pendingSignalInserts.length > 0) {
      insertTasks.push(this._batchInsert(
        'strategy_signals',
        this._pendingSignalInserts,
        experimentId
      ).then(count => { stats.signalsInserted = count; }));
    }

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

    await Promise.all(insertTasks);

    // 第二阶段：信号更新（必须等 INSERT 完成，否则 UPDATE 找不到记录）
    if (this._pendingSignalUpdates.length > 0) {
      const count = await this._batchSignalUpdates(experimentId);
      stats.signalsUpdated = count;
    }

    // 清空缓冲区
    this._pendingSignalInserts = [];
    this._pendingTradeInserts = [];
    this._pendingSnapshotInserts = [];
    this._pendingSignalUpdates = [];
    this._pendingEarlyTradesInserts = [];

    if (this._logger && (stats.signalsInserted || stats.tradesInserted || stats.snapshotsInserted || stats.signalsUpdated || stats.earlyTradesInserted)) {
      this._logger.info(experimentId, 'BacktestWriteBuffer',
        `flush 完成 | signals=${stats.signalsInserted}, trades=${stats.tradesInserted}, snapshots=${stats.snapshotsInserted}, signalUpdates=${stats.signalsUpdated}, earlyTrades=${stats.earlyTradesInserted}`);
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
