/**
 * GMGN 路由事件订阅（sender 回查加速 2026-11-04，阶段 0b）
 *
 * 链上实证（旧窗口 24 笔 GMGN tx / 22 个不同 EOA，零例外）：GMGN 聚合路由
 * `0x1de460…4bc`（Verified TransparentUpgradeableProxy，implementation 开源）每笔
 * swap 在同一 tx 内自 emit 两条带 indexed 用户 EOA 的事件——
 *   Swap(address,address,address,uint256,uint256,(uint8,address,address,address,uint24,int24,address,bytes,address,bytes32)[])
 *     topic0=0x8619026a…（topics[1] 与 [2] 均=用户；data 带 amountIn/amountOut+完整路径）
 *   FeeCollected(address,address,uint256,uint256)
 *     topic0=0x205442d6…（topics[2]=用户；topics[1]=收费方——刻意不取）
 * tx.from 100% 出现在 topics ⇒ collector 订阅路由 logs → resolver 内存映射
 * txHash→user → GMGN 行（flap 成交 ~28.8%）sender 零 RPC 定值。
 *
 * 时序：同 tx 内 trade 事件（TokenBought/TokenPurchase）logIndex 小先到，路由
 * Swap 事件后 emit 晚到几十 ms——映射 miss 不等待，走块预取 join 兜底（互补）。
 *
 * 局限（刻意）：只覆盖 GMGN——其余聚合合约（0x9e69…/0xd36b…/0x3508…/0x1e0d…
 * 多用户复用实证）不在自己事件里带用户，订阅不可推广；它们由 sender-resolver
 * 块预取 join 无差别覆盖（与路由名单无关）。GMGN 升级换事件形状 → 映射命中率
 * 骤降（getStats 透出 routerMapHits），路径自动全量落回块预取，不掩盖问题。
 */

'use strict';

const GMGN_ROUTER_ADDRESS = '0x1de460f363af910f51726def188f9004276bf4bc';

// Swap(address,address,address,uint256,uint256,(V3 路径元组)[]) —— topics[1]/[2]=用户
const ROUTER_SWAP_TOPIC0 = '0x8619026a40d38bedb4002fe511cea4bc4a9b336710efe8f21a61869a7ee0f02a';
// FeeCollected(address,address,uint256,uint256) —— topics[2]=用户（topics[1]=收费方不取）
const ROUTER_FEE_TOPIC0 = '0x205442d60b70af1203d43cab62352c3b69b94f091be32fe683198057282b5c92';

/** eth_subscribe('logs') 订阅参数（topic0 白名单压流量——ANKR 按推送消息计费） */
const ROUTER_EVENT_SUBSCRIPTION = {
    address: [GMGN_ROUTER_ADDRESS],
    topics: [[ROUTER_SWAP_TOPIC0, ROUTER_FEE_TOPIC0]],
};

/**
 * 从路由事件 log 提取用户 EOA（32 字节 indexed topic 左填充 → 20 字节地址）。
 * @returns {{ txHash: string, users: string[] } | null} 非白名单 topic0/缺字段 → null
 */
function extractRouterEventUsers(log) {
    const topics = log && Array.isArray(log.topics) ? log.topics : null;
    if (!topics || !topics.length || !log.transactionHash) return null;
    const t0 = topics[0].toLowerCase();
    const addr = (topic) => '0x' + topic.slice(26).toLowerCase();
    const users = [];
    if (t0 === ROUTER_SWAP_TOPIC0) {
        if (topics[1]) users.push(addr(topics[1]));
        if (topics[2]) users.push(addr(topics[2]));
    } else if (t0 === ROUTER_FEE_TOPIC0) {
        if (topics[2]) users.push(addr(topics[2]));
    } else {
        return null; // 未知 topic0 不消费（fail-safe：绝不从 data 猜地址）
    }
    return users.length ? { txHash: log.transactionHash.toLowerCase(), users } : null;
}

module.exports = {
    GMGN_ROUTER_ADDRESS,
    ROUTER_SWAP_TOPIC0,
    ROUTER_FEE_TOPIC0,
    ROUTER_EVENT_SUBSCRIPTION,
    extractRouterEventUsers,
};
