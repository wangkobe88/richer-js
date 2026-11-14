// 一次性 clone（2026-11-14）：bt-v111 → bt-v113（删 T133 低位滞涨撤离臂重跑）：
//   用户指令「在 5390bbfa 基础上，把卖出臂 currentVsLaunchPct > 40 AND currentVsLaunchPct <= 80
//   AND actTotalBnb < 0.1 删除，然后重新跑一轮回测」——验证 low-zone-stall-exit v1
//   在 btv111 窗口（11-02 12:00 ~ 11-03 14:58，27h v68 基底）的真实贡献。
//   config 唯一改动=删该卖腿 + libraryRefs 去 low-zone-stall-exit 条目（provenance 一致）；
//   其余（窗口/source/signalGateReal/maxTickRows/买腿 14 条 ladder v18/卡牌/门链配置）逐位不动。
// ⚠对比噪声源留痕：182 已部署 CD406（D3.70→D3.71 段定位 30s）——门链 sbw 判定面与 btv111
//   生产跑（D3.70）存在题集代差+run-to-run 方差，差值归因须对齐触发记录。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = '5390bbfa-0c86-48a2-b9e1-94537c54ac17'; // bt-v111

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  const cfg = JSON.parse(JSON.stringify(e.config));
  const sc = cfg.strategiesConfig;

  const TARGET = 'currentVsLaunchPct > 40 AND currentVsLaunchPct <= 80 AND actTotalBnb < 0.1';
  const before = sc.sellStrategies.length;
  const idx = sc.sellStrategies.findIndex((l) => (l.condition || '').trim() === TARGET);
  if (idx < 0) throw new Error('low-zone-stall-exit 腿定位失败');
  const removed = sc.sellStrategies.splice(idx, 1)[0];
  if (before !== 18 || sc.sellStrategies.length !== 17) throw new Error(`卖腿数断言失败：${before}→${sc.sellStrategies.length}`);
  if (sc.sellStrategies.some((l) => /actTotalBnb < 0\.1/.test(l.condition || '') && /currentVsLaunchPct > 40/.test(l.condition || '')))
    throw new Error('low-zone-stall-exit 残留断言失败');
  if (sc.buyStrategies.length !== 14) throw new Error(`买腿数断言失败：${sc.buyStrategies.length}`);
  if (cfg.backtest.signalGateReal !== true || cfg.backtest.sourceExperimentId !== '67803108-485a-4f1e-b300-a24061849d7d')
    throw new Error('回测段断言失败');
  if (cfg.backtest.startTime !== '2026-11-02T12:00:00Z' || cfg.backtest.maxTickRows !== 8000000)
    throw new Error('窗口断言失败');
  sc.libraryRefs = (sc.libraryRefs || []).filter((r) => r.name !== 'low-zone-stall-exit');
  if (sc.libraryRefs.length !== 6) throw new Error(`libraryRefs 断言失败：${sc.libraryRefs.length}`);
  cfg.description = 'bt-v113（2026-11-14 用户指令「把卖出臂 currentVsLaunchPct > 40 AND currentVsLaunchPct <= 80 AND actTotalBnb < 0.1 删除，重新跑一轮回测」）：bt-v111-kol-hold-v68base 克隆，唯一 config 改动=删 T133 低位滞涨撤离臂 low-zone-stall-exit v1（+libraryRefs 同步去除）；验证该臂在 btv111 窗口（11-02 12:00~11-03 14:58 27h v68 基底 KOL HOLD）的真实净贡献（方向待验：T133 立法假设=low 区 10s 窗成交枯竭滞涨死盘立即撤）。⚠对比噪声：182 已部署 CD406（D3.71 段定位 30s），门链 sbw 判定面与 btv111 生产跑（D3.70）存在代差。';

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v113-no-lowzone-stall-v68base',
    experiment_description: cfg.description,
    trading_mode: 'backtest',
    strategy_type: e.strategy_type,
    blockchain: e.blockchain,
    kline_type: e.kline_type,
    status: 'stopped',
    config: cfg,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error(ie.message);
  console.log('NEW_ID=' + row.id);
  console.log('removed leg:', JSON.stringify({ condition: removed.condition, cards: removed.cards, priority: removed.priority, bypass: removed.bypassDebounce }));
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
