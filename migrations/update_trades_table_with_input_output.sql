-- 更新 trades 表结构，参考 rich-js 的设计
-- 使用 input_currency/output_currency/input_amount/output_amount/unit_price 模式
-- 无需兼容旧数据，可以直接删除并重建

-- 1. 删除旧表（如果存在）
DROP TABLE IF EXISTS trades CASCADE;

-- 2. 创建新表（参考 rich-js 设计）
CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL,
    token_symbol VARCHAR(100) NOT NULL,
    token_address VARCHAR(255) NOT NULL,
    token_id VARCHAR(255),  -- NFT token_id (如果适用)
    trade_direction VARCHAR(10) NOT NULL CHECK (trade_direction IN ('buy', 'sell')),
    trade_status VARCHAR(50) DEFAULT 'pending',
    input_currency VARCHAR(50) NOT NULL,   -- 输入货币 (如 BNB, USDT, 代币符号)
    output_currency VARCHAR(50) NOT NULL,  -- 输出货币 (如 BNB, USDT, 代币符号)
    input_amount DECIMAL(38,18) NOT NULL,   -- 输入数量
    output_amount DECIMAL(38,18),           -- 输出数量
    unit_price DECIMAL(38,18),              -- 单价
    success BOOLEAN DEFAULT false,
    is_virtual_trade BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    executed_at TIMESTAMP WITH TIME ZONE,
    signal_id UUID,
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT trades_experiment_id_fkey FOREIGN KEY (experiment_id)
        REFERENCES experiments (id) ON DELETE CASCADE,
    CONSTRAINT trades_signal_id_fkey FOREIGN KEY (signal_id)
        REFERENCES strategy_signals (id) ON DELETE SET NULL
);

-- 3. 添加注释
COMMENT ON TABLE trades IS '交易记录表（虚拟和实盘）- 参考 rich-js 设计';
COMMENT ON COLUMN trades.id IS '交易唯一标识';
COMMENT ON COLUMN trades.experiment_id IS '实验ID';
COMMENT ON COLUMN trades.token_symbol IS '代币符号';
COMMENT ON COLUMN trades.token_address IS '代币地址';
COMMENT ON COLUMN trades.token_id IS 'NFT token_id (如果适用)';
COMMENT ON COLUMN trades.trade_direction IS '交易方向: buy 或 sell';
COMMENT ON COLUMN trades.trade_status IS '交易状态: pending, success, failed';
COMMENT ON COLUMN trades.input_currency IS '输入货币（如BNB买入时，代币卖出时）';
COMMENT ON COLUMN trades.output_currency IS '输出货币（如代币买入时，BNB卖出时）';
COMMENT ON COLUMN trades.input_amount IS '输入数量（花费的BNB或卖出的代币数量）';
COMMENT ON COLUMN trades.output_amount IS '输出数量（获得的代币或BNB数量）';
COMMENT ON COLUMN trades.unit_price IS '单价（每单位代币的主币价格）';
COMMENT ON COLUMN trades.success IS '是否成功';
COMMENT ON COLUMN trades.is_virtual_trade IS '是否为虚拟交易';
COMMENT ON COLUMN trades.created_at IS '记录创建时间';
COMMENT ON COLUMN trades.executed_at IS '交易执行时间';
COMMENT ON COLUMN trades.signal_id IS '关联的信号ID';
COMMENT ON COLUMN trades.metadata IS '附加元数据(JSON)';

-- 4. 创建索引
CREATE INDEX idx_trades_signal_id ON trades USING btree (signal_id);
CREATE INDEX idx_trades_signal_id_not_null ON trades USING btree (signal_id) WHERE signal_id IS NOT NULL;
CREATE INDEX idx_trades_experiment_id ON trades USING btree (experiment_id);
CREATE INDEX idx_trades_executed_at ON trades USING btree (executed_at);
CREATE INDEX idx_trades_token_address ON trades USING btree (token_address);
CREATE INDEX idx_trades_trade_status ON trades USING btree (trade_status);
CREATE INDEX idx_trades_trade_direction ON trades USING btree (trade_direction);
CREATE INDEX idx_trades_success ON trades USING btree (success);
