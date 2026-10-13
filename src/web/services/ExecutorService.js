/**
 * 执行器（交易钱包）服务层
 *
 * executors 表 CRUD：集中管理 live 实验交易钱包（迁移自 rich-js，2026-10-13 实盘前置批）。
 * 私钥密文（auth_token）只在创建/更新时写入，任何查询路径都不回传。
 *
 * ⚠️ 表 RLS service_role-only——一律 dbManager.getClient()（service key，红线③）。
 */

const { dbManager } = require('../../services/dbManager');
const { CryptoUtils } = require('../../utils/CryptoUtils');

/** 列表/单查恒用的安全列集（auth_token 绝不出库） */
const SAFE_COLUMNS = 'id, name, address, blockchain, reserve_native, created_at, updated_at';

/** EVM 明文私钥嗅探：0x + 64 hex = 66 位（BSC-only，无 Solana 分支） */
function isEvmPlainPrivateKey(token) {
    return typeof token === 'string' && token.startsWith('0x') && token.length === 66;
}

class ExecutorService {
    constructor() {
        this.supabase = dbManager.getClient();
    }

    /** 列表（新→旧） */
    async list() {
        const { data, error } = await this.supabase
            .from('executors')
            .select(SAFE_COLUMNS)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    /**
     * 单查（安全列）
     * @returns {Promise<Object|null>}
     */
    async getById(id) {
        const { data, error } = await this.supabase
            .from('executors')
            .select(SAFE_COLUMNS)
            .eq('id', id)
            .single();
        if (error) {
            if (error.code === 'PGRST116') return null; // 不存在
            throw error;
        }
        return data;
    }

    /**
     * 创建执行器
     * @param {Object} input { name, address, auth_token, reserve_native? }
     *   auth_token 接受明文私钥（自动嗅探加密）或已加密密文（原样落库）
     */
    async create({ name, address, auth_token, reserve_native }) {
        if (!name || !address || !auth_token) {
            const err = new Error('name, address, auth_token 为必填项');
            err.status = 400;
            throw err;
        }
        const encrypted = isEvmPlainPrivateKey(auth_token)
            ? new CryptoUtils().encrypt(auth_token)
            : auth_token;

        const { data, error } = await this.supabase
            .from('executors')
            .insert([{
                name,
                address,
                auth_token: encrypted,
                blockchain: 'bsc',
                reserve_native: reserve_native ?? 0.01,
            }])
            .select(SAFE_COLUMNS)
            .single();
        if (error) {
            // 唯一索引（lower(address)）冲突 → 友好 400
            if (error.code === '23505') {
                const err = new Error(`该地址已存在执行器: ${address}`);
                err.status = 400;
                throw err;
            }
            throw error;
        }
        return data;
    }

    /**
     * 更新执行器
     * @param {string} id
     * @param {Object} updates { name?, address?, auth_token?, reserve_native? }
     *   auth_token 缺省/空串 = 不修改；提供则嗅探加密后更新
     */
    async update(id, updates = {}) {
        const patch = {};
        if (updates.name !== undefined) patch.name = updates.name;
        if (updates.address !== undefined) patch.address = updates.address;
        if (updates.reserve_native !== undefined) patch.reserve_native = updates.reserve_native;
        if (updates.auth_token) {
            patch.auth_token = isEvmPlainPrivateKey(updates.auth_token)
                ? new CryptoUtils().encrypt(updates.auth_token)
                : updates.auth_token;
        }
        if (Object.keys(patch).length === 0) {
            const err = new Error('无可更新字段');
            err.status = 400;
            throw err;
        }
        patch.updated_at = new Date().toISOString();

        const { data, error } = await this.supabase
            .from('executors')
            .update(patch)
            .eq('id', id)
            .select(SAFE_COLUMNS)
            .single();
        if (error) {
            if (error.code === '23505') {
                const err = new Error(`该地址已存在执行器: ${updates.address}`);
                err.status = 400;
                throw err;
            }
            if (error.code === 'PGRST116') {
                const err = new Error(`执行器不存在: ${id}`);
                err.status = 404;
                throw err;
            }
            throw error;
        }
        return data;
    }

    /**
     * 删除执行器——先做 live 实验关联检查（config.wallet.executorId 引用）
     * （修复 rich-js 弱点：旧版查 config?.wallet?.executorId 之外的路径漏检，
     *   在用钱包可被删导致实验启动失败；此处扫全部 live 实验的新键引用）
     */
    async remove(id) {
        // 关联检查：live 实验 config.wallet.executorId === id
        const { data: experiments, error: expError } = await this.supabase
            .from('experiments')
            .select('id, experiment_name, config')
            .eq('trading_mode', 'live');
        if (expError) throw expError;
        const linked = (experiments || []).filter(e => e.config?.wallet?.executorId === id);
        if (linked.length > 0) {
            const err = new Error(
                `该执行器关联了 ${linked.length} 个 live 实验，请先解除关联（实验: ${
                    linked.map(e => e.experiment_name || e.id).join(', ')}）`);
            err.status = 400;
            err.linked = linked.map(e => ({ id: e.id, name: e.experiment_name }));
            throw err;
        }

        const { error } = await this.supabase.from('executors').delete().eq('id', id);
        if (error) throw error;
        return true;
    }
}

module.exports = { ExecutorService, SAFE_COLUMNS, isEvmPlainPrivateKey };
