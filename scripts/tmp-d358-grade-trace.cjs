// 一次性：D3.58 定向对拍后八票 grade 版本轨迹甄别
// 目的：分辨 CD161/162/167/169/179 漂移是 D3.58 引起还是 Jev 既有方差
const { dbManager } = require('../src/services/dbManager.js');

const CASES = [
  ['CD160', '0xf5e642bc79bd3dff16bb02794c6854933bb57777', 17, 'cheat'],
  ['CD161', '0xbe0d62b9a00a9ca8ba917a3f790c25af68cb7777', 16, 'unhealthy'],
  ['CD162', '0x0c3c88345196b05d8c75a9a2dc0b2f2be07d7777', 19, 'healthy'],
  ['CD163', '0xc0a62abacfbe8b80f1650e14f5b0c092347b7777', 86, 'unhealthy'],
  ['CD167', '0xe931945a412fee281789bb495434eb61deae7777', 25, 'healthy'],
  ['CD169', '0x65a4c2da0aa16945cdf610c012d71c5906017777', 25, 'healthy'],
  ['CD179', '0x040b6766346b465b2a8403ecfd2bdfb9ffe07777', 20, 'unhealthy'],
  ['CD183', '0xdee305bcd072340779c7d30978c4bcdbd2367777', 54, 'unclear(待裁)'],
];

async function main() {
  const client = await dbManager.getClient();
  const { data: probe } = await client.from('cheat_detection').select('*').eq('token_address', CASES[7][1]).limit(1);
  const cols = probe && probe[0] ? Object.keys(probe[0]) : [];
  console.log('列名:', cols.join(', '));
  const verCol = cols.find(c => /question_version/i.test(c)) || 'question_version';
  const gradeCol = cols.find(c => /^grade$/i.test(c));
  const reasonCol = cols.find(c => /grade_reasons/i.test(c));
  const anchorCol = cols.find(c => /anchor.*tick|tick.*count/i.test(c));
  const createdCol = cols.find(c => /created_at/i.test(c));
  console.log(`选用: ver=${verCol} grade=${gradeCol} reasons=${reasonCol} anchor=${anchorCol} created=${createdCol}\n`);

  for (const [cid, addr, fxAnchor, expect] of CASES) {
    // 大表坑：token_address 无索引 → id 探针窗+内存 filter 不适用（无 id 范围先验），直接 eq + 上限拉取，行数小（每票 <40）
    const { data: rows, error } = await client.from('cheat_detection')
      .select('*').eq('token_address', addr).limit(200);
    if (error) { console.log(cid, 'ERR', error.message); continue; }
    console.log(`▶ ${cid} ${addr.slice(0, 10)}…7777  fixtures锚=${fxAnchor} expect=${expect}  共 ${rows.length} 行`);
    for (const r of rows) {
      const t = (r[createdCol] || '').replace('T', ' ').slice(5, 19);
      const g = gradeCol ? r[gradeCol] : '(无grade列)';
      const reasons = reasonCol && r[reasonCol] ? JSON.stringify(r[reasonCol]).slice(0, 80) : '';
      const an = anchorCol ? r[anchorCol] : '';
      console.log(`   ${t}  v=${r[verCol]}  anchor=${an}  grade=${g}  ${reasons}`);
    }
    console.log('');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
