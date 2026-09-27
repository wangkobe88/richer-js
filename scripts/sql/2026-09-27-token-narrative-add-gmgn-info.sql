-- =====================================================================
-- x-0 案（C15/C17）：token_narrative 加 GMGN 风险字段（2026-09-27）
--
-- 背景：0xa5fd1f…（x-0）批量发币人伪装新项目——链上 creator 是 flap 工厂
-- （0x90497450，每次发币换新 EOA，链上 creator 发币史恒 1 绕过检测）+ 回收
-- handle 买粉（131 粉恰好卡进 prestage project 评级表 mid 带）骗过叙事门。
-- GMGN token info 的 dev 对象按推特维度归因：twitter_create_token_count=16
-- （serial issuer），holder 侧 wallet_tags_stat 76% bundler。
--
-- 落地：叙事直调语境（enrichSocialByGmgn，买门已 fire 才花 GMGN 配额）同次
-- getTokenInfo 带出 dev 风险字段，随叙事行落库（代币级全局缓存——后续轮次/
-- 其他实验/web 核查免费读取，优于 ExternalResourceCache 1d TTL）。
-- 因子消费：gmgnIssuerTokenCount / gmgnBundlerWalletRatio / gmgnRiskCovered
-- （preBuyCheckCondition，映射在 NarrativeDirectCaller.mapGmgnRiskFactors）。
--
-- ⚠️ 部署顺序红线：本列必须先于新代码进程重启执行——NarrativeRepository.save
--   的 record 常挂 gmgn_info 字段（null 也写），列不存在时全链路 upsert 报
--   PGRST204（narrative engine 队列 / web 路由一并崩）。
--
-- 幂等，可重复执行。
-- =====================================================================

ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS gmgn_info jsonb;

COMMENT ON COLUMN token_narrative.gmgn_info IS
  'GMGN dev 风险字段 { risk: { issuerTokenCount, creatorAddress, creatorTokenStatus, fundFrom, bundlerWallets, sniperWallets, freshWallets, topWallets, imageDupCount }, fetchedAt }——叙事直调语境（enrichSocialByGmgn）同次 getTokenInfo 带出，x-0 案 serial issuer 拦截因子源；缓存行缺字段时直调路径补调回写（updateGmgnInfo）';
