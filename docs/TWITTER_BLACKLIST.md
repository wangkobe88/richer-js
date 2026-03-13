# Twitter 黑名单功能

## 功能说明

Twitter 用户黑名单用于过滤特定用户的推文，这些推文将不计入推特因子统计。

## 黑名单用户

当前黑名单包含 **32个** 用户：

### 推广机器人 (4个)
| 用户名 | 粉丝 | 说明 |
|--------|------|------|
| `BscPulseAlerts` | 104 | 格式化推广：Quick Swap, Check Chart, Progress等 |
| `BscKOLScanner` | 177 | 推广：Just Popped on BSC等 |
| `AutorunSOL` | 1,058 | 推广机器人：🔔 New token! Check the ANALYSIS! (8个代币) |
| `LeekPony` | 2,585 | 推广机器人：🔥🔥🔥...格式化推广 (8个代币) |

### 警告机器人 (1个)
| 用户名 | 粉丝 | 说明 |
|--------|------|------|
| `LAOWAI6654088` | 174 | 诈骗警告：大量重复的⚠️诈骗推文 |

### 币圈活跃用户 (4个)
| 用户名 | 粉丝 | 代币数 | 说明 |
|--------|------|--------|------|
| `0xfacairiji` | 28,380 | 4 | 币圈KOL，涉及摇钱树、皮克斯、再不吃就老了、索隆 |
| `feibo03` | 36,094 | 4 | 大V，涉及龙虾股、Epic Fury、B小将、NERO |
| `Web3_GXFC` | 2,950 | 3 | 中V，涉及哥斯拉、万事币安、黄羊 |
| `mxi46636628` | 6,693 | 3 | 中V，涉及ninebot、懂个球、币安党 |

### 追踪机器人 (23个)
自动发布 "2 tracking addresses bought this token..." 格式的推文：

`devito33612`, `FrauMbahc`, `AynurJahn22666`, `AnneliesRua`, `kraushaarmz`, `GBudig68111`, `UnivprofB28462`, `SolveigBlo`, `KeudelRupp`, `OxanaDh`, `BrankoRadium`, `ReinhardtHhu`, `JasminHpa`, `mike1774232`, `ScJozefl`, `GieDoris45678`, `AntjeBeng`, `benthinjun`, `hartmann59676`, `IlonaSco`, `IrmengardDsx`, `MetaMbao`, `collins686952`

## 使用方式

### 1. 检查用户是否在黑名单

```javascript
const { isUserBlacklisted } = require('./src/utils/twitter-validation');

if (isUserBlacklisted('BscPulseAlerts')) {
  console.log('该用户在黑名单中');
}
```

### 2. 查看完整黑名单

```javascript
const { TWITTER_USER_BLACKLIST } = require('./src/utils/twitter-validation');

console.log(TWITTER_USER_BLACKLIST);
// 输出: ['BscPulseAlerts', 'LAOWAI6654088']
```

## 添加新用户到黑名单

编辑 `src/utils/twitter-validation/index.js` 文件，找到 `TWITTER_USER_BLACKLIST` 常量：

```javascript
const TWITTER_USER_BLACKLIST = [
  // ========== 推广机器人 ==========
  'BscPulseAlerts',
  '新用户名1',  // 添加新用户

  // ========== 警告机器人 ==========
  'LAOWAI6654088',
  '新用户名2',  // 添加新用户
];
```

## 影响的因子

过滤黑名单用户推文后，以下因子将减少：
- `twitterTotalResults` - 推文总数
- `twitterLikes` - 总点赞数
- `twitterRetweets` - 总转发数
- `twitterComments` - 总评论数
- `twitterFollowers` - 总粉丝数
- `twitterUniqueUsers` - 独立用户数
- `twitterVerifiedUsers` - 认证用户数

## 日志

当有推文被过滤时，会在控制台输出调试日志：

```
[Twitter黑名单] 过滤了 X 条推文 (来自 Y 个黑名单用户: user1, user2)
```

## 测试

运行测试脚本验证功能：

```bash
node test_blacklist.js
```

## 更新日志

- **2026-03-13**: 完整黑名单构建（32个）
  - 推广机器人: 4个 (BscPulseAlerts, BscKOLScanner, AutorunSOL, LeekPony)
  - 警告机器人: 1个 (LAOWAI6654088)
  - 追踪机器人: 23个 (自动发布"2 tracking addresses bought..."推文)
  - 币圈活跃用户: 4个 (0xfacairiji, feibo03, Web3_GXFC, mxi46636628)
