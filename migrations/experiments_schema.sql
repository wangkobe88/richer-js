-- richer-js 实验引擎数据库表结构
-- 用于管理实验、信号、交易和运行时指标

-- 1. 创建实验表
CREATE TABLE IF NOT EXISTS experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_name VARCHAR(255) NOT NULL,
    experiment_description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'initializing',
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    trading_mode VARCHAR(20) NOT NULL CHECK (trading_mode IN ('virtual', 'live')),
    strategy_type VARCHAR(100) NOT NULL DEFAULT 'fourmeme_earlyreturn',
    blockchain VARCHAR(50) NOT NULL DEFAULT 'bsc',
    kline_type VARCHAR(20) NOT NULL DEFAULT '1m',
    started_at TIMESTAMP WITH TIME ZONE,
    stopped_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 为experiments表添加注释
COMMENT ON TABLE experiments IS '交易实验配置表';
COMMENT ON COLUMN experiments.id IS '实验唯一标识';
COMMENT ON COLUMN experiments.experiment_name IS '实验名称';
COMMENT ON COLUMN experiments.experiment_description IS '实验描述';
COMMENT ON COLUMN experiments.status IS '实验状态: initializing, running, completed, failed, stopped';
COMMENT ON COLUMN experiments.config IS '实验配置JSON';
COMMENT ON COLUMN experiments.trading_mode IS '交易模式: virtual(虚拟) 或 live(实盘)';
COMMENT ON COLUMN experiments.strategy_type IS '策略类型';
COMMENT ON COLUMN experiments.blockchain IS '区块链';
COMMENT ON COLUMN experiments.kline_type IS 'K线类型: 1m, 5m, 15m, 30m 等';
COMMENT ON COLUMN experiments.started_at IS '实验开始时间';
COMMENT ON COLUMN experiments.stopped_at IS '实验停止时间';
COMMENT ON COLUMN experiments.updated_at IS '配置最后更新时间，用于热重载检测';

-- 创建索引以优化查询性能
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
CREATE INDEX IF NOT EXISTS idx_experiments_trading_mode ON experiments(trading_mode);
CREATE INDEX IF NOT EXISTS idx_experiments_created_at ON experiments(created_at);
CREATE INDEX IF NOT EXISTS idx_experiments_updated_at ON experiments(updated_at);

-- 2. 创建策略信号表
CREATE TABLE IF NOT EXISTS strategy_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL,
    token_address VARCHAR(255) NOT NULL,
    token_symbol VARCHAR(100),
    chain VARCHAR(50),
    signal_type VARCHAR(50) NOT NULL CHECK (signal_type IN ('BUY', 'SELL')),
    action VARCHAR(50) NOT NULL CHECK (action IN ('buy', 'sell', 'hold')),
    confidence DECIMAL(5,2),
    reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_experiment_signals FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
);

COMMENT ON TABLE strategy_signals IS '策略信号记录表';
COMMENT ON COLUMN strategy_signals.experiment_id IS '实验ID';
COMMENT ON COLUMN strategy_signals.token_address IS '代币地址';
COMMENT ON COLUMN strategy_signals.token_symbol IS '代币符号';
COMMENT ON COLUMN strategy_signals.chain IS '区块链';
COMMENT ON COLUMN strategy_signals.signal_type IS '信号类型: BUY 或 SELL';
COMMENT ON COLUMN strategy_signals.action IS '执行动作: buy, sell, hold';
COMMENT ON COLUMN strategy_signals.confidence IS '置信度 0-100';
COMMENT ON COLUMN strategy_signals.reason IS '决策原因';
COMMENT ON COLUMN strategy_signals.metadata IS '附加元数据(JSON)';

CREATE INDEX IF NOT EXISTS idx_strategy_signals_experiment_id ON strategy_signals(experiment_id);
CREATE INDEX IF NOT EXISTS idx_strategy_signals_token_address ON strategy_signals(token_address);
CREATE INDEX IF NOT EXISTS idx_strategy_signals_created_at ON strategy_signals(created_at);
CREATE INDEX IF NOT EXISTS idx_strategy_signals_signal_type ON strategy_signals(signal_type);

