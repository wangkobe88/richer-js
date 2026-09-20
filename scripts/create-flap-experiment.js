#!/usr/bin/env node

/**
 * 创建 flap 虚拟实验：从现有 four.meme 虚拟实验复制策略配置，改 platform='flap'
 *
 * 用法：
 *   node scripts/create-flap-experiment.js                    # 自动选最新虚拟实验为母版
 *   node scripts/create-flap-experiment.js --source <exp_id>  # 指定母版
 *
 * 改动点：config.platform='flap'（引擎/collector 据此分派）、名称/描述、
 * 删除实验级 config.fourmemeWs 覆盖（flap 引擎读 flapWs 段）。
 */
require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('../src/services/dbManager');

async function main() {
  const args = process.argv.slice(2);
  const sourceId = args.includes('--source')
    ? args[args.indexOf('--source') + 1]
    : null;

  const db = dbManager.getClient();

  let query = db
    .from('experiments')
    .select('id, experiment_name, trading_mode, status, config')
    .eq('trading_mode', 'virtual')
    .order('created_at', { ascending: false })
    .limit(10);
  const { data: candidates, error: listError } = await query;
  if (listError) throw new Error(`查询虚拟实验失败: ${listError.message}`);

  const source = sourceId
    ? (candidates || []).find(e => e.id === sourceId)
    : (candidates || []).find(e => e.config?.strategiesConfig?.buyStrategies?.length > 0);

  if (!source) {
    throw new Error(sourceId
      ? `母版 ${sourceId} 不在最近 10 个虚拟实验中（或无策略配置）`
      : '最近 10 个虚拟实验中没有带 buyStrategies 的可用母版，请 --source 指定');
  }

  console.log('=== 母版实验 ===');
  console.log(`${source.experiment_name} (${source.id}, ${source.status})`);

  const newConfig = JSON.parse(JSON.stringify(source.config));
  newConfig.name = `flap虚拟-复制 ${source.experiment_name}`;
  newConfig.description = `flap 平台虚拟实验：复制 ${source.id} 的策略配置，platform=flap`;
  newConfig.platform = 'flap';
  delete newConfig.fourmemeWs; // four.meme 实验级覆盖对 flap 段无效，防残留干扰

  const { data: newExp, error: createError } = await db
    .from('experiments')
    .insert({
      experiment_name: newConfig.name,
      experiment_description: newConfig.description,
      status: 'initializing',
      trading_mode: 'virtual',
      strategy_type: 'fourmeme_earlyreturn',
      blockchain: 'bsc',
      kline_type: source.config?.kline_type || '1m',
      config: newConfig,
    })
    .select('id, experiment_name')
    .single();

  if (createError) throw new Error(`创建失败: ${createError.message}`);

  console.log('\n=== flap 虚拟实验已创建 ===');
  console.log('ID:', newExp.id);
  console.log('名称:', newExp.experiment_name);
  console.log('\n启动：node main.js start-experiment -e ' + newExp.id);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
