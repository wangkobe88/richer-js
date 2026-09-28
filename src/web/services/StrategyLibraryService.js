/**
 * 策略库服务（策略库一期，2026-09-28）
 *
 * 全局策略库表 strategy_library 的 CRUD + 被引用统计。条目 = 一组同侧腿
 * （腿 jsonb 形状与 strategiesConfig.buy/sellStrategies 数组元素同构）。
 * 快照语义（copy-in）：创建页展开库腿进表单，实验 config 只存 libraryRefs
 * 元数据——运行链零依赖本表，删除条目不影响已建实验（usage 仅统计提示）。
 *
 * ⚠️ DB 访问一律 dbManager.getClient()（service key）——表 RLS service_role-only，
 * 勿照抄 narrative.routes 的 anon 客户端（wss_price_ticks anon 静默过滤的同款坑）。
 * dbManager 在方法内 lazy require：require 本文件零 DB（validateLegs 纯函数供单测）。
 */

const { parseGroupsExpression } = require('../../strategies/group-variables');

/**
 * 腿集合入库校验（纯函数，service.create/update 与库页「从实验导入」共用同一校验，
 * 避免双路径漂移）：
 *   - legs 非空数组；side ∈ {buy, sell}
 *   - 每腿 condition 必填（非空字符串）
 *   - 每腿 groups 过 parseGroupsExpression（库是 groups 第一编辑面，脏值入库前拦截）
 *   - side 与腿字段错配放行（买腿带 sellPercentage / 卖腿带 preBuyCheckCondition 等
 *     引擎本就「携带不生效」，不构成危险）
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
    const errors = [];
    legs.forEach((leg, i) => {
        if (!leg || typeof leg !== 'object') {
            errors.push(`腿[${i}]必须是对象`);
            return;
        }
        if (typeof leg.condition !== 'string' || leg.condition.trim() === '') {
            errors.push(`腿[${i}]缺少 condition`);
        }
        if (typeof leg.groups === 'string' && leg.groups.trim() !== '') {
            try {
                parseGroupsExpression(leg.groups);
            } catch (e) {
                errors.push(`腿[${i}] ${e.message}`);
            }
        }
    });
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
     * 全量扫描实验 config.strategiesConfig.libraryRefs 的被引用计数
     * （experiments 总量小，不排序不分页直接全取）
     * @returns {Promise<Map<string, number>>} libId → 引用实验数
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
            const refs = row.config?.strategiesConfig?.libraryRefs;
            if (!Array.isArray(refs)) continue;
            const seen = new Set(refs.map(r => r?.libId).filter(Boolean));
            for (const libId of seen) {
                counts.set(libId, (counts.get(libId) || 0) + 1);
            }
        }
        return counts;
    }

    /**
     * 条目列表（合并被引用数）
     * @param {string|null} side - 'buy' | 'sell' | null=全部
     */
    async list(side = null) {
        let query = this._client()
            .from('strategy_library')
            .select('id, name, description, side, legs, version, created_at, updated_at')
            .order('created_at', { ascending: true });
        if (side) {
            query = query.eq('side', side);
        }
        const { data, error } = await query;
        if (error) {
            throw new Error(`策略库列表查询失败: ${error.message}`);
        }
        const counts = await this._usageCounts();
        return (data || []).map(row => ({
            ...row,
            legCount: Array.isArray(row.legs) ? row.legs.length : 0,
            usageCount: counts.get(row.id) || 0,
        }));
    }

    /** 单条目 */
    async getById(id) {
        const { data, error } = await this._client()
            .from('strategy_library')
            .select('id, name, description, side, legs, version, created_at, updated_at')
            .eq('id', id)
            .single();
        if (error) {
            throw new Error(`策略库条目查询失败: ${error.message}`);
        }
        return data;
    }

    /** 新建（version=1） */
    async create({ name, description = '', side, legs }) {
        const check = validateLegs(side, legs);
        if (!check.valid) {
            const err = new Error(check.errors.join('; '));
            err.status = 400;
            throw err;
        }
        const { data, error } = await this._client()
            .from('strategy_library')
            .insert({ name: String(name).trim(), description: String(description || ''), side, legs })
            .select('id, name, side, version')
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
     * 更新（乐观并发：expectedVersion 不匹配 → 409 冲突，前端刷新重试）
     * side 创建后锁死不可改（引用方按 side 组织表单，改侧=引用语义断裂）
     */
    async update(id, { name, description = '', legs, expectedVersion }) {
        const existing = await this.getById(id);
        const check = validateLegs(existing.side, legs);
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
                legs,
                version: expectedVersion + 1,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('version', expectedVersion) // 乐观并发门
            .select('id, name, side, version')
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
     * 删除（快照语义：运行零影响；响应带回被引用数供前端提示）
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
            const refs = row.config?.strategiesConfig?.libraryRefs;
            if (Array.isArray(refs) && refs.some(r => r?.libId === id)) {
                experimentIds.push(row.id);
            }
        }
        return { experimentIds, usageCount: experimentIds.length };
    }
}

module.exports = { StrategyLibraryService, validateLegs };
