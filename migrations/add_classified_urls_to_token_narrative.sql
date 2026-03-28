-- 添加 classified_urls 字段到 token_narrative 表
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS classified_urls JSONB;

COMMENT ON COLUMN token_narrative.classified_urls IS '分类后的URL列表：{twitter, weibo, youtube, tiktok, douyin, bilibili, github, amazon, telegram, discord, websites}';
