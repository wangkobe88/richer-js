// create-v71：克隆 v70 config + T113 pump-imbalance-exit 第四卖腿插位（idx4=T85 前）
const { dbManager } = require('../src/services/dbManager.js');
const V70 = 'f0898589-58f1-4101-a648-0dc9cad41f3a';
const COMMIT = process.argv.includes('--commit');

const T113_LEG = {
  cards: 'all',
  priority: 5,
  condition: 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90',
  cooldownSec: null,
  bypassDebounce: false,
  description: 'T113 pump 失衡全清臂（2026-11-04）：成交后 30s 若盘面仍单边买（自入场累计净买比 >= 90 = 卖占比 <= 5%）→ 全部清仓——无真实对手盘的机器推盘趁推着走，等来的是 CD165/166/175/181/182 五 pump 案的 20 分钟 -50%+ 形状。v70 13 票探针实证：入场后 30s 仍 100% 单边买的 6 票中 4 票 -7%~-37%（比特币银行 -37/蝴蝶喊单 -32/蝴蝶池 -27/共建共赢 -7 全亏），仅 2 票 +4%/+7% 微利；滚动窗载体 tradesNetBuyRatioShortWin 被入场前买潮污染接不住 → 专用自入场语义（FA sinceEntryNetBuyRatio=setBuyState 锚快照全史累计差值，补买轮各自重锚；入场后零交易 null 恒 false fail-closed 死盘归断流扫描/止损管）。与 FLAP世界/MAX 型入场即反转刻意分轨（该形状 D3.57 买侧拦截管）。插位 T85 超买止盈前=同刻全清先赢；maxExecutions 不设（卖出失败每轮重试直到清仓）；bypass=false 走 3.5s+5tick 双门确认；回测差值口径 asOf 无关天然兼容。详档 docs/交易策略改进与Case台账.md T113'
};

async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('*').eq('id', V70).limit(1);
  const v70 = exps[0];
  const cfg = JSON.parse(JSON.stringify(v70.config));
  const sell = cfg.strategiesConfig.sellStrategies;

  // 防呆：T113 腿未在、插位点正确
  if (sell.some(l => (l.description || '').startsWith('T113'))) throw new Error('T113 腿已存在');
  const at = sell.findIndex(l => l.priority > 5 || (l.priority === 5 && (l.description || '').includes('T85')));
  if (at < 0) throw new Error('插位点未找到');
  sell.splice(at, 0, T113_LEG);

  cfg.strategiesConfig.libraryRefs.push({
    name: 'pump-imbalance-exit', side: 'sell',
    libId: '49862cfe-4bc5-409e-8917-9d8079c9f2cb', version: 1, legCount: 1,
    snapshotAt: new Date().toISOString(),
  });

  const NAME = 'v71-实盘-both-去叙事纯作弊门-D357-失衡臂';
  cfg.name = NAME;
  cfg.description = 'v71 克隆 v70（both live、buy-v2 v56+T112 调参、cheatCheck 双开、25 卖腿/卡牌/T110 节流不变）；新吃到 D3.53-D3.57 题集+T113 pump 失衡全清臂（成交后 30s 自入场净买比>=90 全清 p5）';

  console.log(`卖腿 ${sell.length} 条（v70 25+1）；插位 idx=${at}（p5 档 ${sell.filter(l => l.priority === 5).length} 条：`);
  sell.forEach((l, i) => { if (l.priority <= 5) console.log(`  ${i} p${l.priority} ${(l.description || '').slice(0, 30)}`); });
  console.log('libraryRefs:', cfg.strategiesConfig.libraryRefs.map(r => r.name + '@v' + r.version).join(', '));
  console.log('cheatCheck:', JSON.stringify((cfg.fourmemeWs || {}).cheatCheck));
  console.log('factorParams:', JSON.stringify((cfg.fourmemeWs || {}).factorParams));

  if (!COMMIT) { console.log('\n[dry] 未写库——加 --commit 执行 INSERT'); await dbManager.close?.(); return; }

  const id = require('crypto').randomUUID();
  const row = Object.assign({}, v70, { // 整行克隆保 NOT NULL 列（trading_mode 等）
    id, experiment_name: NAME, config: cfg,
    status: 'initializing',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  const { error } = await c.from('experiments').insert(row);
  if (error) throw error;
  console.log(`\n✅ v71 已建: ${id}`);
  await dbManager.close?.();
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
