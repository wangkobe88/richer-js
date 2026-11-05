/**
 * 聚合路由事件订阅（sender 回查加速：2026-11-04 阶段 0b GMGN 单源；2026-11-05 CD376 扩 5 源）
 *
 * 机制：collector 订阅路由合约 logs → 本模块纯函数提取用户 EOA → sender-resolver
 * 内存映射 txHash→user → 命中行 sender 零 RPC 定值（省 getBlock/getTransaction）。
 * 事件晚于同 tx trade 行（TokenBought/TokenPurchase）logIndex 小先到，路由事件后
 * emit 晚到几十 ms——映射 miss 不等待，走块预取 join 兜底（互补）。
 *
 * 源表（6 订阅址 / 7 topic0；实证方法=三平台池成交反查 receipt + tx.from 逐笔对拍，
 * GMGN 对照组方法有效性双验证；2026-11-05）：
 *   GMGN 0x1de460…f4bc  Swap/FeeCollected  topics[1][2]/[2]      22 EOA 零例外（11-04）
 *   3508 0x3508dc…372a  与 GMGN 完全同款   同槽位                8/8+6/6
 *   01a2 0x01a21c…6b54  三事件            topics[1]             6/6、4/4、1/1
 *   d36b 0xd36b6d…6deb  匿名 0x20efd6d5…  data word0（备 word3） 8/8+6/6
 *   296b 0x296b00…506a  同族同款          同上                  8/8+6/6
 *   5994 0x599481…4dec  前置合约（0x168303…72fa 的恒定 tx.to，11/11）
 *                         匿名 0x1bb43f2d…  data word2           11/11
 *
 * ⚠ 与 src/trading-engine/pre-check/aggregator-routers.js 的 AGGREGATOR_ROUTER_ADDRS
 * （9 址 trader 层识别清单，CD374）是两张语义不同的清单：本表=sender 层订阅源，
 * 彼表=trader_address 判聚合路由——**5994 前置中介不是 trader 层地址，不得加入彼表**。
 *
 * data kind 解码语义：匿名事件用户 EOA 钉在 data 固定字位，按候选序取首个过形状门的
 * word（高 12 字节全零 ∧ 低 20 字节非全零 ∧ 非 0xEeee…×40 原生哨兵——右对齐 20 字节
 * 地址的标准 ABI 形状）返回单用户。
 * 结构性弱点（CD376 留档）：topics 漂移=可观测 miss（命中率掉、自动落回块预取），
 * data 漂移到另一地址形状字=静默错值且命中率不掉——缓解=候选序按实证不变位收紧
 * （d36b/296b 刻意不取 word1/word2=tokenIn/tokenOut 槽位，两槽常态即地址形状）+
 * 上线抽查 + 周期复采样观察点（台账 CD376）。
 *
 * 负结果留档（2026-11-05 实证，订阅不可省 RPC，维持块预取 join 兜底）：
 *   0x9689992f…8341   自身两条匿名事件纯金额；tx 内带用户的全是 per-token 变量合约（无固定载体）
 *   0x9e698d36…f364   活跃但零事件（169 笔池成交 receipt 零 emit）
 *   0x90497450…34c06  单事件 3 indexed 无用户无 data
 *
 * 勘误（CD376）：2026-11-04 版头注「0x9e69…/0xd36b…/0x3508… 不在自己事件里带用户」
 * 被 2026-11-05 链上对拍推翻（3508 同款双事件同款槽位、d36b 匿名事件 data 带用户）——
 * 当时近窗采样未命中，教训=匿名事件先看 data 再下「不带用户」结论。
 */

'use strict';

const GMGN_ROUTER_ADDRESS = '0x1de460f363af910f51726def188f9004276bf4bc';

// Swap(address,address,address,uint256,uint256,(V3 路径元组)[]) —— topics[1]/[2]=用户
const ROUTER_SWAP_TOPIC0 = '0x8619026a40d38bedb4002fe511cea4bc4a9b336710efe8f21a61869a7ee0f02a';
// FeeCollected(address,address,uint256,uint256) —— topics[2]=用户（topics[1]=收费方不取）
const ROUTER_FEE_TOPIC0 = '0x205442d60b70af1203d43cab62352c3b69b94f091be32fe683198057282b5c92';

