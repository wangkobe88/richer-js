/**
 * 策略库服务（策略库二期 / T202，2026-11-20「实验引擎策略唯一来源」改造）
 *
 * 全局策略库表 strategy_library 的 CRUD + 被引用统计。条目 = 完整交易策略包
 * （definition jsonb：buyLegs/sellLegs 腿数组 + stallClose 断流卖出 +
 * burstCooldown 冷盘卖出 + modules 四检测模块版本键）。实验 config 只存顶层
 * strategyId，引擎启动查库解析（启动时取最新 version），本表是交易策略的
 * 唯一真相源（v1 copy-in 快照语义退役——腿不再内嵌实验 config）。
 *
 * 模块版本键经 src/market-analysis/module-registry.js 解析（键在场=模块启用）；
 * 卡牌张数在腿上（策略本体），每卡 BNB（positionManagement.perCardBNB）留实验层。
 *
 * ⚠️ DB 访问一律 dbManager.getClient()（service key）——表 RLS service_role-only，
 * 勿照抄 narrative.routes 的 anon 客户端（wss_price_ticks anon 静默过滤的同款坑）。
 * dbManager 在方法内 lazy require：require 本文件零 DB（validatePack 纯函数供单测）。
 */

/**
 * 策略包 definition 形状常量（与 DDL CHECK / 引擎 _resolveStrategyPack 对齐）
 */
const PACK_TOP_KEYS = ['buyLegs', 'sellLegs', 'stallClose', 'burstCooldown', 'modules'];

const _intInRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const _numInRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/**
 * stallClose 段校验（T202 起归策略包；规则与创建页时代 web-server 校验逐字一致）：
 * 段在则 stallMs 必填正整数；minTickBnb（足额门，0=关）；
 * almostLaunchStallMs/breakdownStallMs（两档域延长，0=臂关，T170c 破发档缺省关）
 * @returns {string[]} 错误清单（空=通过）
 */
function validateStallCloseSection(sc) {
    const errors = [];
    if (typeof sc !== 'object' || sc === null || Array.isArray(sc)) {
        return ['stallClose 段形状非法（须为对象）'];
    }
    if (!_intInRange(sc.stallMs, 1000, 3600000)) {
        errors.push('stallClose.stallMs 须为整数 [1000,3600000]（断流毫秒门，段启用必填）');
    }
    if (sc.minTickBnb !== undefined && !_numInRange(sc.minTickBnb, 0, 1)) {
        errors.push('stallClose.minTickBnb 须为数值 [0,1]（足额门 BNB，0=关）');
    }
    if (sc.almostLaunchStallMs !== undefined && !_intInRange(sc.almostLaunchStallMs, 0, 3600000)) {
        errors.push('stallClose.almostLaunchStallMs 须为整数 [0,3600000]（almost_launch 域延长毫秒，0=臂关）');
    }
    if (sc.breakdownStallMs !== undefined && !_intInRange(sc.breakdownStallMs, 0, 3600000)) {
        errors.push('stallClose.breakdownStallMs 须为整数 [0,3600000]（破发域延长毫秒，0/缺省=臂关 T170c）');
    }
    return errors;
}

/**
 * burstCooldown 段校验（T202 起归策略包；五键全可选，段在场即启用 {}=全默认；
 * check2Sec 必须大于 check1Sec——批2 观察段非空，否则快线/兜底永不可达=死配置）
 * @returns {string[]} 错误清单（空=通过）
 */
