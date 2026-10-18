#!/usr/bin/env node
/**
 * 极强指纹边救援臂单测（2026-10-18 0x8e0f6784 镜像对案）——零 DB 零网络
 * （buildRoster 纯函数直接喂合成 pairs）。判据实现：scripts/shared/copy-roster-build.js。
 *
 * 事故现场形状（pair 缓存 10-02→10-16 实测）：0x8e0f6784 与 0x77ae5eac 同分钟
 * 注资双开 bot——co=1101 / even=1101（100% 等额）/ sellSync=1064（96.6%）/
 * laterA=laterB=0（永同块）。原 memberNeedsLeader 把这对镜像对剪掉（合格邻居各
 * 4 个、全非 leader；与 #1 leader 0xa440 的边 co=48<50）。组件级「孤立簇」判据
 * 实测不成立（所在分量 356 钱含 7 leader/142 现名单成员——0xaaeb 桥进大盘子），
 * 终版语义=边级：极强边两端收编 + 一跳卫星（rescueHops=1 默认）。
 *
 * 覆盖：
 *   A. 事故现场形状：镜像对 + 周边 3 钱包 → 救援收编（role=member，rescued
 *      标记，5 钱包全进——卫星经一跳收编）
 *   B. 无极强指纹（co 高但 even/sellSync 占比低）→ 照剪（救援要指纹强度）
 *   C. extremeCo 边界：co=199 不救 / co=200 救；extremeRatio 边界：even 恰达标救、
 *      差 1 不救；sellSync 臂独立成立
 *   D. leader 分量里的极强边照样救（0x8e0f 实情）；rescueHops=0 只收两端不收卫星
 *   E. 挂靠门原路径不受影响（member 连 leader 照进，无 rescued 标记）
 *   F. --no-orphan-rescue（orphanRescue:false）= 原行为 bit 一致（镜像对落榜）
 *   G. memberNeedsLeader=false → 无门无救援全员进（原语义不变，rescued 恒空）
 *   H. 聚合口径：followers=合格邻居数 / coTokens=max / laterBuys 按 w1/laterA、
 *      w2/laterB 归属（字典序，非时间序）
 *
 * 用法：node scripts/_test_copy_roster_orphan_rescue.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { buildRoster } = require(path.join(__dirname, 'shared', 'copy-roster-build.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

// 事故现场地址（真值引用，防占位符漂移）
const TGT = '0x8e0f6784f7b8fa6327943f9beaf041e3a983b086';
const MIR = '0x77ae5eac1fddd5043a2568415c7737d42615b072';
const AAEB = '0xaaeb59201a1258a41ab9d7d2a57859d6d26dbde7';
const E425 = '0x425edfccc825606bab15fd72f4ee315f2393086d';
const E956 = '0x95661d036bc79b20144b64b3e164b3347ee581c9';
const LEADER = '0x1111111111111111111111111111111111111111';
const OTHER_MEMBER = '0x2222222222222222222222222222222222222222';
const randW = () => '0x' + [...Array(40)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

// pair 键=字典序 join('|')（与 pass2 同口径）
const pk = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const P = (co, sellSync, even, laterA = 0, laterB = 0) => ({ co, sellSync, even, laterA, laterB });

// 正式名单参数（roster.json params 同款）
const FINAL = { coThr: 50, sellSyncThr: 5, evenThr: 10, minFollowers: 20, memberNeedsLeader: true,
  orphanRescue: true, extremeCo: 200, extremeRatio: 0.8 };

// ── 事故现场簇：镜像对（极强边）+ 周边 3 钱包（普通合格边，无 leader 桥）──
function incidentPairs() {
  const m = new Map();
  m.set(pk(TGT, MIR), P(1101, 1064, 1101, 0, 0));           // 极强指纹边（even/co=1.0）
  m.set(pk(TGT, AAEB), P(73, 12, 0, 0, 66));                // 普通合格边（co≥50+指纹）
  m.set(pk(TGT, E425), P(65, 50, 0, 0, 65));
  m.set(pk(TGT, E956), P(54, 28, 44, 0, 54));
  m.set(pk(MIR, AAEB), P(71, 12, 0, 0, 60));
  m.set(pk(MIR, E425), P(65, 49, 0, 0, 61));
  m.set(pk(MIR, E956), P(54, 28, 44, 0, 50));
  return m;
}

// ── leader 参照系：LEADER 带 20 个挂靠 member（原挂靠门路径）──
function leaderPairs(extra) {
  const m = extra || new Map();
  for (let i = 0; i < 20; i++) {
    const w = randW();
    m.set(pk(LEADER, w), P(80, 20, 0, 0, 80));
  }
  return m;
}

console.log('A. 事故现场形状：孤立镜像簇整簇收编');
check('镜像对+周边 3 钱包全进（5/5），role=member 带 rescued 标记', () => {
  const { wallets, rescued } = buildRoster(incidentPairs(), FINAL);
  const inList = new Set(wallets.map(w => w.address));
  for (const w of [TGT, MIR, AAEB, E425, E956]) assert.ok(inList.has(w), `${w} 应入名单`);
  assert.equal(wallets.filter(w => rescued.has(w.address)).length, 5, '救援恰好 5 个');
  for (const w of wallets.filter(x => rescued.has(x.address))) {
    assert.equal(w.role, 'member');
    assert.equal(w.rescued, true);
  }
});
check('聚合口径：TGT followers=4 coTokens=1101 syncedSells=1154 evenBuys=1145 laterBuys=65', () => {
  const { wallets } = buildRoster(incidentPairs(), FINAL);
  const t = wallets.find(w => w.address === TGT);
  assert.equal(t.followers, 4);
  assert.equal(t.coTokens, 1101);
  assert.equal(t.syncedSells, 1064 + 12 + 50 + 28);
  assert.equal(t.evenBuys, 1101 + 44);
  // laterBuys 归属按字典序：TGT=w2 的对（MIR/E425 前序）取 laterB——镜像对永同块
  // 计 0，E425 对 TGT 后买 65 次（实测同向：0x425e 案 laterA=0/laterB=65）
  assert.equal(t.laterBuys, 0 + 65);
});

console.log('B. 孤立但无极强指纹 → 照剪（救援要指纹强度）');
check('co=1101 但 even=100/sellSync=50（占比<0.8）→ 镜像对仍落榜', () => {
  const m = new Map([[pk(TGT, MIR), P(1101, 50, 100, 0, 0)]]);
  const { wallets, rescued } = buildRoster(m, FINAL);
  assert.equal(wallets.length, 0);
  assert.equal(rescued.size, 0);
});

console.log('C. 阈值边界');
check('co=199（<extremeCo）不救；co=200 且 even=160（恰 0.8）救', () => {
  const a = buildRoster(new Map([[pk(TGT, MIR), P(199, 199, 199, 0, 0)]]), FINAL);
  assert.equal(a.wallets.length, 0, 'co=199 不救');
  const b = buildRoster(new Map([[pk(TGT, MIR), P(200, 0, 160, 0, 0)]]), FINAL);
  assert.equal(b.wallets.length, 2, 'co=200 even=160（=co×0.8）救');
});
check('even=159（差 1）不救；sellSync 臂独立成立（even=0 sellSync=160 救）', () => {
  const a = buildRoster(new Map([[pk(TGT, MIR), P(200, 0, 159, 0, 0)]]), FINAL);
  assert.equal(a.wallets.length, 0);
  const b = buildRoster(new Map([[pk(TGT, MIR), P(200, 160, 0, 0, 0)]]), FINAL);
  assert.equal(b.wallets.length, 2);
});

console.log('D. leader 分量里的极强边照样救（0x8e0f 实情：分量 356 钱含 7 leader）');
check('极强边端点即使挂在 leader 大分量里也收编；rescueHops=1 卫星一并收编', () => {
  const X = '0x3333333333333333333333333333333333333333';
  const m = new Map();
  for (let i = 0; i < 20; i++) m.set(pk(LEADER, randW()), P(80, 20, 0, 0, 80)); // LEADER 20 邻居
  m.set(pk(X, LEADER), P(300, 250, 0, 0, 300));    // X 合格边连 leader → 挂靠进（非救援路径）
  m.set(pk(X, OTHER_MEMBER), P(500, 0, 500, 0, 0)); // X↔OTHER_MEMBER 极强镜像边
  const { wallets, rescued } = buildRoster(m, FINAL);
  const inList = new Set(wallets.map(w => w.address));
  assert.ok(inList.has(X), 'X 挂靠 leader 进');
  assert.ok(inList.has(OTHER_MEMBER), 'OTHER_MEMBER 经极强边救援进（hop=1 卫星）');
  assert.ok(rescued.has(OTHER_MEMBER) && rescued.has(X), '两端都入 rescued 集（X 同时是极强边端点，双路径入册）');
  assert.equal(wallets.find(w => w.address === X).rescued, true, 'X 非 leader 也带 rescued 标记');
});
check('rescueHops=0 → 只收极强边两端，卫星（普通合格边邻居）不收', () => {
  const X = '0x3333333333333333333333333333333333333333';
  const SAT = '0x4444444444444444444444444444444444444444';
  const m = new Map([[pk(X, SAT), P(65, 50, 0, 0, 65)]]);   // X↔SAT 普通合格边
  m.set(pk(X, OTHER_MEMBER), P(500, 0, 500, 0, 0));          // X↔OTHER_MEMBER 极强镜像边
  const { wallets } = buildRoster(m, { ...FINAL, rescueHops: 0 });
  const inList = new Set(wallets.map(w => w.address));
  assert.ok(inList.has(X) && inList.has(OTHER_MEMBER), '极强边两端收');
  assert.ok(!inList.has(SAT), '卫星 hop=0 不收');
});

console.log('E. 挂靠门原路径不受影响');
check('member 连 leader 照进、无 rescued 标记；leader 档不变', () => {
  const { wallets, rescued } = buildRoster(leaderPairs(), FINAL);
  const lead = wallets.find(w => w.address === LEADER);
  assert.ok(lead && lead.role === 'leader' && !lead.rescued);
  assert.equal(wallets.length, 21);
  assert.equal(rescued.size, 0);
  for (const w of wallets) assert.ok(!('rescued' in w));
});

console.log('F. orphanRescue:false = 原行为 bit 一致');
check('事故现场簇关闭救援臂 → 0 收录（复现落榜）+ leader 参照系 21 员不变', () => {
  const off = buildRoster(incidentPairs(), { ...FINAL, orphanRescue: false });
  assert.equal(off.wallets.length, 0);
  const off2 = buildRoster(leaderPairs(incidentPairs()), { ...FINAL, orphanRescue: false });
  assert.equal(off2.wallets.length, 21, 'leader+20 member，簇成员全剪');
});

console.log('G. memberNeedsLeader=false → 原语义不变');
check('无门全员进（簇也进但无 rescued 标记），rescued 恒空', () => {
  const { wallets, rescued } = buildRoster(leaderPairs(incidentPairs()), { ...FINAL, memberNeedsLeader: false });
  assert.equal(wallets.length, 26);
  assert.equal(rescued.size, 0);
  for (const w of wallets) assert.ok(!('rescued' in w));
});

console.log('H. laterA/laterB 归属');
check('字典序两端各自计 laterBuys（w1 取 laterA / w2 取 laterB）', () => {
  // MIR < TGT 字典序（'0x7'<'0x8'）→ w1=MIR w2=TGT：laterA=7 归 MIR、laterB=99 归 TGT
  const m = new Map([[pk(TGT, MIR), P(1101, 1064, 1101, 7, 99)]]);
  const { wallets } = buildRoster(m, FINAL);
  const t = wallets.find(w => w.address === TGT);
  const r = wallets.find(w => w.address === MIR);
  assert.equal(t.laterBuys, 99);
  assert.equal(r.laterBuys, 7);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