// ── CD376 扩录源（2026-11-05 链上实证，对拍采样数见头注） ──
const R3508_ROUTER_ADDRESS = '0x3508dca95a64c9378cb07ef6f40553a50905372a'; // 与 GMGN 同款双事件同槽位
const R01A2_ROUTER_ADDRESS = '0x01a21c857a3219991fba2b1a2824b1b758966b54'; // 三事件均 topics[1]=用户
const R01A2_EVT1_TOPIC0 = '0xb4ebd56706d27fa01a1b393765021ba216f704b12bb50a87bf257d3ba6cd7bdc';
const R01A2_EVT2_TOPIC0 = '0xb948f731b5e342e038ab722853f67007c439a74137633184c1d0513b21bf5a64';
const R01A2_EVT3_TOPIC0 = '0x21b6fec1f2802e62136bec4c68f458c7ca5573dbc108f9e80233f840f0ff1587';
const RD36B_ROUTER_ADDRESS = '0xd36b6d646ac6e23672e9eedec558164c7f2d6deb'; // 匿名事件 data 解码
const R296B_ROUTER_ADDRESS = '0x296b00198dc7ec3410e12da814d9267bb8df506a'; // 与 d36b 同族同款
// 匿名事件（d36b/296b 共用签名，双键查表防两址撞车）：
// data=[用户,tokenIn,tokenOut,receiver,amountIn,amountOut] —— word1/2 恒地址形状（token
// 槽位），候选序刻意只取 word0（用户实证主位）、word3（receiver 恒同 word0）
const ANON_SWAP_TOPIC0 = '0x20efd6d5195b7b50273f01cd79a27989255356f9f13293edc53ee142accfdb75';
// 0x168303…72fa 路由本体的恒定前置中介（tx.to 11/11）：data=[tokenIn,tokenOut,用户,amount,amountOut]
// —— word0 恒 0xEeee 原生哨兵（形状门显式排除）、word1=tokenOut 地址形状（候选序刻意跳过）
const FRONT5994_ADDRESS = '0x5994814f2c4040b863a0125a45de152a8c2a4dec';
const FRONT5994_TOPIC0 = '0x1bb43f2da90e35f7b0cf38521ca95a49e68eb42fac49924930a5bd73cdf7576c';

/** 源表：双键 (address 小写, topic0) → 解码 spec；两类 spec：
 *  {kind:'topics', slots:[…]}   indexed topic 左填充剥 20 字节地址，按 slots 序全取
 *  {kind:'data', words:[…]}     data 固定字位候选序，首个过形状门者单取 */
const ROUTER_EVENT_SPECS = {
    [GMGN_ROUTER_ADDRESS]: {
        [ROUTER_SWAP_TOPIC0]: { kind: 'topics', slots: [1, 2] },
        [ROUTER_FEE_TOPIC0]: { kind: 'topics', slots: [2] },
    },
    [R3508_ROUTER_ADDRESS]: {
        [ROUTER_SWAP_TOPIC0]: { kind: 'topics', slots: [1, 2] },
        [ROUTER_FEE_TOPIC0]: { kind: 'topics', slots: [2] },
    },
    [R01A2_ROUTER_ADDRESS]: {
        [R01A2_EVT1_TOPIC0]: { kind: 'topics', slots: [1] },
        [R01A2_EVT2_TOPIC0]: { kind: 'topics', slots: [1] },
        [R01A2_EVT3_TOPIC0]: { kind: 'topics', slots: [1] },
    },
    [RD36B_ROUTER_ADDRESS]: {
        [ANON_SWAP_TOPIC0]: { kind: 'data', words: [0, 3] },
    },
    [R296B_ROUTER_ADDRESS]: {
        [ANON_SWAP_TOPIC0]: { kind: 'data', words: [0, 3] },
    },
    [FRONT5994_ADDRESS]: {
        [FRONT5994_TOPIC0]: { kind: 'data', words: [2] },
    },
};

