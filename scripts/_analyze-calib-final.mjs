import { readFileSync } from 'fs';
const j = JSON.parse(readFileSync('/tmp/calib-j127-final.json', 'utf8'));
const rs = j.results.filter(r => !r.skip);
const BZ = ['0x4a674ed30cb3000cb53a77f2709a0e3f53e7777', '0xb4705a3509c58b8fba42cf8486e4073289277777', '0x1e5b6706808441f8b9337daf311c930c47347777', '0x7536fa09026a8b19fbe4f672d33b74161d717777', '0x5439b53495418c516e86a9307f1e15c6e4877777'];
console.log('── 币安5票 ──');
for (const a of BZ) {
  const r = rs.find(x => x.addr === a);
  console.log(r ? `${r.symbol} ${r.newRating}/${r.newScore} cat=${r.cat} mag=${r.mag} se=${r.se} fit=${r.fitMass}% ${r.bzExempt ? '币安豁免' : ''}` : a + ' 无行');
}
console.log('── 异常票细节 ──');
for (const a of ['0x40278f10acf21d0994b64a8bb287b7662a447777', '0x7466248c7ed0d5e42b2f452ddda2bd179f527777', '0xf2fca4cf09986e97220c2371e3184c91b4637777', '0x2fb77ad099f60c0fdb0a8301bf94c4a8d8ac7777', '0xcbd7852d45d660236c4f864797225d4f2df27777', '0x0aef115d92cc89b1aaa4f653a839aabb05787777']) {
  const r = rs.find(x => x.addr === a);
  console.log(JSON.stringify(r));
}
const flips = rs.filter(r => r.newRating === 'low' && r.oldRating === 'high');
const byBlk = {};
for (const f of flips) { const k = (f.blockReason || '无').slice(0, 24); byBlk[k] = (byBlk[k] || 0) + 1; }
console.log('── high→low 拦因分布 ──');
console.log(JSON.stringify(byBlk, null, 1));
console.log(`── stateSrc 交叉：flips 里重建 ${flips.filter(f => f.stateSrc === 'rebuilt').length} / 线上 ${flips.filter(f => f.stateSrc === 'online').length} ──`);
