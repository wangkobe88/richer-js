// btv111：拉黑票后续是否还有新信号（判定「拉黑是否阻断触发」）+ 0xe4fe 四信号后该票
// 在实验内的最后痕迹时间（本地小结果读取）
import { dbManager } from '../../src/services/dbManager.js';

const EXP = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
const c = await dbManager.getClient();

const sigs = [];
{
  let from = 0;
  for (;;) {
    const { data: page, error } = await c.from('strategy_signals')
      .select('id,token_address,created_at,reason,metadata')
      .eq('experiment_id', EXP)
      .order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    sigs.push(...page);
    if (page.length < 1000) break;
    from += 1000;
  }
}

console.log(`总信号 ${sigs.length}`);

// 1) 每票按时间序看 grade=cheat（拉黑硬拒）之后是否还有后续信号
const byToken = new Map();
for (const s of sigs) {
  if (!byToken.has(s.token_address)) byToken.set(s.token_address, []);
  byToken.get(s.token_address).push(s);
}
let blacklisted = 0, postBlackFired = 0;
const postCases = [];
for (const [addr, arr] of byToken) {
  const blackAt = arr.find(s => s.metadata?.cheatCheck?.status === 'blocked'
    || (s.reason || '').includes('cheat_blocked')
    || (s.reason || '').includes('拉黑'));
  // 拉黑硬拒：_cheatGateHardReject —— cheat 门 grade=cheat 即拉黑（unhealthy 只是拒不拉黑）
  const blackHard = arr.find(s => s.metadata?.cheatCheck?.grade === 'cheat');
  const marker = blackHard || blackAt;
  if (!marker) continue;
  blacklisted++;
  const after = arr.filter(s => new Date(s.created_at) > new Date(marker.created_at));
  if (after.length) {
    postBlackFired++;
    postCases.push({ addr, blackAt: marker.created_at, after: after.map(s => `${s.created_at} ${s.reason || ''}`) });
  }
}
console.log(`带 cheat 拉黑痕迹的票: ${blacklisted}，其中拉黑后又有新信号的票: ${postBlackFired}`);
for (const p of postCases.slice(0, 8)) {
  console.log(`\n${p.addr} 拉黑@${p.blackAt}`);
  for (const a of p.after.slice(0, 4)) console.log(`  之后: ${a}`);
}

// 2) 0xe4fe 四信号的 reason/metadata.cheatCheck.status 复核
const TARGET = '0xe4fe922f88c09cbe127cebfa25f84d2f00917777';
console.log(`\n== 0xe4fe 全部信号 ==`);
for (const s of byToken.get(TARGET) || []) {
  console.log(`#${s.id} ${s.created_at} reason=${s.reason}`);
  console.log(`  cheat.status=${s.metadata?.cheatCheck?.status} grade=${s.metadata?.cheatCheck?.grade} blocked=${s.metadata?.cheatCheck?.blocked}`);
}

// 3) 全实验信号 reason 分布（看拉黑拒的 reason 域长什么样）
const reasonDist = {};
for (const s of sigs) {
  const r = (s.reason || 'ok').split(/[（(]/)[0].trim();
  reasonDist[r] = (reasonDist[r] || 0) + 1;
}
console.log('\nreason 分布:', JSON.stringify(reasonDist, null, 0));
process.exit(0);