-- 3. 创建交易记录表
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL,
    token_address VARCHAR(255) NOT NULL,
    token_symbol VARCHAR(100),
    chain VARCHAR(50),
    trade_type VARCHAR(20) NOT NULL CHECK (trade_type IN ('virtual', 'live')),
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('buy', 'sell')),
    amount DECIMAL(38,18),
    price DECIMAL(38,18),
    status VARCHAR(50) DEFAULT 'pending',
    success BOOLEAN,
    error_message TEXT,
    tx_hash TEXT,
    gas_used BIGINT,
    gas_price DECIMAL(38,18),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_experiment_trades FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
);

COMMENT ON TABLE trades IS '交易记录表（虚拟和实盘）';
COMMENT ON COLUMN trades.experiment_id IS '实验ID';
COMMENT ON COLUMN trades.token_address IS '代币地址';
COMMENT ON COLUMN trades.token_symbol IS '代币符号';
COMMENT ON COLUMN trades.chain IS '区块链';
COMMENT ON COLUMN trades.trade_type IS '交易类型: virtual(虚拟) 或 live(实盘)';
COMMENT ON COLUMN trades.direction IS '交易方向: buy 或 sell';
COMMENT ON COLUMN trades.amount IS '交易数量';
COMMENT ON COLUMN trades.price IS '交易价格';
COMMENT ON COLUMN trades.status IS '交易状态: pending, success, failed';
COMMENT ON COLUMN trades.success IS '是否成功';
COMMENT ON COLUMN trades.tx_hash IS '交易哈希（实盘）';
COMMENT ON COLUMN trades.gas_used IS 'Gas使用量（实盘）';
COMMENT ON COLUMN trades.gas_price IS 'Gas价格（实盘）';
COMMENT ON COLUMN trades.metadata IS '附加元数据(JSON)';

CREATE INDEX IF NOT EXISTS idx_trades_experiment_id ON trades(experiment_id);
CREATE INDEX IF NOT EXISTS idx_trades_token_address ON trades(token_address);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_trade_type ON trades(trade_type);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);

-- 4. 创建运行时指标表
CREATE TABLE IF NOT EXISTS runtime_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(38,18),
    metadata JSONB DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_experiment_metrics FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
);

COMMENT ON TABLE runtime_metrics IS '运行时指标表';
COMMENT ON COLUMN runtime_metrics.experiment_id IS '实验ID';
COMMENT ON COLUMN runtime_metrics.metric_name IS '指标名称';
COMMENT ON COLUMN runtime_metrics.metric_value IS '指标值';
COMMENT ON COLUMN runtime_metrics.metadata IS '附加元数据(JSON)';

CREATE INDEX IF NOT EXISTS idx_runtime_metrics_experiment_metric ON runtime_metrics(experiment_id, metric_name);
CREATE INDEX IF NOT EXISTS idx_runtime_metrics_recorded_at ON runtime_metrics(recorded_at);

-- 5. 创建更新触发器（自动更新 updated_at）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_experiments_updated_at
    BEFORE UPDATE ON experiments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 6. 创建视图：实验统计
CREATE OR REPLACE VIEW experiment_stats AS
SELECT
    e.id AS experiment_id,
    e.experiment_name,
    e.status,
    e.trading_mode,
    COUNT(DISTINCT s.id) AS total_signals,
    COUNT(DISTINCT CASE WHEN s.signal_type = 'BUY' THEN s.id END) AS buy_signals,
    COUNT(DISTINCT CASE WHEN s.signal_type = 'SELL' THEN s.id END) AS sell_signals,
    COUNT(DISTINCT t.id) AS total_trades,
    COUNT(DISTINCT CASE WHEN t.success = true THEN t.id END) AS successful_trades,
    COUNT(DISTINCT CASE WHEN t.trade_type = 'virtual' THEN t.id END) AS virtual_trades,
    COUNT(DISTINCT CASE WHEN t.trade_type = 'live' THEN t.id END) AS live_trades,
    e.created_at,
    e.started_at,
    e.stopped_at
FROM experiments e
LEFT JOIN strategy_signals s ON e.id = s.experiment_id
LEFT JOIN trades t ON e.id = t.experiment_id
GROUP BY e.id, e.experiment_name, e.status, e.trading_mode, e.created_at, e.started_at, e.stopped_at;

COMMENT ON VIEW experiment_stats IS '实验统计视图';
