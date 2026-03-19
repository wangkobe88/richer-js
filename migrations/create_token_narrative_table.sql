-- 创建代币叙事分析表
CREATE TABLE IF NOT EXISTS token_narrative (
  -- 主键
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 代币基本信息
  token_address TEXT NOT NULL,
  token_symbol TEXT,
  platform TEXT DEFAULT 'fourmeme',
  blockchain TEXT DEFAULT 'bsc',

  -- 原始数据
  raw_api_data JSONB,

  -- 提取的结构化信息
  extracted_info JSONB,

  -- 推文信息
  twitter_info JSONB,

  -- LLM分析结果（分三块）
  llm_category TEXT,
  llm_raw_output JSONB,
  llm_summary JSONB,

  -- Prompt信息
  prompt_version TEXT DEFAULT 'V5.10',
  prompt_used TEXT,

  -- 元数据
  analysis_status TEXT DEFAULT 'pending',
  error_message TEXT,
  is_valid BOOLEAN DEFAULT true,

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  analyzed_at TIMESTAMP WITH TIME ZONE,

  -- 约束
  CONSTRAINT token_narrative_address_unique UNIQUE (token_address)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_token_narrative_symbol ON token_narrative(token_symbol);
CREATE INDEX IF NOT EXISTS idx_token_narrative_category ON token_narrative(llm_category);
CREATE INDEX IF NOT EXISTS idx_token_narrative_status ON token_narrative(analysis_status);
CREATE INDEX IF NOT EXISTS idx_token_narrative_created_at ON token_narrative(created_at DESC);

-- 添加注释
COMMENT ON TABLE token_narrative IS '代币叙事分析结果表';
COMMENT ON COLUMN token_narrative.token_address IS '代币地址（唯一）';
COMMENT ON COLUMN token_narrative.extracted_info IS '提取的结构化信息：{intro_en, intro_cn, website, twitter_url}';
COMMENT ON COLUMN token_narrative.twitter_info IS '推文信息：{text, author_name, created_at, tweet_id, metrics}';
COMMENT ON COLUMN token_narrative.llm_category IS 'LLM评级结论：high/mid/low/unrated';
COMMENT ON COLUMN token_narrative.llm_raw_output IS 'LLM原始输出（完整JSON）';
COMMENT ON COLUMN token_narrative.llm_summary IS 'LLM摘要信息：{total_score, credibility_score, virality_score, reasoning}';
COMMENT ON COLUMN token_narrative.is_valid IS '结果是否有效，用于重新分析';
