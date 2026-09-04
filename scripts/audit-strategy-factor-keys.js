#!/usr/bin/env node

/**
 * Phase 3 策略 condition 键审计：
 * 拉取最近实验的 buy/sell 策略 condition 表达式，提取引用的因子键，
 * 与 FourMemeFactorAggregator.getFactorKeys() 全集比对。
 *
 * 引用键 ∉ FA 全集 = ConditionEvaluator 对 undefined 恒 false → 买入被静默封死。
 * （preBuyCheckCondition 的上下文是 PreBuyCheckService 结果键，不在本审计范围。）
 *
 * 用法：node scripts/audit-strategy-factor-keys.js [--limit 20] [--exp <experimentId>]
 */

require('dotenv').config({ path: './config/.env' });

const JS_KEYWORDS = new Set([
  'and', 'or', 'not', 'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'if', 'else', 'return', 'Math', 'min', 'max', 'abs', 'floor', 'ceil', 'round',
  'sqrt', 'pow', 'log', 'exp', 'isNaN', 'isFinite', 'Number', 'String', 'Boolean',
  'length', 'includes', 'typeof', 'new',
]);

function extractIdentifiers(expr) {
  if (!expr || typeof expr !== 'string') return new Set();
  const ids = new Set();
  // 去掉字符串字面量与数字
  const cleaned = expr.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '').replace(/\d+(\.\d+)?/g, ' ');
  for (const m of cleaned.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*/g)) {
    // 大小写不敏感过滤关键字：AND/OR/NOT 是条件语法糖（非因子键），因子键均为小写驼峰不受影响
    if (!JS_KEYWORDS.has(m[0].toLowerCase())) ids.add(m[0]);
  }
  return ids;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 20;
  const expId = args.includes('--exp') ? args[args.indexOf('--exp') + 1] : null;

  const { dbManager } = require('../src/services/dbManager');
  const supabase = dbManager.getClient();

  let query = supabase.from('experiments').select('id, experiment_name, trading_mode, created_at, config');
  if (expId) query = query.eq('id', expId);
  else query = query.order('created_at', { ascending: false }).limit(limit);

  const { data: experiments, error } = await query;
  if (error) throw new Error(`读取实验失败: ${error.message}`);

  const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
  const fa = new FourMemeFactorAggregator(require('../config/default.json'), null);
  const faKeys = fa.getFactorKeys();

  // 全局引用统计：key → [实验名...]
  const unknownRefs = new Map();
  let auditedConditions = 0;
  const seenConditions = new Set();

  for (const exp of experiments || []) {
    const strategies = exp.config?.strategiesConfig || {};
    const all = [
      ...(strategies.buyStrategies || []).map(s => ({ kind: 'buy', c: s.condition })),
      ...(strategies.sellStrategies || []).map(s => ({ kind: 'sell', c: s.condition })),
    ];
    for (const { kind, c } of all) {
      if (!c || seenConditions.has(c)) continue;
      seenConditions.add(c);
      auditedConditions++;
      for (const id of extractIdentifiers(c)) {
        if (!faKeys.has(id)) {
          if (!unknownRefs.has(id)) unknownRefs.set(id, []);
          unknownRefs.get(id).push(`${exp.experiment_name}(${kind})`);
        }
      }
    }
  }

  console.log(`\n审计实验数: ${(experiments || []).length}，去重 condition 数: ${auditedConditions}`);
  console.log(`FA 因子键全集: ${faKeys.size} 个`);

  if (unknownRefs.size === 0) {
    console.log('✅ 所有 condition 引用键均在 FA 因子全集内（无静默封死风险）');
  } else {
    console.log(`\n❌ ${unknownRefs.size} 个引用键不在 FA 全集内（ConditionEvaluator 对缺失键恒 false）:`);
    for (const [key, refs] of [...unknownRefs.entries()].sort()) {
      console.log(`  ${key}  ← ${[...new Set(refs)].slice(0, 3).join(', ')}${new Set(refs).size > 3 ? ' 等' : ''}`);
    }
    process.exitCode = 2;
  }
}

main().catch(err => {
  console.error('审计失败:', err.message);
  process.exit(1);
});
