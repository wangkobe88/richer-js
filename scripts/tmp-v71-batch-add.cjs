// 一次性：v71 936e1bd9 信号票批量收录 fixtures（CD185 起，本地跑）
// 数据源=182 tmp-v71-signals-anchor.cjs 输出（生产首析锚对齐）；跳过已收录 0x15583fde(CD184)/0xdee305bc(CD183)
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, 'cheat-detection', 'fixtures.json');

// [addr, symbol, 信号数, 执行数, 首判锚, 首判grade]（按首信号时间序）
const ROWS = [
  ['0xecce9958ad06089a2dbea60fe62eecc723ce7777', '草台班子', 1, 0, 22, 'cheat'],
  ['0xa1a727addde617246889b30d50612da03dbc7777', '龙虾AI', 2, 1, 38, 'unhealthy'],
  ['0x47922a47421d10d3d23687fec49f6077bcfb7777', '暴力雪球', 3, 1, 28, 'unhealthy'],
  ['0xf71413b7ea770f4816c59a21cc5880851f587777', 'Go Brrr', 3, 0, 44, 'unhealthy'],
  ['0x21d6f024b8b9e14b88bc92895e1d3527fb4c7777', 'Go Brrr', 5, 0, 57, 'unhealthy'],
  ['0xdae106c89f2748a213c91c506ce8a8dcde5f7777', 'Go Brrrrr', 5, 0, 41, 'unhealthy'],
  ['0x4a9305db5ece1ebd9f16f715c206e8a088217777', 'Go Brrrrr', 5, 0, 89, 'unhealthy'],
  ['0xfff03181069d8ff12c02208c190297c8f0a67777', 'Go Brrrrr', 3, 0, 42, 'unhealthy'],
  ['0x0234a0e8b3801ba550b03df7678fbc8ad20a7777', 'GoBrrrrr', 1, 0, 19, 'unhealthy'],
  ['0x2ab2f64d4ca659f8458c358c13878c9a917b7777', 'Go Brrrrr', 3, 0, 24, 'unhealthy'],
  ['0x1dbb3d6b66a449ac7f3583f078dadd9af8ac7777', '树', 3, 0, 40, 'unhealthy'],
  ['0xf8c7760afb9b5a96383cfc59a819ca5259ae7777', '大树', 1, 0, 62, 'cheat'],
  ['0xc92a1f83ede8ceb4be7abb4823c83231408d7777', '币安大树', 1, 0, 39, 'cheat'],
  ['0x44c72166408e2dd903cf0775caa8dbdd77147777', 'EVER', 3, 0, 28, 'unhealthy'],
  ['0x5beb50dccf0de18bcdaea246a5fbdb07fd137777', 'zion', 1, 0, 22, 'cheat'],
  ['0x0b268c8043c3d2dc33d84442d49d9f4c26307777', '배고파 개구리', 5, 0, 30, 'unhealthy'],
  ['0x57be40642f0dcb7b1e6c4dfc6c07c89801497777', '吉羊', 1, 0, 29, 'unhealthy'],
  ['0x53fd3328d80b78a80ba62fab28ce4d8a56ed7777', '克롱', 1, 0, 27, 'cheat'],
  ['0x0f7c96238301d26ad5945038aeb5aed8567d7777', '크롱', 1, 0, 32, 'cheat'],
  ['0xdcb780fafb75ac89e8830a5b6a374564e0ae7777', '크롱', 1, 0, 26, 'cheat'],
  ['0x77adc3f4ec8ce25e0d4758ae4684b74984157777', '羊', 1, 0, 61, 'cheat'],
  ['0x458292a2bf037d3708100f7b55262e6e1a767777', '小兔得志', 1, 0, 31, 'cheat'],
  ['0x1fffe375f9a9d933ea5097494cf2e1536b867777', '小兔得志', 1, 0, 60, 'cheat'],
  ['0x25085fd257ef58d4c142cb6ff9f529dcdee37777', '불사조', 1, 0, 23, 'cheat'],
  ['0xa965bd00bbde5e2db8362c8ed6ab0ccafb7b7777', '불사조', 3, 0, 35, 'unhealthy'],
  ['0x2a05a1db973c45b7e13e75babe6212c38ae47777', '不死鸟', 4, 0, 58, 'unhealthy'],
  ['0x7c150e15daf77fcf769fa5ffe1daf1566b2d7777', '不死鸟', 1, 0, 17, 'unhealthy'],
  ['0x3c8b3f43bf2a79e5f08db7d3027c276c32367777', '袁熙', 1, 0, 29, 'unhealthy'],
  ['0xfb7612b67e5d560da47ceed60ad806170a4d7777', 'VETO', 1, 0, 21, 'cheat'],
  ['0x0b181cce72a864bdf0e46318add71ac83f5c7777', '猫咪天团', 1, 1, 19, 'healthy'],
  ['0xb47db73293380088a1d78fb5c51bf9038f217777', 'AGENTINE', 1, 1, 20, 'healthy'],
  ['0x6a67b09a42e556515d77eb5c984dcfdccab47777', 'CBF', 1, 0, 38, 'cheat'],
  ['0x373d1f36ebc48ed61b964e37aa82e4271c3a7777', 'HUSH', 1, 0, 20, 'cheat'],
  ['0x35266cd6089893cb07c2b420248c219c40df7777', '猴市', 1, 0, 44, 'unhealthy'],
  ['0x72064b6f3e46895070aeb4e4c7d94f272c027777', '压力猴', 1, 0, 24, 'cheat'],
  ['0x2af76ff61fdb764b86b18e90e28f4e1c0ff17777', 'flapfloat', 1, 0, 33, 'cheat'],
  ['0x23458c616a2888032419abb7d813e1e47bb17777', '雪梨', 1, 1, 22, 'healthy'],
  ['0x9fa9af094f52dbcb72a9e4b708b28be30aed7777', 'BWF', 4, 0, 40, 'unhealthy'],
  ['0x84c926614a7e1f3be9dff76407061fca0a4e7777', '地外旅人', 1, 0, 71, 'cheat'],
  ['0xf352a6a9170fd613207497ceb66f19d348907777', '宇宙旅行者', 1, 0, 42, 'cheat'],
  ['0x1192aee72fc59d4a2983f4eb6f8b01f549f27777', 'VETO', 1, 0, 26, 'cheat'],
  ['0x1a50b006110c4d40d39c69675f14cc0122af7777', 'CeBM', 1, 1, 32, 'healthy'],
  ['0xcb879a65cfc7cbc33318b87f87ba16dd7e167777', 'CeBM', 4, 1, 78, 'unhealthy'],
  ['0x726c041f854116be73bfc0b15c165c9df4467777', '全民BNB', 1, 0, 33, 'cheat'],
  ['0xa5c044225e889e4c053327909e4a9eaf12a17777', 'Pool', 1, 0, 26, 'cheat'],
  ['0xc2552607319deadeb0e77466e18299d4450b7777', '换币龙', 1, 0, 30, 'unhealthy'],
  ['0x40772383e4e59b8443257f715e0b2db3a2637777', '換幣龍', 1, 1, 26, 'healthy'],
  ['0xa22b31a47faa859ed0a3247615b5dcb9bc747777', 'Bee Monkey', 1, 0, 23, 'cheat'],
  ['0xfef60cdd3200d302c5f2d1ffaa2d8f93369e7777', 'ASEAL', 1, 0, 24, 'cheat'],
  ['0xa41f83d6e34752fc6251797a51dd9c8d88e47777', '恐龙抗狼', 1, 0, 33, 'cheat'],
  ['0x65a1490be5a17dc88d8a9a46d0b24b97842e8888', 'buy', 1, 0, 43, 'unhealthy'],
];

const doc = JSON.parse(fs.readFileSync(FIX, 'utf8'));
const have = new Set(doc.cases.map(c => c.addr));
let startId = Math.max(...doc.cases.map(c => Number(String(c.caseId).replace('CD', ''))));
let added = 0;
for (const [addr, symbol, n, exec, anchor, grade] of ROWS) {
  if (have.has(addr)) { console.log('跳过已收录', addr); continue; }
  startId += 1;
  const note = `v71 936e1bd9 信号收录（生产首析锚对齐 anchorTicks=${anchor}=cheat_detection 首判行；信号数 ${n}；执行 ${exec}；D3.57 基线生产首判 grade=${grade}）；expect 待对拍后裁定`;
  doc.cases.push({
    caseId: `CD${startId}`,
    symbol, addr, platform: 'flap',
    anchor: { tickCount: anchor },
    expect: { verdict: 'unclear' },
    note,
    addedAt: '2026-11-04',
    expectSince: '2026-11-04',
    expectBecause: `--add 基线快照（${note}）`,
  });
  added += 1;
}
const tmp = FIX + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
fs.renameSync(tmp, FIX);
console.log(`收录 ${added} 票（CD185..CD${startId}），fixtures 总数 ${doc.cases.length}`);
