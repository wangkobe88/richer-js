-- 清理 token_narrative 表中重复的 token_address 并添加 unique constraint
-- 执行顺序：按步骤逐段执行，每步确认后再执行下一步

-- 步骤1: 查看当前有多少重复的 token_address
SELECT token_address, COUNT(*) as cnt
FROM token_narrative
GROUP BY token_address
HAVING COUNT(*) > 1
ORDER BY cnt DESC;

-- 步骤2: 删除重复记录（保留每组中 id 最大的那条 = 最新）
DELETE FROM token_narrative a
USING token_narrative b
WHERE a.token_address = b.token_address
  AND a.id < b.id;

-- 步骤3: 验证是否还有重复
SELECT token_address, COUNT(*) as cnt
FROM token_narrative
GROUP BY token_address
HAVING COUNT(*) > 1;

-- 步骤4: 添加 unique constraint（如果不存在）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'token_narrative_address_unique'
  ) THEN
    ALTER TABLE token_narrative
      ADD CONSTRAINT token_narrative_address_unique UNIQUE (token_address);
    RAISE NOTICE 'Added unique constraint token_narrative_address_unique';
  ELSE
    RAISE NOTICE 'Unique constraint already exists';
  END IF;
END $$;