function validateBurstCooldownSection(bc) {
    const errors = [];
    if (typeof bc !== 'object' || bc === null || Array.isArray(bc)) {
        return ['burstCooldown 段形状非法（须为对象；{}=全默认启用）'];
    }
    const c1 = bc.check1Sec !== undefined ? bc.check1Sec : 15;
    const c2 = bc.check2Sec !== undefined ? bc.check2Sec : 30;
    if (bc.check1Sec !== undefined && !_intInRange(bc.check1Sec, 1, 600)) {
        errors.push('burstCooldown.check1Sec 须为整数 [1,600]（批1 检查点秒）');
    }
    if (bc.check1MinAbsorbBnb !== undefined && !_numInRange(bc.check1MinAbsorbBnb, 0, 100)) {
        errors.push('burstCooldown.check1MinAbsorbBnb 须为数值 [0,100]（批1 承接冷盘线 BNB）');
    }
    if (bc.check2ConfirmSec !== undefined && !_intInRange(bc.check2ConfirmSec, 1, 600)) {
        errors.push('burstCooldown.check2ConfirmSec 须为整数 [1,600]（批2 枯竭确认窗秒）');
    }
    if (bc.check2Sec !== undefined && !_intInRange(bc.check2Sec, 2, 3600)) {
        errors.push('burstCooldown.check2Sec 须为整数 [2,3600]（批2 兜底检查点秒）');
    }
    if (bc.check2MinAbsorbBnb !== undefined && !_numInRange(bc.check2MinAbsorbBnb, 0, 100)) {
        errors.push('burstCooldown.check2MinAbsorbBnb 须为数值 [0,100]（批2 承接冷盘线 BNB）');
    }
    if (c2 <= c1) {
        errors.push(`burstCooldown.check2Sec(${c2}) 必须大于 check1Sec(${c1})——批2 观察段为空则快线/兜底永不可达`);
    }
    return errors;
}

/**
 * 腿集合校验（纯函数；v1 内核原样保留——validatePack 两侧复用，库页
 * 「从实验导入」旧实验腿迁移亦走此处）：
 *   - legs 非空数组；side ∈ {buy, sell}
 *   - 每腿 condition 必填（非空字符串）
 *   - 条件表达式未知因子拦截（FA/PreBuy/GMGN 三分集与 loadStrategies 同口径；
 *     语法错同样拦——parseCondition throw 视为腿非法）
 *   - narrativeTriggerCondition ∧ narrativeCallCondition 同腿互斥（C84）→ 400
 *   - sellDebounce 覆盖段（T109）仅卖腿；sellPercentage/factorSellFilter 退役字段携带即 400
 *   - signalGate（T117）仅买腿、与七旧门字段互斥、recheckCondition 键域校验
 *   - buyPhase（T100）/cheatCheckCondition（CD158）仅买腿
 *   - groups/cycle 不再校验也不再报错（重存自然剥离）
 * @param {string} side - 'buy' | 'sell'
 * @param {Array} legs - 腿集合
 * @returns {{valid: boolean, errors: Array<string>}}
 */
