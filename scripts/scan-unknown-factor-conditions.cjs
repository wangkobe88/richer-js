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
const { GmgnRiskCheckService } = require('../src/trading-engine/pre-check/GmgnRiskCheckService');

const ev = new ConditionEvaluator();
const FA = getAvailableFactorIds();
const PB = new Set(PreBuyCheckService.getConditionFactorKeys());
const GM = new Set(GmgnRiskCheckService.getConditionFactorKeys());
// [字段, 校验集]——与 StrategyEngine.loadStrategies 同一分集口径（narrativePrefetchCondition
// 补齐 + narrativeTriggerCondition = C84 叙事发起条件，2026-10-17；cheatCheckCondition
// = CD158 买信号驱动作弊门，FA 集——cheat 43 键经 getFactorKeys 探针在域内）
const FIELDS = [
    ['condition', FA], ['narrativeCallCondition', FA],
    ['narrativePrefetchCondition', FA], ['narrativeTriggerCondition', FA],
    ['cheatCheckCondition', FA],
    ['preBuyCheckCondition', PB], ['repeatBuyCheckCondition', PB],
    ['gmgnCheckCondition', GM],
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

// 策略包 definition 两侧腿扫描（T202：条目=完整交易策略包；互斥检查同 loadStrategies 口径）
function scanPackLegs(scope, pack, findings) {
    const def = pack.definition || {};
    for (const [side, list] of [['buy', def.buyLegs], ['sell', def.sellLegs]]) {
        if (!Array.isArray(list)) continue;
        list.forEach((leg, i) => {
            for (const msg of checkLeg(`${scope} ${side}腿[${i}]`, leg)) {
                findings.push(msg);
            }
            if (String(leg.narrativeTriggerCondition || '').trim() !== ''
                && String(leg.narrativeCallCondition || '').trim() !== '') {
                findings.push(`${scope} ${side}腿[${i}] narrativeTriggerCondition 与 narrativeCallCondition 互斥（更新将被 400）`);
            }
        });
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
    const { data: packs, error: eP } = await db.from('strategy_library')
        .select('id, name, version, definition');
    if (eP) throw new Error('strategy_library 查询失败: ' + eP.message);
    const packById = new Map((packs || []).map((x) => [x.id, x]));
    for (const exp of exps) {
        // T202 策略库二期：新形状实验只存 strategyId——腿在策略包 definition，经库扫描
        //（包缺失=finding：重启即拒）；旧形状（strategiesConfig 内嵌腿）仍扫存量审计
        if (exp.config?.strategyId) {
            const pack = packById.get(exp.config.strategyId);
            if (!pack) {
                findings.push(`实验[${exp.experiment_name}] strategyId=${exp.config.strategyId} 在 strategy_library 无对应策略包（重启将被拒）`);
                continue;
            }
            scanPackLegs(`实验[${exp.experiment_name}]→包[${pack.name}]`, pack, findings);
            continue;
        }
        const sc = exp.config?.strategiesConfig || {};
        for (const [side, list] of [['buy', sc.buyStrategies], ['sell', sc.sellStrategies]]) {
            if (!Array.isArray(list)) continue;
            list.forEach((leg, i) => {
                for (const msg of checkLeg(`实验[${exp.experiment_name}] ${side}腿[${i}]`, leg)) {
                    findings.push(msg);
                }
                // C84 互斥（2026-10-17）：与 loadStrategies/validateLegs 同口径
                if (String(leg.narrativeTriggerCondition || '').trim() !== ''
                    && String(leg.narrativeCallCondition || '').trim() !== '') {
                    findings.push(`实验[${exp.experiment_name}] ${side}腿[${i}] narrativeTriggerCondition 与 narrativeCallCondition 互斥（T202 后属旧形状，重启将被拒）`);
                }
            });
        }
        // 数据预取门已随 dataPrefetch 机制退役删除（C84 2026-10-17），段不再扫描
    }

    console.log(`strategy_library: ${packs.length} 策略包`);
    for (const lib of packs) {
        scanPackLegs(`库[${lib.name}]`, lib, findings);
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
