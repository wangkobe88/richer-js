#!/usr/bin/env node
// 一次性：JG-7 备注同步金狗集合成员 note。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const NOTE = 'JG-7 creator 三位一体独控二波（2026-11-21）：creator 0x9d502f8c…8cfe 首块自买 0.75B（firstBlockBuyShare 99.25%）→ 61s 内自卖 0.708B、散户 7 钱包全清 → top1=creator 渣仓 100% 全流通唯一持有人+148s 死寂 → 同钱包 0.25B 再点火二波（混 9×0.110/3×0.198 等额捆绑簇）冲 +1200% 顶点即终局。唯一信号 14:05:54 被 FP26 尾段买力枯竭拒（判据真实拒得对）；二波 14:09:49→50 holdersExDust 3→5 与 curVs 20.4→31.6 同秒反向交叉错过 1 秒窗，此后位置门 ≤28.5 恒假全灭=不追高设计。不立法——「庄再入场」如何辨别难（用户裁定留档）。全档=docs/金狗Case集合台账.md JG-7。';

(async () => {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('case_collection_tokens')
    .update({ note: NOTE })
    .eq('collection_id', 'a8414632-7c24-4762-9253-c49bb0f53105')
    .eq('token_address', '0x1a0810861af30ed2b85ec2c195f36fb58fc97777')
    .select('token_address, note');
  if (error) throw new Error(error.message);
  console.log('已更新:', data[0].token_address, '\nnote=', data[0].note);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