function validateLegs(side, legs) {
    if (!['buy', 'sell'].includes(side)) {
        return { valid: false, errors: [`side 必须是 'buy' 或 'sell'，实际 ${JSON.stringify(side)}`] };
    }
    if (!Array.isArray(legs) || legs.length === 0) {
        return { valid: false, errors: ['腿集合必须是非空数组（空腿条目无意义）'] };
    }
    // lazy require：保持「require 本文件零依赖」的可测性；require 缓存后无重复开销
    const { ConditionEvaluator } = require('../../strategies/ConditionEvaluator');
    const { normalizeSellDebounce, normalizeSignalGate } = require('../../strategies/StrategyEngine');
    const { getAvailableFactorIds } = require('../../trading-engine/core/FactorBuilder');
    const { PreBuyCheckService } = require('../../trading-engine/pre-check/PreBuyCheckService');
    const { GmgnRiskCheckService } = require('../../trading-engine/pre-check/GmgnRiskCheckService');
    const evaluator = new ConditionEvaluator();
    const faIds = getAvailableFactorIds();
    const preBuyIds = new Set(PreBuyCheckService.getConditionFactorKeys());
    const gmgnIds = new Set(GmgnRiskCheckService.getConditionFactorKeys());
    // [字段, 校验集]：与 StrategyEngine.loadStrategies 同一分集口径
    const CONDITION_FIELDS = [
        ['condition', faIds],
        ['narrativeCallCondition', faIds],
        ['narrativePrefetchCondition', faIds],
        ['narrativeTriggerCondition', faIds],
        ['cheatCheckCondition', faIds],
        ['preBuyCheckCondition', preBuyIds],
        ['repeatBuyCheckCondition', preBuyIds],
        ['gmgnCheckCondition', gmgnIds],
    ];
    const errors = [];
    legs.forEach((leg, i) => {
        if (!leg || typeof leg !== 'object') {
            errors.push(`腿[${i}]必须是对象`);
            return;
        }
        if (typeof leg.condition !== 'string' || leg.condition.trim() === '') {
            errors.push(`腿[${i}]缺少 condition`);
        }
        // 卖腿 sizing（2026-10-24 sellPercentage 退役）：cards 是唯一卖出张数表达
        if (side === 'sell') {
            if (leg.sellPercentage != null) {
                errors.push(`腿[${i}] 携带已退役字段 sellPercentage（2026-10-24：卡牌 cards 是唯一卖出 sizing）`);
            }
            const cardsOk = leg.cards === 'all' || (Number.isInteger(leg.cards) && leg.cards >= 1);
            if (!cardsOk) {
                errors.push(`腿[${i}] 卖腿必须配置 cards（'all'=全清 或 ≥1 的整数张数；sellPercentage 已退役）`);
            }
        }
        // C84 互斥（2026-10-17）
        if (String(leg.narrativeTriggerCondition || '').trim() !== ''
            && String(leg.narrativeCallCondition || '').trim() !== '') {
            errors.push(`腿[${i}] narrativeTriggerCondition 与 narrativeCallCondition 互斥（C84：触发轮后台分析新链 vs fire 同步直调旧链）`);
        }
        // 首买/再买路由标记（T100 2026-10-29）：仅买腿可配，值域 'first'|'repeat'
        if (leg.buyPhase != null && leg.buyPhase !== '') {
            if (side !== 'buy') {
                errors.push(`腿[${i}] 非买腿携带 buyPhase（T100 首买/再买路由：该字段仅买腿可配）`);
            } else if (leg.buyPhase !== 'first' && leg.buyPhase !== 'repeat') {
                errors.push(`腿[${i}] buyPhase 非法值 ${JSON.stringify(leg.buyPhase)}（T100：仅支持 'first' | 'repeat'）`);
            }
        }
        // 卖腿确认去抖覆盖段（T109）：仅卖腿，normalizeSellDebounce 单点校验
        const sd = normalizeSellDebounce(leg.sellDebounce);
        if (sd.error) {
            errors.push(`腿[${i}] ${sd.error}（T109）`);
        } else if (sd.normalized != null && side !== 'sell') {
            errors.push(`腿[${i}] 非卖腿携带 sellDebounce（T109 卖腿确认去抖覆盖：该字段仅卖腿可配）`);
        }
        // 因子卖出过滤门（T157/T157b）：腿字段已退役，携带即 400
        if (leg.factorSellFilter !== undefined && leg.factorSellFilter !== null) {
            errors.push(`腿[${i}] 携带已退役字段 factorSellFilter（T157b 全腿化：卖出过滤=实验级 fourmemeWs.factorSellFilter 配置全腿生效，不逐腿标记）`);
        }
        // 买信号驱动作弊门条件（CD158）：仅买腿可配
        if (String(leg.cheatCheckCondition || '').trim() !== '' && side !== 'buy') {
            errors.push(`腿[${i}] 非买腿携带 cheatCheckCondition（CD158 买信号驱动作弊门：该字段仅买腿可配）`);
        }
        // 信号源门链段（T117）：仅买腿可配，与七个旧门字段互斥
        const sg = normalizeSignalGate(leg.signalGate);
        if (sg.error) {
            errors.push(`腿[${i}] ${sg.error}（T117 信号源门链）`);
        } else if (sg.normalized != null && side !== 'buy') {
            errors.push(`腿[${i}] 非买腿携带 signalGate（T117 信号源门链：该字段仅买腿可配）`);
        } else if (sg.normalized != null) {
            const conflicts = ['narrativeTriggerCondition', 'narrativeCallCondition',
                'narrativePrefetchCondition', 'preBuyCheckCondition', 'repeatBuyCheckCondition',
                'gmgnCheckCondition', 'cheatCheckCondition']
                .filter((f) => String(leg[f] || '').trim() !== '');
            if (conflicts.length > 0) {
                errors.push(`腿[${i}] signalGate 与 ${conflicts.join('/')} 互斥（T117：纯盘面门链 vs 旧链路门字段，并存行为未定义）`);
            }
            // CD381 recheckCondition 键域校验（FA 集）
            const rc = sg.normalized.recheckCondition;
            if (typeof rc === 'string' && rc.trim() !== '') {
                try {
                    const v = evaluator.validateCondition(evaluator.parseCondition(rc), faIds);
                    if (!v.valid) errors.push(`腿[${i}] signalGate.recheckCondition ${v.errors.join('; ')}`);
                } catch (e) {
                    errors.push(`腿[${i}] signalGate.recheckCondition 语法错误: ${e.message}`);
                }
            }
        }
        for (const [field, ids] of CONDITION_FIELDS) {
            const raw = leg[field];
            if (typeof raw !== 'string' || raw.trim() === '') continue;
            try {
                const v = evaluator.validateCondition(evaluator.parseCondition(raw), ids);
                if (!v.valid) errors.push(`腿[${i}] ${field} ${v.errors.join('; ')}`);
            } catch (e) {
                errors.push(`腿[${i}] ${field} 语法错误: ${e.message}`);
            }
        }
    });
    return { valid: errors.length === 0, errors };
}