/** eth_subscribe('logs') 订阅源地址（GMGN 居首） */
const ROUTER_EVENT_SOURCE_ADDRS = [
    GMGN_ROUTER_ADDRESS,
    R3508_ROUTER_ADDRESS,
    R01A2_ROUTER_ADDRESS,
    RD36B_ROUTER_ADDRESS,
    R296B_ROUTER_ADDRESS,
    FRONT5994_ADDRESS,
];

/** topic0 白名单（压流量——ANKR 按推送消息计费；与 SPECS 值域一致由单测锁定） */
const ROUTER_EVENT_TOPIC0_WHITELIST = [
    ROUTER_SWAP_TOPIC0,
    ROUTER_FEE_TOPIC0,
    R01A2_EVT1_TOPIC0,
    R01A2_EVT2_TOPIC0,
    R01A2_EVT3_TOPIC0,
    ANON_SWAP_TOPIC0,
    FRONT5994_TOPIC0,
];

/** eth_subscribe('logs') 订阅参数（address 数组 × topics[0] 白名单各自 OR、跨字段 AND） */
const ROUTER_EVENT_SUBSCRIPTION = {
    address: ROUTER_EVENT_SOURCE_ADDRS,
    topics: [ROUTER_EVENT_TOPIC0_WHITELIST],
};

/** 取 data 第 i 个 32 字节 word（64 hex 裸串）；非 string / 长度不足 → null */
function _dataWordAt(data, i) {
    if (typeof data !== 'string' || !data.startsWith('0x')) return null;
    const start = 2 + i * 64;
    return data.length >= start + 64 ? data.slice(start, start + 64) : null;
}

/** 地址形状门（入参=64 hex 裸 word）：高 12 字节（24 hex）全零 ∧ 低 20 字节非全零
 *  ∧ 非 0xEeee…×40 原生哨兵（右对齐 20 字节地址的标准 ABI 形状） */
function _isAddressShapedWord(word) {
    if (typeof word !== 'string' || word.length !== 64) return false;
    const body = word.toLowerCase();
    if (body.slice(0, 24) !== '0'.repeat(24)) return false;
    const tail = body.slice(24);
    return tail !== '0'.repeat(40) && tail !== 'e'.repeat(40);
}

/**
 * 从路由事件 log 提取用户 EOA。
 * topics kind：按 spec.slots 序提取全部存在槽位（GMGN 输出与 2026-11-04 版逐位一致）。
 * data kind：候选序取首个过形状门的 word 返回单元素 users（多候选全返=last-write-wins
 * 静默覆盖 + 计数虚增，刻意否决）。
 * @returns {{ txHash: string, users: string[] } | null} 双键 (address,topic0) 未命中 /
 *   缺 address / 缺字段 → null（fail-safe：绝不冒充，缺 address 不回退单键防跨源撞车洞）
 */
function extractRouterEventUsers(log) {
    const topics = log && Array.isArray(log.topics) ? log.topics : null;
    if (!topics || !topics.length || !log.transactionHash) return null;
    if (typeof log.address !== 'string' || !log.address) return null;
    const byAddr = ROUTER_EVENT_SPECS[log.address.toLowerCase()];
    const spec = byAddr ? byAddr[topics[0].toLowerCase()] : null;
    if (!spec) return null; // 未知 (address, topic0) 组合不消费（绝不从 data 猜地址）
    const users = [];
    if (spec.kind === 'topics') {
        for (const slot of spec.slots) {
            if (topics[slot]) users.push('0x' + topics[slot].slice(26).toLowerCase());
        }
    } else {
        for (const w of spec.words) {
            const word = _dataWordAt(log.data, w);
            if (word && _isAddressShapedWord(word)) {
                users.push('0x' + word.slice(24).toLowerCase());
                break; // 首个过门即定（单用户）
            }
        }
    }
    return users.length ? { txHash: log.transactionHash.toLowerCase(), users } : null;
}

module.exports = {
    GMGN_ROUTER_ADDRESS,
    ROUTER_SWAP_TOPIC0,
    ROUTER_FEE_TOPIC0,
    ROUTER_EVENT_SOURCE_ADDRS,
    ROUTER_EVENT_TOPIC0_WHITELIST,
    ROUTER_EVENT_SPECS,
    ROUTER_EVENT_SUBSCRIPTION,
    extractRouterEventUsers,
};
