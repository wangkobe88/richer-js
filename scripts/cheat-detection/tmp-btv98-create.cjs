// 一次性（182 跑）：bt-v98 创建——克隆 bt-v97 配置，t0a 量门 1.2→1 回退（用户裁定
// 「量门的改动就回退一下」），其余三变量（删 pump 卖腿引用/alwaysRecheck false）与
// v97 一致；代码含 BP53 三修收割中题面。终态实验不能重跑（BUY 信号行翻倍污染）——新 INSERT。
const { dbManager } = require('../../src/services/dbManager.js');
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';

async function main() {
  const c = await dbManager.getClient();
  const { data: src, error: e1 } = await c.from('experiments')
    .select('*').eq('id', V97);
  if (e1) throw new Error(e1.message);
  if (!src || !src.length) throw new Error('v97 无行');
  const srcRow = src[0];
  const cfg = JSON.parse(JSON.stringify(srcRow.config));
  const bs = cfg.strategiesConfig && cfg.strategiesConfig.buyStrategies;
  if (!Array.isArray(bs)) throw new Error('buyStrategies 缺失');
  const t0a = bs.find((l) => l.priority === 1);
  if (!t0a || !String(t0a.condition || '').includes('buyVolumeBnb >= 1.2')) {
    throw new Error(`priority 1 腿非 t0a 量门 1.2 形状: ${t0a && t0a.condition}`);
  }
  t0a.condition = t0a.condition.replace('buyVolumeBnb >= 1.2', 'buyVolumeBnb >= 1');
  const name = 'bt-v98-完整窗口-t0a量门回退1-收割中题面';
  // 展开原行全列（保 NOT NULL 列），覆盖 id/name/status，剔除时间戳与计数列由 DB 默认
  const SKIP = new Set(['id', 'experiment_name', 'status', 'created_at', 'updated_at']);
  const carry = {};
  for (const [k, v] of Object.entries(srcRow)) if (!SKIP.has(k)) carry[k] = v;
  carry.config = cfg;
  const { randomUUID } = require('crypto');
  const uuid = randomUUID();
  const { data: ins, error: e2 } = await c.from('experiments').insert({
    id: uuid, experiment_name: name, status: 'created', ...carry,
  }).select('id,experiment_name,status');
  if (e2) throw new Error(e2.message);
  console.log('INSERT ok:', JSON.stringify(ins));
  // 回读校验 t0a
  const { data: back } = await c.from('experiments').select('config').eq('id', uuid);
  const t0aBack = back[0].config.strategiesConfig.buyStrategies.find((l) => l.priority === 1);
  console.log('新实验 id:', uuid);
  console.log('t0a 回读:', t0aBack.condition);
  console.log('backtest 窗口:', JSON.stringify(back[0].config.backtest));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
