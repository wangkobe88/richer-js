// 复制 aed2091d（v65 live）→ 新实验：唯一变量 positionManagement.perCardBNB 减半（0.002→0.001）
// 只建行不启动（status=initializing）；启动须先停 v65（live 同钱包双进程 nonce 冲突）
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { v4: uuidv4 } = require('uuid');

const SRC = 'aed2091d-f22f-4660-ae62-42f48a9048de';
const NEW_NAME = 'v66-实盘-both-单卡减半-1030';

(async () => {
  const { dbManager } = require(path.join(__dirname, '../src/services/dbManager.js'));
  const client = dbManager.getClient();

  const { data: src, error: loadErr } = await client.from('experiments').select('*').eq('id', SRC).maybeSingle();
  if (loadErr || !src) { console.error('源实验读取失败:', loadErr); process.exit(1); }

  const cfg = JSON.parse(JSON.stringify(src.config)); // 深拷贝，byte 级保真
  const origCard = cfg.positionManagement && cfg.positionManagement.perCardBNB;
  if (!(typeof origCard === 'number' && origCard > 0)) { console.error('源实验无卡牌段:', origCard); process.exit(1); }
  const newCard = origCard / 2;
  cfg.positionManagement.perCardBNB = newCard;
  const VAR_NOTE = `。单变量（v66）：positionManagement.perCardBNB ${origCard}→${newCard}（单卡 BNB 减半，买入张数相同下单卡资金减半）；其余 config/腿与 v65 逐字一致`;
  cfg.name = NEW_NAME;
  cfg.description = (cfg.description || '') + VAR_NOTE;

  const desc = (src.experiment_description || '') + VAR_NOTE;
  const legs = (cfg.strategiesConfig.buyStrategies || []).length + (cfg.strategiesConfig.sellStrategies || []).length;
  const newRow = {
    id: uuidv4(),
    experiment_name: NEW_NAME,
    experiment_description: desc,
    status: 'initializing',
    config: cfg,
    stats: null,
    trading_mode: src.trading_mode,
    strategy_type: src.strategy_type,
    blockchain: src.blockchain,
    kline_type: src.kline_type,
    started_at: null,
    stopped_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  console.log('新实验:', newRow.id, '|', NEW_NAME, '| 腿数:', legs, '| perCardBNB:', origCard, '→', newCard);

  const { data: inserted, error: insErr } = await client.from('experiments').insert(newRow).select('id,experiment_name,status,trading_mode').single();
  if (insErr) { console.error('插入失败:', insErr); process.exit(1); }
  console.log('已插入:', JSON.stringify(inserted));

  // 回读对拍：perCardBNB / 腿数 / 其余段与源逐键一致
  const { data: back } = await client.from('experiments').select('config,status').eq('id', newRow.id).maybeSingle();
  const bcfg = back.config;
  const diffs = [];
  const a = src.config, b = bcfg;
  const cmp = (x, y, p) => {
    if (x === y) return;
    if (typeof x === 'object' && x !== null && typeof y === 'object' && y !== null) {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of keys) cmp(x[k], y[k], p ? p + '.' + k : k);
    } else diffs.push(`${p}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`);
  };
  cmp(a, b, 'config');
  console.log('与源 config 差异（应只有 name/description/perCardBNB 三处）:');
  for (const d of diffs) console.log('  ', d);
  console.log('状态:', back.status, '（未启动）');
  if (diffs.length !== 3) { console.error('!! 差异数异常'); process.exit(1); }
  process.exit(0);
})();
