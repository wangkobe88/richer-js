-- wss_price_ticks 新列：真实交易发起者（tx.from）
-- 2026-09-30 0x1de460 公共路由案：flap TokenBought/TokenSold 与 four.meme
-- TokenPurchase/TokenSale 的 trader 参数是 msg.sender（合约直接调用者），经公共
-- 路由交易的行 trader_address 落的是 router 合约（全 flap 27.9% 行）——top1 买入
-- 集中度 / sniper 持仓 / TPA 钱包画像全被污染。sender_address = 反查
-- eth_getTransactionByHash(tx_hash) 的 tx.from（BSC 上恒为 EOA），由 watcher 侧
-- SenderResolver（src/collectors/sender-resolver.js）在新行落库时解析写入。
--
-- 语义：NULL = 未解析（resolver 未启用 / 反查耗尽 / 存量历史行）；
--       = trader_address 时即 EOA 直连（tx.from === msg.sender）。
-- 消费侧（top1/sniper/TPA/离线画像）本期不切，先积累数据做 sender vs trader 对拍。
--
-- ⚠️ 部署顺序红线（同 gmgn_info/token_category 先例）：列必须先于 watcher 进程
--    重启创建——upsert 遇缺列 PGRST204 全链路断。本脚本只加列不建索引（避免写
--    放大；消费侧切换时再议）。
-- 存量回填：暂缓（用户裁定先只做新数据）。

ALTER TABLE wss_price_ticks ADD COLUMN IF NOT EXISTS sender_address text NULL;

COMMENT ON COLUMN wss_price_ticks.sender_address IS '真实交易发起者 tx.from（BSC 恒 EOA）；NULL=未解析；等于 trader_address 即 EOA 直连。trader_address 是事件 msg.sender（公共路由场景=router 合约）';