/**
 * 策略包 definition 校验（纯函数，service.create/update 与库页「从实验导入」
 * 共用同一校验，避免双路径漂移）：
 *   - definition 须为对象；顶层键白名单 buyLegs/sellLegs/stallClose/burstCooldown/
 *     modules（未知键 400——静默忽略=包内容跑非所配，fail-fast 纪律）
 *   - buyLegs/sellLegs 非空数组 → validateLegs('buy'/'sell', …) 逐腿校验
 *   - stallClose/burstCooldown 段可选；在场则形状校验（引擎直读键，脏值入库即拦）
 *   - modules 可选（缺省=四门全关）；每键经 module-registry assertModuleKey
 *     （未知模块名/版本键 400——引擎侧同口径拒启）
 * @param {Object} definition
 * @returns {{valid: boolean, errors: Array<string>}}
 */
function validatePack(definition) {
    if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) {
        return { valid: false, errors: ['definition 须为对象（策略包：buyLegs/sellLegs/stallClose/burstCooldown/modules）'] };
    }
    const errors = [];
    const unknownKeys = Object.keys(definition).filter((k) => !PACK_TOP_KEYS.includes(k));
    if (unknownKeys.length > 0) {
        errors.push(`definition 携带未知顶层键 ${unknownKeys.join('/')}（可用：${PACK_TOP_KEYS.join('/')}）`);
    }
    if (!Array.isArray(definition.buyLegs) || definition.buyLegs.length === 0) {
        errors.push('buyLegs 必须是非空数组');
    } else {
        errors.push(...validateLegs('buy', definition.buyLegs).errors);
    }
    if (!Array.isArray(definition.sellLegs) || definition.sellLegs.length === 0) {
        errors.push('sellLegs 必须是非空数组');
    } else {
        errors.push(...validateLegs('sell', definition.sellLegs).errors);
    }
    if (definition.stallClose !== undefined && definition.stallClose !== null) {
        errors.push(...validateStallCloseSection(definition.stallClose));
    }
    if (definition.burstCooldown !== undefined && definition.burstCooldown !== null) {
        errors.push(...validateBurstCooldownSection(definition.burstCooldown));
    }
    if (definition.modules !== undefined && definition.modules !== null) {
        const { assertModuleKey, MODULE_NAMES } = require('../../market-analysis/module-registry');
        if (typeof definition.modules !== 'object' || Array.isArray(definition.modules)) {
            errors.push('modules 段形状非法（须为对象：{模块名: 版本键}，键在场=模块启用）');
        } else {
            for (const [name, key] of Object.entries(definition.modules)) {
                try {
                    assertModuleKey(name, key);
                } catch (e) {
                    errors.push(`modules.${name}: ${e.message}`);
                }
            }
            const unknownMods = Object.keys(definition.modules)
                .filter((k) => !MODULE_NAMES.includes(k));
            if (unknownMods.length > 0) {
                errors.push(`modules 携带未知模块名 ${unknownMods.join('/')}（可用：${MODULE_NAMES.join('/')}）`);
            }
        }
    }
    return { valid: errors.length === 0, errors };
}

class StrategyLibraryService {
    constructor(logger = console) {
        this.logger = logger;
    }

    /** service key 客户端（lazy：require 本文件零 DB） */
    _client() {
        const { dbManager } = require('../../services/dbManager');
        return dbManager.getClient();
    }

