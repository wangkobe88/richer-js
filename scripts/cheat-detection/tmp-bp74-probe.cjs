// 一次性（182 跑）：BP74 对拍保护组锚定位——列出每票全部 BUY 行的生产 entry/pat 判读，找 crash 判定锚。
const { dbManager } = require('../../src/services/dbManager.js');
const V101 = 'bbd6e464-f8db-46c3-93b4-6638e53d72dc';
const V100 = '11fc182a-b051-4665-857c-5c14e6713334';
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const TOKS = [
  ['f485', V94, '0xf485ec1d518185e73ca53164ddaa85dcfde77777'],
  ['40a2', V94, '0x40a2e8f5ceb8ee6aec025512596b9ffaaa954444'],
  ['a813', V95, '0xa813cd684ce664d2dcde26797246e3b4ffd37777'],
  ['苹果SI', V100, '0xc9bf4530033f6497002d228296fedb45036f7777'],
  ['LOVE', V100, '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777'],
  ['赵公主', V100, '0x258e485725b8d799b885b9f079241e2c812d7777'],
  ['币安之心', V100, '0x08aa150d7d86c4a0dfa37f310c1380de9c187777'],
  ['蝴蝶', V100, '0xb359716d1affde1fb9d351fec71a0f2e79257777'],
  ['屎壳郎', V100, '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777'],
  ['a8e70', V95, '0xa8e70ca07b68a07683c963513a26f2fa91647777'],
  ['米', V95, '0x338a510c6c7abd4c714d74225086542270427777'],
  ['施工鸭', V95, '0x459f1d098437fad48931372f9b16b6ad25297777'],
];
async function main() {
  const client = await dbManager.getClient();
  for (const [name, exp, addr] of TOKS) {
    const { data: sigs } = await client.from('strategy_signals')
      .select('id,created_at,metadata').eq('experiment_id', exp).eq('signal_type', 'BUY')
      .eq('token_address', addr).order('created_at', { ascending: true }).limit(60);
    console.log(`\n== ${name} (${(sigs || []).length} BUY) ==`);
    for (const s of sigs || []) {
      const bp = s.metadata && s.metadata.buyPoint;
      if (!bp) { console.log(`${s.created_at.slice(11, 19)} (无bp)`); continue; }
      const a = bp.assessment || {}, d = bp.dimensions || {};
      const e = d.entry_shape || {}, p = d.market_pattern || {};
      console.log(`${s.created_at.slice(11, 19)} 综=${a.bucket}(${a.rule}) entry=${e.bucket}(${e.prob != null ? Number(e.prob).toFixed(2) : '?'}) pat=${p.bucket}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
