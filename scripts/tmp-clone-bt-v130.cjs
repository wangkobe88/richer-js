// 一次性 clone（2026-11-15）：bt-v130 = bt-v129 同窗重跑 + T143 因子购买前检查门开启
// （factorCheck.enabled=true）——用户裁定验证方式「bt-v129 同窗重跑对拍」。
// 变量唯一：新门（PVP 代码判定+CD 四臂升格）+ BP67 题集（②迁出）。
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*')
    .ilike('experiment_name', 'bt-v129-window-v21-firstwave-exempt%').limit(1);
  if (error || !data[0]) throw new Error('bt-v129 读取失败');
  if (!data[0].id.startsWith('4af09d63') || data[0].status !== 'completed') throw new Error('bt-v129 形状断言失败');
  const cfg = JSON.parse(JSON.stringify(data[0].config));
  const b = cfg.backtest;
  if (b.sourceExperimentId !== undefined) throw new Error('v129 应为时间窗通道（无 sourceExperimentId）');
  if (b.startTime !== '2026-11-03T15:00:00.000Z' || b.endTime !== '2026-11-04T14:00:00.000Z')
    throw new Error('窗口断言失败');
  // 唯一变量：开因子门（灰度键挂在 buyPointCheck 段下——与 service 构造同源）
  if (!cfg.fourmemeWs.buyPointCheck) cfg.fourmemeWs.buyPointCheck = {};
  cfg.fourmemeWs.buyPointCheck.factorCheck = { enabled: true };
  // 门串形状断言（v21 不变——本跑不动买腿）
  const TAIL = 'tokenAgeSec > 60 OR launchConstVsPct <= 0)';
  let hits = 0;
  for (const l of cfg.strategiesConfig.buyStrategies) {
    if (!l.condition.endsWith(TAIL)) throw new Error('v21 门串尾断言失败');
    hits++;
  }
  if (hits !== 14 || cfg.strategiesConfig.sellStrategies.length !== 16)
    throw new Error('腿数断言失败');

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v130-window-factor-prebuy-gate',
    experiment_description: 'bt-v130（2026-11-15 T143 因子购买前检查门对拍）：bt-v129 config 逐位克隆+唯一变量 fourmemeWs.buyPointCheck.factorCheck.enabled=true（FP1 灰度开）。窗口/源与 v129 一致（时间范围通道 [11-03T15:00Z→11-04T14:00Z]，无 sourceExperimentId）。门链新序=因子门→cheat 门→BP 门（用户裁定「因子门的代价最小，在最前面」）：PVP 纯代码判定（judgeRetailPvp 三步树+0.29 视同 0.3+「只要买入过即可」追裁定）+CD400/401/403/405 升格独立门（CD401 sbw 机械化代理线）+BP67 题集（②retail_pvp 迁出 Jev，prompt 零呈现）。预扫描预期：duanju 放行/Newly-blocked 仅 강형과의약속 −0.037 净止血/双拒面省 Jev。验收五条：duanju 过因子门、Newly-blocked=预扫描预测集、净额变化≈Σ被拦票基线净额、命中行零 cheat/BP Jev 行、票流 diff 可归因臂码。',
    trading_mode: 'backtest',
    strategy_type: data[0].strategy_type,
    blockchain: data[0].blockchain,
    kline_type: data[0].kline_type,
    status: 'stopped',
    config: cfg,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error('insert 失败: ' + ie.message);
  console.log('bt-v130 NEW_ID=' + row.id);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
