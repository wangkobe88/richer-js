#!/usr/bin/env node
/**
 * 一次性脚本（182 跑）：JG-32d 建「B 形状 24 票」Case 集合——
 * create + addToken（自动入队串行复制链）+ 等待 _chain 完成 + 状态汇总。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { CaseCollectionService } = require('../src/web/services/CaseCollectionService');

const NAME = 'jg32c-B形状24票-首波清仓后波持有';
const TOKENS = [
  // w1003 (20)
  ['0xf38f48cfe9e84920e7de4d47823a0fba95a87777', 'JG-32c B 形状｜登天猫 +918%（唯一肥尾）'],
  ['0x988fd57771e0993500c736e032a0e944700c7777', 'JG-32c B 形状｜Greg −18.7/max222 A1∧B'],
  ['0x9c07ea66cbdc29c0e4d11b68ba597d5b20917777', 'JG-32c B 形状｜赵娜丽莎 −13.9/max164'],
  ['0xece9cd98e00ac9a56e3f7ab0e4d4df803e587777', 'JG-32c B 形状｜麦麦 −37.9/max145'],
  ['0x6fe44c149140f7827213fdeb9ca00d0c85397777', 'JG-32c B 形状｜AGI +13.2/max118 A1∧B'],
  ['0xd0451a539ce2d4321f72e7f1e91c65db8ed87777', 'JG-32c B 形状｜大祭司 −1.0/max90 A1∧B'],
  ['0xebbc6754c85e9af69f8939e77fc7cbc284ca7777', 'JG-32c B 形状｜MEME −17.4/max85 A1∧B'],
  ['0xcb1d32fadc28f1dda6a6a799d109396cbfda7777', 'JG-32c B 形状｜Taz +19.2/max63'],
  ['0x1d7d9f2c5480fe49b919c41d1c3952cd92f07777', 'JG-32c B 形状｜金额AI +0.3/max34 A1∧B'],
  ['0x3b2748dfab3c2bc9beab4666cb35af3193be7777', 'JG-32c B 形状｜丁真 −23.4/max33 后波持4 A1∧B'],
  ['0xa2b3b5a7a52595793b733e8eb4cc4bde5f797777', 'JG-32c B 形状｜뿌까 −8.5/max24 A1∧B'],
  ['0x995b32765ea74ab7b05b57789fb00c96e6407777', 'JG-32c B 形状｜牢大 −22.0/max23 后波持4'],
  ['0xcadc767df602ce53d42255cefbd8d8e63a747777', 'JG-32c B 形状｜模拟人生 +6.4/max18'],
  ['0x5c83f64b15e1b26e8890c5fa4e4e2c60089c7777', 'JG-32c B 形状｜大表鸽 −26.3/max7 后波持6'],
  ['0x2893a7961216a58ce2051dbd9cd4f2d515747777', 'JG-32c B 形状｜万锅共酱会 +4.5/max5（round6 搬运收割盘）'],
  ['0xa878e6d446f8906f98203662e595117eb0657777', 'JG-32c B 形状｜SI −14.6/max4 后波持3'],
  ['0x993816917954aa30b634a262f68c15d60db17777', 'JG-32c B 形状｜女大 −23.8/max2 A1∧B'],
  ['0x841b41f3f5266e2931fba12f841a2dbeea2d7777', 'JG-32c B 形状｜人生指南 −18.3/max0'],
  ['0x5316e94be2689e4feb4664c79aaf95c01c5d7777', 'JG-32c B 形状｜沫沫 0/max−2 A1∧B'],
  ['0xe2417e493d109f7d8ee9094ef45b104ffbae7777', 'JG-32c B 形状｜太和殿金像 −9.9/max−6 后波持3'],
  // w1019 (2)
  ['0x153f8335b1fcda68e459463a5899dd736fd27777', 'JG-32c B 形状｜QAFILA −1.2/max55 w1019'],
  ['0xa72df2039229d697abf15da34c515d28f3bb7777', 'JG-32c B 形状｜OON −7.8/max12 w1019 A1∧B'],
  // w1012 (1)
  ['0xe6765c897daecfecdd4687d49907828a1a2f7777', 'JG-32c B 形状｜黄鲸 0/max9 w1012'],
  // w1103 (1)
  ['0xf37fe6de269801669bdee0e6825a3df107267777', 'JG-32c B 形状｜驴党 −4.1/max13 w1103 A1∧B'],
];

(async () => {
  const svc = new CaseCollectionService();
  const existing = await svc.list();
  const hit = existing.find(c => c.name === NAME);
  let collId;
  if (hit) { console.log('集合已存在:', hit.id); collId = hit.id; }
  else {
    const created = await svc.create({ name: NAME, description: 'JG-32c B 形状四窗重放集（首波清仓∧后波持有，20/2/1/1）；用途=JG-32d 双臂回测验证活跃度拦截率' });
    collId = created.id;
    console.log('集合已建:', collId);
  }
  for (const [addr, note] of TOKENS) {
    try {
      await svc.addToken(collId, { tokenAddress: addr, note });
      console.log(`added ${addr.slice(0, 10)}…`);
    } catch (err) {
      console.log(`skip  ${addr.slice(0, 10)}…: [${err.status || 500}] ${err.message}`);
    }
  }
  console.log('等待串行复制链完成…');
  await svc._chain;
  const st = await svc.syncStatus(collId);
  console.log('汇总:', JSON.stringify(st.summary));
  for (const t of st.tokens) {
    console.log(`  ${t.tokenAddress} ${t.syncState} ticks=${t.tickCount} events=${t.eventCount}${t.syncError ? ' err=' + t.syncError : ''}`);
  }
  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
