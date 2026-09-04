# four.meme TokenManager2 事件口径（Phase 0 实测验证）

验证时间：2026-09-04 · 脚本：`scripts/verify-fourmeme-events.js`（ankr WSS 真流 dry-run）
合约：TokenManager2 `0x5c952063c7fc8610FFDB798152D69F0B9550762b`（BSC）

## 关键结论

**所有事件均无 indexed 参数**——topics 只有 topic0（事件签名哈希），全部业务参数在 data 里按文档顺序 ABI 编码。

## 事件签名（实测确认）

### TokenCreate（代币创建，~11/min）
```js
// topic0 = 0x396d5e902b675b032348d3d2e9517ee8f0c4a926603fbc075d3d282ff00cad20
ethers.AbiCoder.defaultAbiCoder().decode(
  ['address',   // creator
   'address',   // token
   'uint256',   // requestId
   'string',    // name（中文正常）
   'string',    // symbol
   'uint256',   // totalSupply（18 decimals，常见 1e9 → raw 1e27）
   'uint256',   // launchTime —— ⚠ 实测恒为 0，不可用作代币年龄；用事件块时间
   'uint256'],  // launchFee —— ⚠ 实测恒为 0
  log.data)
```

### TokenPurchase / TokenSale（内盘买/卖，合计 ~58/min）
```js
// TokenPurchase topic0 = 0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942
// TokenSale     topic0 = 0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19
ethers.AbiCoder.defaultAbiCoder().decode(
  ['address',   // token
   'address',   // account（trader）
   'uint256',   // price —— 每 token 的 BNB 价（wei，18 decimals），直接可用，无需换算
   'uint256',   // amount —— token 数量（18 decimals）
   'uint256',   // cost —— BNB 计价总花费/所得（wei）
   'uint256',   // fee —— 恰为 cost 的 1%（four.meme 费率）
   'uint256',   // offers —— 曲线剩余可卖 token
   'uint256'],  // funds —— 曲线已募集 BNB（毕业进度参考）
  log.data)
```
实测校验：`price × amount ≈ cost`（差值 <0.2%）；`fee = cost × 1%`。

### LiquidityAdded（毕业加池）
```js
// topic0 = 0xc18aa71171b358b706fe3dd345299685ba21a5316c66ffa9e319268b033c44b0
['address', 'uint256', 'address', 'uint256']  // base, offers, quote, funds
// quote = address(0) 表示 BNB 计价；非零为 BEP20 计价
// ⚠ 低频事件，Phase 0 观察窗内未捕获样本；签名来自官方文档，collector 上线后自然验证
```

### TradeStop
```js
// topic0 = 0x8f9ab4bd7eff0d085f91575d50cd83f97aa5258e24ded7630d4fd6739e857132
['address']  // token
```

## 其他实测事实

- **事件速率**（观察窗 3 分钟）：TokenPurchase ~32/min、TokenSale ~26/min、TokenCreate ~11/min → 日 tick 量约 8.5 万行（批量写库完全可行）
- **未知伴随事件**：`0x48063b12...`（~32/min，32B data）与 `0x741ffc46...`（~26/min）与买卖事件数量一一对应（同 tx 伴随事件，候选签名未命中）。collector 安全忽略并计数。
- **newHeads**：BSC 当前 ~0.75s/块（Maxwell 后）；logs 无时间戳，需 newHeads 缓存 blockNumber→timestamp 回填 block_time
- **ankr WSS**：`wss://rpc.ankr.com/bsc/ws/<key>`，标准 `eth_subscribe`（logs / newHeads），订阅确认帧返回 subId，断开码 1005 观察过一次（重连机制必须）

## 采集器设计要点（已定）

1. tick 价格直接取事件 `price` 字段（BNB wei）→ `priceUsd = price × bnbUsd`
2. 代币创建时间 = TokenCreate 事件块时间（launchTime 字段恒 0 不可用）
3. 去重键 `(txHash, logIndex)`：同 tx 同事件类型可能有多条（多代币聚合交易）
4. 毕业 = LiquidityAdded；外盘交易不在本订阅内（发生在外部 AMM 合约）
