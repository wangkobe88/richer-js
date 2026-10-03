import { readFileSync } from 'fs';
const sec = JSON.parse(readFileSync('/tmp/state-sections.json', 'utf8'));
const r2 = JSON.parse(readFileSync('/tmp/calib-j127-r2.json', 'utf8')).results;
const ctrl = JSON.parse(readFileSync('/tmp/calib-j125-ctrl.json', 'utf8')).results;
const RANK = { low: 1, mid: 2, high: 3 };
const byAddr = new Map();
for (const r of r2) if (!r.skip) byAddr.set(r.addr, { addr: r.addr, r2: r });
for (const r of ctrl) { const e = byAddr.get(r.addr); if (e && !r.skip) e.ctrl = r; }
const NONPERSIST = /网页内容|抖音|币安广场内容|微信公众号文章|笔记内容|小红书|YouTube|Instagram帖子|微博信息|表情包出处|重要账号背景信息|Website推文/;
const secBy = new Map(sec.map(s => [s.addr, s]));
const missTags = a => {
  const x = secBy.get(a);
  if (!x) return '❓无行';
  const hit = (x.sections || []).filter(s => NONPERSIST.test(s));
  return hit.length ? `⚠️缺节(${hit.join('/')})` : '✓纯推文';
};
const netDown = [], netUp = [];
for (const e of byAddr.values()) {
  if (!e.ctrl) continue;
  if (RANK[e.r2.newRating] < RANK[e.ctrl.newRating]) netDown.push(e);
  else if (RANK[e.r2.newRating] > RANK[e.ctrl.newRating]) netUp.push(e);
}
const fmt = e => `${e.r2.symbol} ${e.addr} ctrl=${e.ctrl.newRating}/${e.ctrl.newScore}→r2=${e.r2.newRating}/${e.r2.newScore} se=${e.r2.se ?? '-'} ${missTags(e.addr)}`;
console.log(`净降 ${netDown.length} · 净升 ${netUp.length}\n`);
console.log('── 净降票 ──'); for (const e of netDown) console.log(fmt(e));
console.log('\n── 净升票 ──'); for (const e of netUp) console.log(fmt(e));
const PROD = ['0x967e4a528c264529fe8d6d9773665a6357787777','0x70db4674c85e77cda99dc1154ac2cb7236327777','0xf645cacdef13ca5e01418441d81d321fa0a07777','0xf0355e9bbc8ae2de06b958237be626c2d6e17777','0xeeb7752ee078fe8cff8d19343ef7abe9a3627777','0x831974d3f612b715a2e2b931470c8c5ae8957767','0x17b36a94e93b8598fc2d25a7300810402ab77777','0xd797487150167ea4cb66ee9224e8296e434d7777','0xd00b91e94e1fe3917ffb854d17ac1c2031cb7777','0xd1ba4cf6d7571becaab74e93fd92e2713d6e7777','0xd0daf8f05ef9cbb3eb16cfa33d49336a92ca7777','0xc53500c470d97e09b990a91d2156def418707777','0x0aef115d92cc89b1aaa4f653a839aabb05787777','0x78d7082d38ab8f99c8b6362c4ab041e3cf677777','0xd9a0cea7d44d4c7d468c7a8612eb315b083877777','0x1c797191fba12bee7326b27341f74455f2da7777','0xd07a0ba2afb7a8b2add0715edd7880140fc17777','0x49ca1e62078ea1a80b7fcb96a13781f4bc0177777'];
const WIN = ['0xec16bb6976fdf303de24e9b0669e928f04a17777','0xbaa7427af7cef74a6ddb04aad9061dac1cc57777','0x7466248c7ed0d5e42b2f452ddda2bd179f527777','0xde3e6c39a304b69c606c67885bbff390ca427777','0x5f887384e49b8ccd3a17a32352fb64a4cd277777'];
console.log('\n── 产品簇 18 票 ──');
for (const a of PROD) { const e = byAddr.get(a); console.log(`${e?.r2?.symbol ?? '?'} ${a} ctrl=${e?.ctrl?.newRating ?? '?'}→r2=${e?.r2?.newRating ?? '?'} ${missTags(a)}`); }
console.log('\n── 对照赢 5 票 ──');
for (const a of WIN) { const e = byAddr.get(a); console.log(`${e?.r2?.symbol ?? '?'} ${a} ctrl=${e?.ctrl?.newRating ?? '?'}→r2=${e?.r2?.newRating ?? '?'} ${missTags(a)}`); }
// 全集缺节统计
const missAll = sec.filter(x => (x.sections || []).some(s => NONPERSIST.test(s)));
console.log(`\n全集：${sec.length} 票中缺节 ${missAll.length} 票`);
