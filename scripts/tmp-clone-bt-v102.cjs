// 一次性 clone（182 跑）：bt-v101 → bt-v102（用户 11-11 指令「收益 50% 卖出臂请删除，然后买入要买4张卡」）：
// ① 删「收益臂-50%」卖腿（cond 精确 === 'profitPercent > 50'，cards 1；收益臂-100% profitPercent > 100 保留不误删）；
// ② 买腿 14 条（signal-source-ladder-v1 v17 快照）全部加 cards:4——每笔 0.2 BNB（perCardBNB 0.05 已在，
//    2026-11-07 卡牌形状裁定的回测口径，bt-v101 创建时漏带 cards=每笔 1 卡阶梯退化）。
// 代码版本=0c4e6fb6（BP74/题集 BP58）同窗重跑，其余 config 原样（同 source=tick cache FRESH 复用）；改动断言不一致即 throw。
const { dbManager } = require('../src/services/dbManager.js');
const { execSync } = require('child_process');
const SRC = 'bbd6e464-f8db-46c3-93b4-6638e53d72dc'; // bt-v101（completed，BP72/CD397 版本）

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  const cfg = JSON.parse(JSON.stringify(e.config));
  const sc = cfg.strategiesConfig;

  // ① 删「收益臂-50%」卖腿（精确条件匹配，防误删 100% 臂）
  const before = sc.sellStrategies.length;
  const isP50 = (l) => (l.condition || '').trim() === 'profitPercent > 50';
  const hits = sc.sellStrategies.filter(isP50);
  if (hits.length !== 1) throw new Error(`收益臂-50% 定位异常：命中 ${hits.length} 条`);
  sc.sellStrategies = sc.sellStrategies.filter((l) => !isP50(l));

  // ② 买腿全部加 cards:4
  if (!sc.buyStrategies.length) throw new Error('买腿为空');
  for (const l of sc.buyStrategies) l.cards = 4;

  // 改动断言
  if (sc.sellStrategies.length !== before - 1) throw new Error(`卖腿删除数异常：${before} → ${sc.sellStrategies.length}`);
  if (sc.sellStrategies.some(isP50)) throw new Error('收益臂-50% 残留断言失败');
  if (!sc.sellStrategies.some((l) => (l.condition || '').trim() === 'profitPercent > 100')) throw new Error('收益臂-100% 误删断言失败');
  if (sc.buyStrategies.some((l) => l.cards !== 4)) throw new Error('买腿 cards=4 断言失败');
  console.log(`改动核验：buyStrategies=${sc.buyStrategies.length}（全部 cards=4）sellStrategies=${sc.sellStrategies.length}（-1=收益臂-50%）perCardBNB=${cfg.positionManagement && cfg.positionManagement.perCardBNB} 窗=${cfg.backtest.startTime}~${cfg.backtest.endTime}`);

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v102-BP74四步制-删收益50臂-买4卡',
    experiment_description: 'bt-v102（用户 11-11 指令）基底 bt-v101 bbd6e464（BP72/CD397 版本同窗）：代码=0c4e6fb6 BP74/题集 BP58 臂 B 判序四步制（买入力在场豁免：尾 10s 买 ≥3 笔∧≥0.1 BNB 照放；同车 BP73 量维度+反弹两件套）之上同窗重跑；① 删「收益臂-50%」卖腿（profitPercent > 50 卖 1 卡；100% 臂保留）；② 买腿 14 条全部 cards:4=每笔 0.2 BNB（2026-11-07 卡牌回测口径，bt-v101 漏带）。其余 config 原样（同窗 11-05 00:00~13:45 同 source c6efed13）',
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
  execSync(`cd ~/richer-js && setsid nohup node src/run-engine.js ${row.id} > /tmp/bt-v102.log 2>&1 < /dev/null &`, { stdio: 'inherit', shell: '/bin/bash' });
  console.log('已后台启动，日志 /tmp/bt-v102.log');
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
