#!/usr/bin/env node
// ============================================================================
// 存量条件字段未知因子扫描（2026-10-03 hg55 事故防线上线前置检查）
//
// 未知因子 fail-fast（loadStrategies throw）上线后，带写错因子键的条件字段的
// 实验重启即拒。本脚本用与 loadStrategies 完全相同的分集口径扫描存量：
//   - experiments 全表 config.strategiesConfig 买/卖腿四条件字段
//   - strategy_library 全部条目腿（入库校验同口径）
// 输出：会拒启/拒存的实验与腿清单（退出码 1 = 有命中，0 = 干净）。
//
// 用法：node scripts/scan-unknown-factor-conditions.cjs   （本地/182 均可，小结果）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const { getAvailableFactorIds } = require('../src/trading-engine/core/FactorBuilder');
const { PreBuyCheckService } = require('../src/trading-engine/pre-check/PreBuyCheckService');

const ev = new ConditionEvaluator();
const FA = getAvailableFactorIds();
const PB = new Set(PreBuyCheckService.getConditionFactorKeys());
// [字段, 校验集]——与 StrategyEngine.loadStrategies 同一分集口径
const FIELDS = [
    ['condition', FA], ['narrativeCallCondition', FA],
    ['preBuyCheckCondition', PB], ['repeatBuyCheckCondition', PB],
];

function* checkLeg(scope, leg) {
    for (const [field, ids] of FIELDS) {
        const raw = leg[field];
        if (typeof raw !== 'string' || raw.trim() === '') continue;
        try {
            const v = ev.validateCondition(ev.parseCondition(raw), ids);
            if (!v.valid) yield `${scope} ${field}: ${v.errors.join('; ')}`;
        } catch (e) {
            yield `${scope} ${field} 语法错误: ${e.message}`;
        }
    }
}

async function main() {
    const { dbManager } = require('../src/services/dbManager');
    const db = dbManager.getClient();

    const findings = [];

    const { data: exps, error: e1 } = await db.from('experiments')
        .select('id, experiment_name, status, config');
    if (e1) throw new Error('experiments 查询失败: ' + e1.message);
    console.log(`experiments: ${exps.length} 行`);
    for (const exp of exps) {
        const sc = exp.config?.strategiesConfig || {};
        for (const [side, list] of [['buy', sc.buyStrategies], ['sell', sc.sellStrategies]]) {
            if (!Array.isArray(list)) continue;
            list.forEach((leg, i) => {
                for (const msg of checkLeg(`实验[${exp.experiment_name}] ${side}腿[${i}]`, leg)) {
                    findings.push(msg);
                }
            });
        }
    }

    const { data: libs, error: e2 } = await db.from('strategy_library')
        .select('id, name, side, legs');
    if (e2) throw new Error('strategy_library 查询失败: ' + e2.message);
    console.log(`strategy_library: ${libs.length} 条目`);
    for (const lib of libs) {
        (lib.legs || []).forEach((leg, i) => {
            for (const msg of checkLeg(`库[${lib.name}] 腿[${i}]`, leg)) {
                findings.push(msg);
            }
        });
    }

    console.log('\n════════ 扫描结果 ════════');
    if (findings.length === 0) {
        console.log('✓ 全部条件字段干净——未知因子 fail-fast 上线零拒启风险');
        process.exit(0);
    }
    for (const f of findings) console.log('✗ ' + f);
    console.log(`\n共 ${findings.length} 处未知因子/语法问题（上述实验重启将被拒，库条目更新将被 400）`);
    process.exit(1);
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
