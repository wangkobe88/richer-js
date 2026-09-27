-- =====================================================================
-- flap 非 BNB 计价盘 quote→BNB 换算（2026-09-27）
--
-- 背景：flap 的 TokenQuoteSet 事件宣告 token 以非 BNB 币计价（QQQB/BNCB/
-- FXIon 等美股概念 meme quote 币，规模 ~10,971 个 token）——事件 postPrice 是
-- quote/token 价，原设计直接跳过不落 tick（保护 price_bnb 口径），导致整类
-- 代币零 ticks（0xcb975f49 笑笑牛案：wss_events 有 create+graduation、
-- ticks 0 行）。用户裁定：链上大量代币属此类，必须解决。
--
-- 落地：watcher 采集侧按 quote→BNB 实时汇率（PancakeSwap V2 quote/WBNB 池
-- reserves，TTL 30s + stale-while-revalidate 5min + 无池负缓存 60s）换算后
-- 落库，下游（FA/K线/引擎/回测）零改动。quote_token 列留换算溯源：
-- 该行 price_bnb/bnb_amount 是从哪种计价币换算来的（BNB 计价盘 NULL）。
-- 进程启动时回放最近 120min TokenQuoteSet 重建计价表（防冷启动错采）。
-- 历史 ~10,971 盘无法回填（WSS 不回放），仅新落 ticks 受益。
--
-- ⚠️ 部署顺序红线：本列必须先于新代码 watcher 重启执行——tick upsert 整对象
--   携带 quote_token 键，列不存在时 flap 全量 tick 写入失败（PGRST204）。
--
-- 幂等，可重复执行。
-- =====================================================================

ALTER TABLE wss_price_ticks ADD COLUMN IF NOT EXISTS quote_token text;

COMMENT ON COLUMN wss_price_ticks.quote_token IS
  'flap 非 BNB 计价盘的计价币地址（TokenQuoteSet 宣告）：该行 price_bnb/bnb_amount 已按 quote→BNB 实时汇率（PCS V2 quote/WBNB 池）换算；BNB 计价盘为 NULL';