    /**
     * 全量扫描实验 config.strategyId 的被引用计数
     * （experiments 总量小，不排序不分页直接全取）
     * @returns {Promise<Map<string, number>>} 策略包 id → 引用实验数
     */
    async _usageCounts() {
        const { data, error } = await this._client()
            .from('experiments')
            .select('id, config');
        if (error) {
            throw new Error(`被引用统计查询失败: ${error.message}`);
        }
        const counts = new Map();
        for (const row of data || []) {
            const sid = row.config?.strategyId;
            if (typeof sid === 'string' && sid) {
                counts.set(sid, (counts.get(sid) || 0) + 1);
            }
        }
        return counts;
    }

    /**
     * 条目列表（合并被引用数）
     */
    async list() {
        const { data, error } = await this._client()
            .from('strategy_library')
            .select('id, name, description, definition, version, created_at, updated_at')
            .order('created_at', { ascending: true });
        if (error) {
            throw new Error(`策略库列表查询失败: ${error.message}`);
        }
        const counts = await this._usageCounts();
        return (data || []).map(row => ({
            ...row,
            buyLegCount: Array.isArray(row.definition?.buyLegs) ? row.definition.buyLegs.length : 0,
            sellLegCount: Array.isArray(row.definition?.sellLegs) ? row.definition.sellLegs.length : 0,
            usageCount: counts.get(row.id) || 0,
        }));
    }

    /** 单条目 */
    async getById(id) {
        const { data, error } = await this._client()
            .from('strategy_library')
            .select('id, name, description, definition, version, created_at, updated_at')
            .eq('id', id)
            .single();
        if (error) {
            throw new Error(`策略库条目查询失败: ${error.message}`);
        }
        return data;
    }

    /** 新建（version=1） */
    async create({ name, description = '', definition }) {
        const check = validatePack(definition);
        if (!check.valid) {
            const err = new Error(check.errors.join('; '));
            err.status = 400;
            throw err;
        }
        const { data, error } = await this._client()
            .from('strategy_library')
            .insert({ name: String(name).trim(), description: String(description || ''), definition })
            .select('id, name, version')
            .single();
        if (error) {
            if (error.code === '23505') { // unique violation（重名）
                const err = new Error(`条目名已存在: ${name}`);
                err.status = 409;
                throw err;
            }
            throw new Error(`策略库条目创建失败: ${error.message}`);
        }
        return data;
    }

    /**
     * 更新（乐观并发：expectedVersion 不匹配 → 409 冲突，前端刷新重试）。
     * 运行中实验不受影响——「启动时取最新」语义下改动在下次启动生效。
     */
    async update(id, { name, description = '', definition, expectedVersion }) {
        await this.getById(id); // 缺行 → throw（404 由 routes 映射）
        const check = validatePack(definition);
        if (!check.valid) {
            const err = new Error(check.errors.join('; '));
            err.status = 400;
            throw err;
        }
        const { data, error } = await this._client()
            .from('strategy_library')
            .update({
                name: String(name).trim(),
                description: String(description || ''),
                definition,
                version: expectedVersion + 1,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('version', expectedVersion) // 乐观并发门
            .select('id, name, version')
            .single();
        if (error) {
            if (error.code === '23505') {
                const err = new Error(`条目名已存在: ${name}`);
                err.status = 409;
                throw err;
            }
            throw new Error(`策略库条目更新失败: ${error.message}`);
        }
        return data;
    }

    /**
     * 删除（「启动时取最新」语义：只影响下次启动的实验；响应带回被引用数供前端提示）
     * @returns {Promise<{usageCount: number}>}
     */
    async remove(id) {
        const counts = await this._usageCounts();
        const { error } = await this._client()
            .from('strategy_library')
            .delete()
            .eq('id', id);
        if (error) {
            throw new Error(`策略库条目删除失败: ${error.message}`);
        }
        return { usageCount: counts.get(id) || 0 };
    }

    /** 被引用明细（实验 id 列表） */
    async getUsage(id) {
        const { data, error } = await this._client()
            .from('experiments')
            .select('id, config');
        if (error) {
            throw new Error(`被引用明细查询失败: ${error.message}`);
        }
        const experimentIds = [];
        for (const row of data || []) {
            if (row.config?.strategyId === id) {
                experimentIds.push(row.id);
            }
        }
        return { experimentIds, usageCount: experimentIds.length };
    }
}

module.exports = {
    StrategyLibraryService,
    validateLegs,
    validatePack,
    validateStallCloseSection,
    validateBurstCooldownSection,
};
