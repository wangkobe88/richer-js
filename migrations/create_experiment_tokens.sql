-- ============================================
-- 实验代币关联表
-- ============================================
-- 用途：记录每个实验处理过的代币及基本状态
--
-- 存储分工：
-- - experiment_tokens: 实验↔代币关系 + 基本状态
-- - trades: 交易详情（何时买卖、价格、数量）
-- - signals: 交易信号（触发策略、因子值）
-- - portfolio_snapshots: 持仓详情（数量、价值、盈亏）
-- ============================================

-- 创建实验代币表
CREATE TABLE IF NOT EXISTS experiment_tokens (
  -- 主键
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 关联实验
  experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,

  -- 代币标识
  token_address TEXT NOT NULL,
  token_symbol TEXT,
  blockchain TEXT NOT NULL,

  -- 基本信息
  discovered_at TIMESTAMP WITH TIME ZONE NOT NULL,  -- 首次发现时间
  status TEXT NOT NULL DEFAULT 'monitoring',  -- monitoring, bought, exited

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- 唯一约束：同一实验同一代币只能有一条记录
  CONSTRAINT experiment_tokens_unique UNIQUE (experiment_id, token_address)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_experiment_tokens_experiment_id ON experiment_tokens(experiment_id);
CREATE INDEX IF NOT EXISTS idx_experiment_tokens_status ON experiment_tokens(status);
CREATE INDEX IF NOT EXISTS idx_experiment_tokens_token_address ON experiment_tokens(token_address);

-- 添加注释
COMMENT ON TABLE experiment_tokens IS '实验代币关联表：记录每个实验处理过的代币';
COMMENT ON COLUMN experiment_tokens.id IS '主键ID';
COMMENT ON COLUMN experiment_tokens.experiment_id IS '实验ID，关联experiments表';
COMMENT ON COLUMN experiment_tokens.token_address IS '代币地址';
COMMENT ON COLUMN experiment_tokens.token_symbol IS '代币符号（如BTC、ETH）';
COMMENT ON COLUMN experiment_tokens.blockchain IS '区块链（bsc、solana等）';
COMMENT ON COLUMN experiment_tokens.discovered_at IS '首次发现时间（代币创建时间）';
COMMENT ON COLUMN experiment_tokens.status IS '状态：monitoring(监控中), bought(已买入), exited(已退出)';
COMMENT ON COLUMN experiment_tokens.created_at IS '记录创建时间';
COMMENT ON COLUMN experiment_tokens.updated_at IS '记录更新时间';

-- ============================================
-- 启用行级安全性（RLS）
-- ============================================

ALTER TABLE experiment_tokens ENABLE ROW LEVEL SECURITY;

-- 允许所有读取操作（可以根据需要调整）
CREATE POLICY "允许所有人读取实验代币" ON experiment_tokens
  FOR SELECT USING (true);

-- 允许所有插入和更新操作
CREATE POLICY "允许所有人写入实验代币" ON experiment_tokens
  FOR ALL USING (true);

-- ============================================
-- 创建触发器：自动更新 updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_experiment_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_experiment_tokens_updated_at
  BEFORE UPDATE ON experiment_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_experiment_tokens_updated_at();

-- ============================================
-- 示例查询
-- ============================================

-- 查询实验处理过的所有代币
-- SELECT token_symbol, status, discovered_at
-- FROM experiment_tokens
-- WHERE experiment_id = 'xxx'
-- ORDER BY discovered_at;

-- 统计买了多少个代币
-- SELECT COUNT(*) as bought_count
-- FROM experiment_tokens
-- WHERE experiment_id = 'xxx' AND status = 'bought';

-- 关联查询代币的交易记录
-- SELECT t.token_symbol, t.status, tr.*
-- FROM experiment_tokens t
-- LEFT JOIN trades tr ON tr.token_address = t.token_address
--   AND tr.experiment_id = t.experiment_id
-- WHERE t.experiment_id = 'xxx';
