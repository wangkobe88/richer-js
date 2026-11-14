// 一次性 clone（2026-11-14）：bt-v113 → bt-v114（带上全部近期修改重跑）：
//   用户指令「请再次回测吧，把近期修改都带上」。bt-v113（38d91153，已完成 94 票
//   +1.1827）跑在 4380932d 代码上（=CD406 D3.71 + BP83 BP66 + 删 T133 low-zone-stall 臂）；
//   其启动后 182 又部署了两个近期修改，bt-v113 未吃到：
//   ① CD407（74af0e06/1e38c42b）burstWaveSeg 三键——CD401 臂审查对象收紧为「这一波
//      突然的流量」（Cashless 案：波簇 0.7411 一股未卖 vs 簇外获利盘卖 30.3% 贴线误拦）；
//   ② T138（c37ab2ee）launch 地板机制整体回退——launch 锚恒=平台常量（低开票
//      currentVsLaunchPct 回落 ~20pp，修复 28.5 价格门误拒）。
//   本克隆 config 逐位复制 bt-v113（删臂+HOLD=120s 均保持），唯一变量=182 代码
//   c37ab2ee（T138+CD407+CD406+BP83 全量）。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = '38d91153-7758-469e-a376-e748c3b3d63a'; // bt-v113

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (e.status !== 'completed') throw new Error('bt-v113 非终态: ' + e.status);
  const cfg = JSON.parse(JSON.stringify(e.config));
  const sc = cfg.strategiesConfig;
  // 断言：bt-v113 形状逐位继承（删臂版 17 卖腿 / 14 买腿 / 窗口与门链不变）
  if (sc.sellStrategies.length !== 17) throw new Error(`卖腿数断言失败：${sc.sellStrategies.length}`);
  if (sc.buyStrategies.length !== 14) throw new Error(`买腿数断言失败：${sc.buyStrategies.length}`);
  if (sc.sellStrategies.some((l) => /currentVsLaunchPct > 40/.test(l.condition || '') && /actTotalBnb < 0\.1/.test(l.condition || '')))
    throw new Error('low-zone-stall-exit 残留断言失败');
  if (cfg.backtest.signalGateReal !== true || cfg.backtest.sourceExperimentId !== '67803108-485a-4f1e-b300-a24061849d7d')
    throw new Error('回测段断言失败');
  if (cfg.backtest.startTime !== '2026-11-02T12:00:00Z' || cfg.backtest.maxTickRows !== 8000000)
    throw new Error('窗口断言失败');
  cfg.description = 'bt-v114（2026-11-14 用户指令「请再次回测吧，把近期修改都带上」）：bt-v113 克隆，config 逐位不动（删 T133 low-zone-stall-exit 臂+HOLD=120s 保持），唯一变量=182 代码 c37ab2ee——bt-v113（94 票 +1.1827）跑在 4380932d（CD406 D3.71+BP83 BP66）上，本跑新增两个近期修改：CD407 burstWaveSeg 三键（CD401 臂审查对象收紧为 burst 流量簇，Cashless 0xbcb72829 案）+T138 launch 地板回退（launch 锚恒=平台常量，低开票 curVs 回落 ~20pp 修复 28.5 价格门误拒）。对照链：bt-v111（91 票 +1.1366，D3.70 全臂）→bt-v113（94 票 +1.1827，删臂+CD406+BP83）→bt-v114（本跑，+CD407+T138）。';

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v114-all-recent-changes-v68base',
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
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
