/**
 * Case 集合服务（2026-11-20 Case 集合管理系统）
 *
 * 多 Case 集合 × 多代币的 CRUD + ticks/events 数据复制到集合专属持久表
 * （case_ticks/case_events 快照语义：原 wss_price_ticks/wss_events 行被清理
 * 或删实验级联后 Case 资产不受影响）+ 回测派生实验反查。
 *
 * 核心裁定（DDL 头注同步，勿随意改动）：
 *   * case_ticks id=IDENTITY 自有分配（源 id 仅 source_tick_id 审计）——源 id 作
 *     BacktestTickCache 增量游标在「token 后补」场景永久静默漏行；
 *   * ★同集合复制严格串行（this._chain 全局串行链）：并发插入时 IDENTITY 分配序
 *     ≠提交序，回测 headAnchor 闭区间封闭后 id<anchor 的行永久漏——绝不并发；
 *   * 同一 token 可入多集合：唯一约束全为 (collection_id,…) 维度，各集合独立副本；
 *   * 无 token_create 事件行的地址拒绝添加（宁拒不漏，不走 experiment_tokens
 *     兜底——该表随实验删除级联消失，兜底本身即不稳固数据源）。
 *
 * 复制查询纪律（对齐 BacktestEngine 装载纪律）：
 *   * ticks=单 token 等值 keyset（.eq(token).eq(platform).gt(id).order(id asc)
 *     .limit(500)）——仓库唯一允许 ORDER BY id 的形状；
 *   * 事件步=count exact+无序 limit 1000 对账，count>上限 fail-loud 宁拒不漏
 *     （单 token 三类低频事件物理不可能超千）；
 *   * 幂等=upsert onConflict(collection_id,tx_hash,log_index) ignoreDuplicates
 *     +双源水位（tick_watermark_id/event_watermark_id 分属两源表 id 序）。
 *
 * ⚠️ DB 访问一律 dbManager.getClient()（service key）——表 RLS service_role-only。
 * dbManager 在方法内 lazy require：require 本文件零 DB（校验纯函数供零 DB 单测，
 * 对齐 StrategyLibraryService 惯例）。
 * ⚠️ 重查询纪律：复制任务由生产 web（182）进程内执行；本地 web 调试时同步大票
 *    会慢/超时（红线 #9 本地不走重查询），仅适合小验证。
 */

const SYNC_TICK_PAGE = 500;          // ticks keyset 页大小（< Supabase max-rows 1000）
const SYNC_EVENT_LIMIT = 1000;       // 事件步无序拉取上限（= max-rows 硬上限）
const SYNC_MAX_ROWS_PER_RUN = 200000; // 单次同步护栏（超限置 failed 带进度，重点续传）
const SYNC_LEASE_MS = 10 * 60 * 1000; // 租约陈旧阈值（syncing 超时视为残留可接管）
const LIST_TOKENS_LIMIT = 10000;     // list() 聚合拉取上限（count 对账防静默截断）
const TAG_MAX_LEN = 40;              // 标签长度上限（中文标签 40 字符足够；对齐 name ≤120 的收紧）
const TAG_ADDR_BATCH = 50;           // 标签按地址批 .in 上限（红线：Supabase .in() URL 超 8KB）

/** 平台域（与 resolvePlatforms 输出一致） */
const CASE_PLATFORMS = ['fourmeme', 'flap', 'gang'];

/**
 * 地址归一+形状校验（纯函数）
 * @returns {string} 小写地址
 * @throws {Error.status=400} 非 0x+40hex
 */
function normalizeTokenAddress(addr) {
  const v = String(addr || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(v)) {
    const e = new Error(`tokenAddress 形状非法（须 0x + 40 位 hex）: ${addr}`);
    e.status = 400;
    throw e;
  }
  return v;
}

/**
 * 集合输入校验（纯函数）
 * @returns {{name: string, description: string}}
 * @throws {Error.status=400}
 */
function validateCollectionInput({ name, description = '' }) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    const e = new Error('name 必填（非空字符串）');
    e.status = 400;
    throw e;
  }
  if (name.trim().length > 120) {
    const e = new Error('name 过长（≤120 字符）');
    e.status = 400;
    throw e;
  }
  return { name: name.trim(), description: String(description || '').trim() };
}

/**
 * 标签归一+校验（纯函数；表不设 CHECK——校验在此，可单测）
 * @returns {string} trim 后标签
 * @throws {Error.status=400} 空 / 超长 / 控制字符（防 UI 注入混乱）
 */
function normalizeTag(tag) {
  if (typeof tag !== 'string') {
    const e = new Error('tag 必填（字符串）');
    e.status = 400;
    throw e;
  }
  const v = tag.trim();
  if (!v) {
    const e = new Error('tag 必填（非空字符串）');
    e.status = 400;
    throw e;
  }
  if (v.length > TAG_MAX_LEN) {
    const e = new Error(`tag 过长（≤${TAG_MAX_LEN} 字符）: ${v.slice(0, 20)}…`);
    e.status = 400;
    throw e;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) {
    const e = new Error('tag 含控制字符（非法）');
    e.status = 400;
    throw e;
  }
  return v;
}

/**
 * 标签数组归一+去重+校验（纯函数；逗号分隔字符串→数组入口共享）
 * 空输入（''/空数组）→ []（无标签意图）；数组内含非法元素 → 400（整体拒绝）。
 * @returns {string[]} 归一后去重标签（保持输入顺序）
 * @throws {Error.status=400} 任一非法
 */
function normalizeTags(tags) {
  const list = Array.isArray(tags)
    ? tags
    : (String(tags || '').trim() === '' ? [] : String(tags).split(','));
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const v = normalizeTag(raw);
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * wss_events token_create 行 → token_meta 快照（纯函数；形状契约：payload 原样
 * +blockTimeIso+溯源键——装载侧经 token-create-meta.js 纯函数映射七键，与窗口
 * 通道逐字节同映射，快照不预映射防漂移）
 */
function buildTokenMetaSnapshot(createRow) {
  return {
    payload: createRow.payload || {},
    blockTimeIso: createRow.block_time || null,
    sourceEventId: createRow.id != null ? Number(createRow.id) : null,
    platform: createRow.platform || 'fourmeme',
  };
}

class CaseCollectionService {
  /**
   * @param {object} [deps] 测试注入 { client }（fake supabase builder）；生产缺省
   *   lazy dbManager.getClient()
   */
  constructor(deps = {}) {
    this._deps = deps;
    this._bootAt = new Date().toISOString(); // 重启 sweep 边界：此前的 syncing 必为残留
    this._chain = Promise.resolve();         // ★全局串行复制链（裁定：绝不并发）
    this._running = new Set();               // 内存运行态（`${collectionId}::${token}`）
    this._swept = false;
  }

  _client() {
    if (this._deps.client) return this._deps.client;
    const { dbManager } = require('../../services/dbManager');
    return dbManager.getClient();
  }

  /** 重启恢复：进程启动前的 syncing 行必为上个进程残留 → failed（可重试，水位幂等）。只跑一次。 */
  async _ensureSweep() {
    if (this._swept) return;
    this._swept = true;
    try {
      await this._client()
        .from('case_collection_tokens')
        .update({ sync_state: 'failed', sync_error: 'web-server 重启中断（可重试）' })
        .eq('sync_state', 'syncing')
        .lt('sync_started_at', this._bootAt);
    } catch (err) {
      // sweep 失败不阻断业务（下次进程重启再扫；租约 10min 兜底可接管）
      this._swept = false;
      console.warn('[CaseCollectionService] 重启 sweep 失败（不阻断）:', err.message);
    }
  }

  // ─────────────────────────── 集合 CRUD ───────────────────────────

  /** 集合列表（含 token 数/sync 汇总/tick 总数；创建页下拉与库页共用） */
  async list() {
    await this._ensureSweep();
    const c = this._client();
    const { data: cols, error } = await c.from('case_collections')
      .select('id, name, description, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) throw this._dbError('读取集合列表失败', error);
    // token 聚合：轻列一次拉全（集合=人管理量级；count 对账防 max-rows 静默截断）
    const { data: toks, count, error: terr } = await c.from('case_collection_tokens')
      .select('collection_id, sync_state, tick_count, event_count', { count: 'exact' })
      .limit(LIST_TOKENS_LIMIT);
    if (terr) throw this._dbError('读取集合成员失败', terr);
    if (count != null && count > LIST_TOKENS_LIMIT) {
      const e = new Error(`集合成员行数 ${count} 超拉取上限 ${LIST_TOKENS_LIMIT}（数据形状异常，fail-loud）`);
      e.status = 500;
      throw e;
    }
    const agg = new Map(); // collection_id → {tokenCount, synced, failed, pending, syncing, tickTotal, eventTotal}
    for (const t of toks || []) {
      const a = agg.get(t.collection_id) || {
        tokenCount: 0, synced: 0, failed: 0, pending: 0, syncing: 0, tickTotal: 0, eventTotal: 0,
      };
      a.tokenCount += 1;
      if (t.sync_state === 'synced') a.synced += 1;
      else if (t.sync_state === 'failed') a.failed += 1;
      else if (t.sync_state === 'syncing') a.syncing += 1;
      else a.pending += 1;
      a.tickTotal += Number(t.tick_count) || 0;
      a.eventTotal += Number(t.event_count) || 0;
      agg.set(t.collection_id, a);
    }
    return (cols || []).map(row => ({ ...row, ...(agg.get(row.id) || {
      tokenCount: 0, synced: 0, failed: 0, pending: 0, syncing: 0, tickTotal: 0, eventTotal: 0,
    }) }));
  }

  async create({ name, description }) {
    const input = validateCollectionInput({ name, description });
    const c = this._client();
    const { data, error } = await c.from('case_collections')
      .insert({ name: input.name, description: input.description })
      .select('id, name, description, created_at, updated_at')
      .single();
    if (error) {
      if (error.code === '23505') {
        const e = new Error(`集合名已存在: ${input.name}`);
        e.status = 409;
        throw e;
      }
      throw this._dbError('创建集合失败', error);
    }
    return data;
  }

  async update(id, { name, description }) {
    const input = validateCollectionInput({ name, description });
    const c = this._client();
    const { data, error } = await c.from('case_collections')
      .update({ name: input.name, description: input.description, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name, description, created_at, updated_at')
      .single();
    if (error) {
      if (error.code === '23505') {
        const e = new Error(`集合名已存在: ${input.name}`);
        e.status = 409;
        throw e;
      }
      throw this._dbError('更新集合失败', error);
    }
    if (!data) {
      const e = new Error(`集合不存在: ${id}`);
      e.status = 404;
      throw e;
    }
    return data;
  }

  /**
   * 删除集合（级联删成员+ticks+events 副本——用户裁定；响应带删除前规模供前端 confirm）
   */
  async remove(id) {
    await this._ensureSweep();
    const c = this._client();
    const { data: toks, error } = await c.from('case_collection_tokens')
      .select('tick_count, event_count')
      .eq('collection_id', id);
    if (error) throw this._dbError('查询集合规模失败', error);
    const scale = {
      tokens: (toks || []).length,
      ticks: (toks || []).reduce((s, t) => s + (Number(t.tick_count) || 0), 0),
      events: (toks || []).reduce((s, t) => s + (Number(t.event_count) || 0), 0),
    };
    const { error: delErr } = await c.from('case_collections').delete().eq('id', id);
    if (delErr) throw this._dbError('删除集合失败', delErr);
    return { id, removed: scale };
  }

  /** 集合详情（成员全列） */
  async getDetail(id) {
    await this._ensureSweep();
    const c = this._client();
    const { data: col, error } = await c.from('case_collections')
      .select('id, name, description, created_at, updated_at')
      .eq('id', id).single();
    if (error || !col) {
      const e = new Error(`集合不存在: ${id}`);
      e.status = 404;
      throw e;
    }
    const { data: tokens, error: terr } = await c.from('case_collection_tokens')
      .select('id, token_address, platform, note, token_meta, sync_state, sync_error, sync_started_at, tick_count, event_count, tick_watermark_id, event_watermark_id, last_synced_at, added_at')
      .eq('collection_id', id)
      .order('added_at', { ascending: true })
      .limit(LIST_TOKENS_LIMIT);
    if (terr) throw this._dbError('读取集合成员失败', terr);
    return { ...col, tokens: tokens || [] };
  }

  // ─────────────────────────── 成员代币 ───────────────────────────

  /**
   * 添加代币：查 wss_events token_create（无序 limit+count 对账，多行去重取最早
   * block_time——与 BacktestEngine 窗口通道同口径）→ 入库 pending → 自动入队同步
   * （用户裁定「自动后台复制」）。无 token_create 行 → 400 宁拒不漏。
   * tags：可选初始标签（先标签后代币——标签不挂 FK 可独立存在，dup 409 /
   * insert 失败时已打标签语义仍正确：用户补标签意图不因成员行失败丢失）。
   */
  async addToken(collectionId, { tokenAddress, note = '', tags = [] }) {
    await this._ensureSweep();
    const addr = normalizeTokenAddress(tokenAddress);
    const tagList = normalizeTags(tags);
    const c = this._client();
    // 集合存在性
    const { data: col } = await c.from('case_collections').select('id, name').eq('id', collectionId).single();
    if (!col) {
      const e = new Error(`集合不存在: ${collectionId}`);
      e.status = 404;
      throw e;
    }
    // token_create 行（无序 limit + count 对账；单 token 重复 create 物理不可能超千）
    const { data: rows, count, error } = await c.from('wss_events')
      .select('id, token_address, platform, payload, block_time', { count: 'exact' })
      .eq('kind', 'token_create')
      .eq('token_address', addr)
      .limit(SYNC_EVENT_LIMIT);
    if (error) throw this._dbError('查询 token_create 失败', error);
    if (count != null && count > SYNC_EVENT_LIMIT) {
      const e = new Error(`token_create 事件行 ${count} 超上限（数据形状异常，宁拒不漏）: ${addr}`);
      e.status = 500;
      throw e;
    }
    const list = rows || [];
    if (!list.length) {
      const e = new Error(`wss_events 无该代币 token_create 事件（地址错误或采集未覆盖）——宁拒不漏，不走 experiment_tokens 兜底: ${addr}`);
      e.status = 400;
      throw e;
    }
    let chosen = list[0];
    for (const row of list) {
      if (new Date(row.block_time).getTime() < new Date(chosen.block_time).getTime()) chosen = row;
    }
    if (!CASE_PLATFORMS.includes(chosen.platform)) {
      const e = new Error(`token_create 行 platform 异常: ${chosen.platform}（${addr}）`);
      e.status = 500;
      throw e;
    }
    // 标签先落（幂等 upsert；不依赖代币行存在——裁定：先标签后代币，
    // 后续 dup 409 / insert 失败时已打标签语义仍正确）
    if (tagList.length) {
      const { error: tagErr } = await c.from('case_token_tags')
        .upsert(tagList.map((tag) => ({ token_address: addr, tag })), { onConflict: 'token_address,tag', ignoreDuplicates: true });
      if (tagErr) throw this._dbError('写入标签失败', tagErr);
    }
    // 幂等：本集合已存在 → 409（跨集合允许同 token=独立副本）
    const { data: dup } = await c.from('case_collection_tokens')
      .select('id').eq('collection_id', collectionId).eq('token_address', addr).maybeSingle();
    if (dup) {
      const e = new Error(`该代币已在本集合中: ${addr}`);
      e.status = 409;
      throw e;
    }
    const { data: token, error: ierr } = await c.from('case_collection_tokens')
      .insert({
        collection_id: collectionId,
        token_address: addr,
        platform: chosen.platform,
        note: String(note || '').trim(),
        token_meta: buildTokenMetaSnapshot(chosen),
      })
      .select('id, token_address, platform, note, token_meta, sync_state, sync_error, sync_started_at, tick_count, event_count, tick_watermark_id, event_watermark_id, last_synced_at, added_at')
      .single();
    if (ierr) throw this._dbError('添加代币失败', ierr);
    // 自动后台复制（用户裁定）
    this.enqueueSync(collectionId, addr);
    return token;
  }

  async updateTokenNote(collectionId, tokenAddress, { note }) {
    const addr = normalizeTokenAddress(tokenAddress);
    const c = this._client();
    const { data, error } = await c.from('case_collection_tokens')
      .update({ note: String(note || '').trim() })
      .eq('collection_id', collectionId).eq('token_address', addr)
      .select('id, token_address, platform, note, sync_state, tick_count')
      .single();
    if (error || !data) {
      const e = new Error(`成员不存在: ${addr}`);
      e.status = 404;
      throw e;
    }
    return data;
  }

  /** 移除代币（级联删该票 ticks+events 副本；响应带规模） */
  async removeToken(collectionId, tokenAddress) {
    await this._ensureSweep();
    const addr = normalizeTokenAddress(tokenAddress);
    const c = this._client();
    const { data: row } = await c.from('case_collection_tokens')
      .select('tick_count, event_count')
      .eq('collection_id', collectionId).eq('token_address', addr).maybeSingle();
    if (!row) {
      const e = new Error(`成员不存在: ${addr}`);
      e.status = 404;
      throw e;
    }
    const { error } = await c.from('case_collection_tokens')
      .delete().eq('collection_id', collectionId).eq('token_address', addr);
    if (error) throw this._dbError('移除代币失败', error);
    return {
      collectionId, tokenAddress: addr,
      removed: { ticks: Number(row.tick_count) || 0, events: Number(row.event_count) || 0 },
    };
  }

  // ─────────────────────────── 代币标签（全局代币级） ───────────────────────────

  /**
   * 标签行分地址批 .in 查询 + count 对账（红线：地址批 .in ≤50 防 URL 超 8KB；
   * 上限对账防 max-rows 静默截断）。返回全部标签行。
   */
  async _fetchTagRowsByAddresses(addresses) {
    const c = this._client();
    const rows = [];
    for (let i = 0; i < addresses.length; i += TAG_ADDR_BATCH) {
      const batch = addresses.slice(i, i + TAG_ADDR_BATCH);
      const { data, count, error } = await c.from('case_token_tags')
        .select('token_address, tag', { count: 'exact' })
        .in('token_address', batch)
        .limit(LIST_TOKENS_LIMIT);
      if (error) throw this._dbError('读取标签失败', error);
      if (count != null && count > LIST_TOKENS_LIMIT) {
        const e = new Error(`标签行数 ${count} 超拉取上限 ${LIST_TOKENS_LIMIT}（数据形状异常，fail-loud）`);
        e.status = 500;
        throw e;
      }
      rows.push(...(data || []));
    }
    return rows;
  }

  /** 单代币标签列表（无序；created_at 升序展示稳定） */
  async getTagsForToken(tokenAddress) {
    const addr = normalizeTokenAddress(tokenAddress);
    const c = this._client();
    const { data, error } = await c.from('case_token_tags')
      .select('token_address, tag, created_at')
      .eq('token_address', addr)
      .order('created_at', { ascending: true })
      .limit(LIST_TOKENS_LIMIT);
    if (error) throw this._dbError('读取代币标签失败', error);
    return (data || []).map((r) => r.tag);
  }

  /** 添加标签（幂等：重复加无副作用）。返回该票最新标签列表。 */
  async addTokenTag(tokenAddress, { tag }) {
    const addr = normalizeTokenAddress(tokenAddress);
    const v = normalizeTag(tag);
    const c = this._client();
    const { error } = await c.from('case_token_tags')
      .upsert({ token_address: addr, tag: v }, { onConflict: 'token_address,tag', ignoreDuplicates: true });
    if (error) throw this._dbError('添加标签失败', error);
    return { tokenAddress: addr, tags: await this.getTagsForToken(addr) };
  }

  /** 移除标签（不存在 → 404 fail-loud，防前端状态漂移掩盖问题）。返回该票最新标签列表。 */
  async removeTokenTag(tokenAddress, tag) {
    const addr = normalizeTokenAddress(tokenAddress);
    const v = normalizeTag(tag);
    const c = this._client();
    const { data: hit } = await c.from('case_token_tags')
      .select('tag').eq('token_address', addr).eq('tag', v).maybeSingle();
    if (!hit) {
      const e = new Error(`标签不存在: ${addr} / ${v}`);
      e.status = 404;
      throw e;
    }
    const { error } = await c.from('case_token_tags')
      .delete().eq('token_address', addr).eq('tag', v);
    if (error) throw this._dbError('移除标签失败', error);
    return { tokenAddress: addr, tags: await this.getTagsForToken(addr) };
  }

  /**
   * 全局标签聚合：[{tag, tokenCount}]（tokenCount=带该标签的代币数，按计数降序）
   * ——列表页标签检索面板数据源。
   */
  async listTags() {
    const c = this._client();
    const { data, count, error } = await c.from('case_token_tags')
      .select('tag, token_address', { count: 'exact' })
      .limit(LIST_TOKENS_LIMIT);
    if (error) throw this._dbError('读取标签聚合失败', error);
    if (count != null && count > LIST_TOKENS_LIMIT) {
      const e = new Error(`标签行数 ${count} 超拉取上限 ${LIST_TOKENS_LIMIT}（数据形状异常，fail-loud）`);
      e.status = 500;
      throw e;
    }
    const byTag = new Map(); // tag → Set(token_address)
    for (const row of data || []) {
      if (!byTag.has(row.tag)) byTag.set(row.tag, new Set());
      byTag.get(row.tag).add(row.token_address);
    }
    return [...byTag.entries()]
      .map(([tag, addrs]) => ({ tag, tokenCount: addrs.size }))
      .sort((a, b) => b.tokenCount - a.tokenCount || a.tag.localeCompare(b.tag));
  }

  /**
   * 按标签查询（「每个标签可以用于查询」）：返回带该标签的全部代币及其所在
   * 集合（name/sync 状态），未入集合的代币 collections=[]（孤儿标签可见）。
   */
  async findTokensByTag(tag) {
    const v = normalizeTag(tag);
    const c = this._client();
    const { data: tagRows, count, error } = await c.from('case_token_tags')
      .select('token_address, tag, created_at', { count: 'exact' })
      .eq('tag', v)
      .order('created_at', { ascending: true })
      .limit(LIST_TOKENS_LIMIT);
    if (error) throw this._dbError('按标签查询失败', error);
    if (count != null && count > LIST_TOKENS_LIMIT) {
      const e = new Error(`标签命中行数 ${count} 超拉取上限 ${LIST_TOKENS_LIMIT}（数据形状异常，fail-loud）`);
      e.status = 500;
      throw e;
    }
    const addresses = [...new Set((tagRows || []).map((r) => r.token_address))];
    const memberships = new Map(); // addr → [{collectionId, collectionName, syncState, note}]
    for (let i = 0; i < addresses.length; i += TAG_ADDR_BATCH) {
      const batch = addresses.slice(i, i + TAG_ADDR_BATCH);
      const { data: mems, error: merr } = await c.from('case_collection_tokens')
        .select('token_address, collection_id, sync_state, note')
        .in('token_address', batch)
        .limit(LIST_TOKENS_LIMIT);
      if (merr) throw this._dbError('查询成员归属失败', merr);
      for (const m of mems || []) {
        if (!memberships.has(m.token_address)) memberships.set(m.token_address, []);
        memberships.get(m.token_address).push({
          collectionId: m.collection_id,
          collectionName: null, // 下步填充
          syncState: m.sync_state,
          note: m.note,
        });
      }
    }
    // 集合名补齐（成员行量级小，一次拉全）
    const colIds = [...new Set([...memberships.values()].flat().map((m) => m.collectionId))];
    if (colIds.length) {
      const { data: cols, error: cerr } = await c.from('case_collections')
        .select('id, name')
        .in('id', colIds)
        .limit(LIST_TOKENS_LIMIT);
      if (cerr) throw this._dbError('查询集合名失败', cerr);
      const nameOf = new Map((cols || []).map((x) => [x.id, x.name]));
      for (const list of memberships.values()) {
        for (const m of list) m.collectionName = nameOf.get(m.collectionId) || null;
      }
    }
    return {
      tag: v,
      tokens: (tagRows || []).map((r) => ({
        tokenAddress: r.token_address,
        taggedAt: r.created_at,
        collections: memberships.get(r.token_address) || [],
      })),
    };
  }

  /**
   * 集合内标签数据（详情页一次性拉取）：{tags: [{tag,count}], tokenTags: {addr: [tags]}}
   * ——本集合成员地址批 .in 查询分组注入；不查全表（轮询路径省查询）。
   */
  async getCollectionTags(collectionId) {
    await this._ensureSweep();
    const c = this._client();
    const { data: toks, error } = await c.from('case_collection_tokens')
      .select('token_address')
      .eq('collection_id', collectionId)
      .limit(LIST_TOKENS_LIMIT);
    if (error) throw this._dbError('读取集合成员失败', error);
    const addresses = (toks || []).map((t) => t.token_address);
    const tokenTags = {}; // addr → [tags]
    const countOf = new Map(); // tag → 集合内计数
    const rows = await this._fetchTagRowsByAddresses(addresses);
    for (const r of rows) {
      if (!tokenTags[r.token_address]) tokenTags[r.token_address] = [];
      tokenTags[r.token_address].push(r.tag);
      countOf.set(r.tag, (countOf.get(r.tag) || 0) + 1);
    }
    const tags = [...countOf.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    return { tags, tokenTags };
  }

  // ─────────────────────────── 数据复制（同步） ───────────────────────────

  /**
   * 入队同步（串行链；立即返回）。幂等：重复入队同 token 由运行态去重。
   */
  enqueueSync(collectionId, tokenAddress) {
    const key = `${collectionId}::${String(tokenAddress).toLowerCase()}`;
    if (this._running.has(key)) return { queued: false, key };
    this._running.add(key);
    this._chain = this._chain
      .then(() => this._syncTokenGuarded(collectionId, String(tokenAddress).toLowerCase(), key))
      .catch((err) => {
        // 链上任务自身已落 failed；此处兜住防链断裂（后续任务照跑）
        console.warn(`[CaseCollectionService] 同步任务异常退出（${key}）:`, err.message);
      });
    return { queued: true, key };
  }

  /** 全量同步：集合内 pending/failed 成员逐个入队（串行链天然串行） */
  async enqueueSyncAll(collectionId) {
    await this._ensureSweep();
    const c = this._client();
    const { data: toks, error } = await c.from('case_collection_tokens')
      .select('token_address, sync_state')
      .eq('collection_id', collectionId)
      .in('sync_state', ['pending', 'failed']);
    if (error) throw this._dbError('读取待同步成员失败', error);
    let queued = 0;
    for (const t of toks || []) {
      const r = this.enqueueSync(collectionId, t.token_address);
      if (r.queued) queued += 1;
    }
    return { queued, total: (toks || []).length };
  }

  async _syncTokenGuarded(collectionId, addr, key) {
    try {
      await this._syncToken(collectionId, addr);
    } finally {
      this._running.delete(key);
    }
  }

  /**
   * 复制执行器（核心）：事件步（token_create/graduation/token_quote_set 镜像）+
   * ticks keyset 循环 + 双水位推进 + 收尾 count 对账。
   * 异常→failed+sync_error（已推进水位保留=重试幂等续传）。
   */
  async _syncToken(collectionId, addr) {
    const c = this._client();
    const { data: token, error: terr } = await c.from('case_collection_tokens')
      .select('id, platform, sync_state, sync_started_at, tick_watermark_id, event_watermark_id')
      .eq('collection_id', collectionId).eq('token_address', addr).single();
    if (terr || !token) return; // 已被移除——静默跳过（队列残留任务）
    // 租约守卫：别的运行持新鲜租约 → 让位（不置 failed，避免覆盖在跑任务的状态）
    if (token.sync_state === 'syncing' && token.sync_started_at) {
      const leaseAge = Date.now() - new Date(token.sync_started_at).getTime();
      if (leaseAge >= 0 && leaseAge < SYNC_LEASE_MS) {
        console.warn(`[CaseCollectionService] 同步租约冲突让位（${addr}@${collectionId}，租约 ${Math.round(leaseAge / 1000)}s）`);
        return;
      }
    }
    await c.from('case_collection_tokens')
      .update({ sync_state: 'syncing', sync_started_at: new Date().toISOString(), sync_error: null })
      .eq('collection_id', collectionId).eq('token_address', addr);
    try {
      const tickWatermark0 = Number(token.tick_watermark_id) || 0;
      const eventWatermark0 = Number(token.event_watermark_id) || 0;
      // ── 事件步：三类低频事件镜像（count 对账，count>上限 fail-loud 宁拒不漏）──
      const { data: evRows, count: evCount, error: evErr } = await c.from('wss_events')
        .select('id, kind, platform, payload, block_time', { count: 'exact' })
        .eq('token_address', addr)
        .in('kind', ['token_create', 'graduation', 'token_quote_set'])
        .gt('id', eventWatermark0)
        .limit(SYNC_EVENT_LIMIT);
      if (evErr) throw new Error(`事件步查询失败: ${evErr.message}`);
      if (evCount != null && evCount > SYNC_EVENT_LIMIT) {
        throw new Error(`事件行 ${evCount} 超上限 ${SYNC_EVENT_LIMIT}（数据形状异常，宁拒不漏）`);
      }
      if ((evRows || []).length !== (evCount || 0)) {
        throw new Error(`事件步对账失配（无序页 ${evRows.length} ≠ count ${evCount}）`);
      }
      if (evRows && evRows.length) {
        const evInsert = evRows.map(r => ({
          source_event_id: Number(r.id),
          collection_id: collectionId,
          token_address: addr,
          kind: r.kind,
          platform: r.platform,
          payload: r.payload,
          block_time: r.block_time,
        }));
        const { error: evInsErr } = await c.from('case_events').insert(evInsert);
        if (evInsErr) throw new Error(`case_events 写入失败: ${evInsErr.message}`);
        const evMax = Math.max(...evRows.map(r => Number(r.id)));
        await c.from('case_collection_tokens')
          .update({ event_watermark_id: evMax })
          .eq('collection_id', collectionId).eq('token_address', addr);
      }
      // ── ticks 步：单 token 等值 keyset（唯一允许 ORDER BY id 的形状）──
      let watermark = tickWatermark0;
      let copied = 0;
      for (;;) {
        const { data: batch, error: qErr } = await c.from('wss_price_ticks')
          .select('id, token_address, tx_hash, log_index, trade_type, trader_address, sender_address, price_bnb, price_usd, bnb_amount, token_amount, price_outlier, block_number, block_time, received_at, platform, quote_token')
          .eq('token_address', addr)
          .eq('platform', token.platform)
          .gt('id', watermark)
          .order('id', { ascending: true })
          .limit(SYNC_TICK_PAGE);
        if (qErr) throw new Error(`ticks 拉取失败: ${qErr.message}`);
        if (!batch || !batch.length) break;
        const rows = batch.map(r => ({
          source_tick_id: Number(r.id),
          collection_id: collectionId,
          token_address: r.token_address,
          tx_hash: r.tx_hash,
          log_index: r.log_index,
          trade_type: r.trade_type,
          trader_address: r.trader_address,
          sender_address: r.sender_address,
          price_bnb: r.price_bnb,
          price_usd: r.price_usd,
          bnb_amount: r.bnb_amount,
          token_amount: r.token_amount,
          price_outlier: r.price_outlier,
          block_number: r.block_number,
          block_time: r.block_time,
          received_at: r.received_at,
          platform: r.platform,
          quote_token: r.quote_token,
        }));
        const { error: upErr } = await c.from('case_ticks')
          .upsert(rows, { onConflict: 'collection_id,tx_hash,log_index', ignoreDuplicates: true });
        if (upErr) throw new Error(`case_ticks 写入失败: ${upErr.message}`);
        watermark = Number(batch[batch.length - 1].id);
        copied += batch.length;
        // 每批回写水位：崩溃后从上次批尾续传（幂等）
        await c.from('case_collection_tokens')
          .update({ tick_watermark_id: watermark })
          .eq('collection_id', collectionId).eq('token_address', addr);
        if (copied >= SYNC_MAX_ROWS_PER_RUN) {
          throw new Error(`单次同步护栏 ${SYNC_MAX_ROWS_PER_RUN} 行已复制 ${copied} 行——置 failed 保留进度，再次点击同步续传`);
        }
        if (batch.length < SYNC_TICK_PAGE) break;
      }
      // ── 收尾：count 对账实数回写（零 tick 合法=真零成交票）──
      const { count: tk, error: tkErr } = await c.from('case_ticks')
        .select('id', { count: 'exact', head: true })
        .eq('collection_id', collectionId).eq('token_address', addr);
      if (tkErr) throw new Error(`tick_count 对账失败: ${tkErr.message}`);
      const { count: ec, error: ecErr } = await c.from('case_events')
        .select('id', { count: 'exact', head: true })
        .eq('collection_id', collectionId).eq('token_address', addr);
      if (ecErr) throw new Error(`event_count 对账失败: ${ecErr.message}`);
      await c.from('case_collection_tokens')
        .update({
          sync_state: 'synced',
          sync_error: null,
          sync_started_at: null,
          last_synced_at: new Date().toISOString(),
          tick_count: tk || 0,
          event_count: ec || 0,
        })
        .eq('collection_id', collectionId).eq('token_address', addr);
      console.log(`[CaseCollectionService] 同步完成: ${addr}@${collectionId} ticks=${tk || 0} events=${ec || 0}（本次复制 ${copied}）`);
    } catch (err) {
      await c.from('case_collection_tokens')
        .update({ sync_state: 'failed', sync_error: String(err.message || err).slice(0, 500) })
        .eq('collection_id', collectionId).eq('token_address', addr)
        .then(() => {}, () => {});
      throw err;
    }
  }

  /** 同步状态（DB 真源 + 内存运行态；前端轮询） */
  async syncStatus(collectionId) {
    await this._ensureSweep();
    const c = this._client();
    const { data: toks, error } = await c.from('case_collection_tokens')
      .select('token_address, sync_state, sync_error, tick_count, event_count, tick_watermark_id, event_watermark_id, last_synced_at')
      .eq('collection_id', collectionId)
      .order('added_at', { ascending: true })
      .limit(LIST_TOKENS_LIMIT);
    if (error) throw this._dbError('读取同步状态失败', error);
    const summary = { total: 0, synced: 0, failed: 0, pending: 0, syncing: 0 };
    const tokens = (toks || []).map(t => {
      summary.total += 1;
      summary[t.sync_state] = (summary[t.sync_state] || 0) + 1;
      return {
        tokenAddress: t.token_address,
        syncState: t.sync_state,
        syncError: t.sync_error,
        tickCount: Number(t.tick_count) || 0,
        eventCount: Number(t.event_count) || 0,
        tickWatermarkId: Number(t.tick_watermark_id) || 0,
        eventWatermarkId: Number(t.event_watermark_id) || 0,
        lastSyncedAt: t.last_synced_at,
        running: this._running.has(`${collectionId}::${t.token_address}`),
      };
    });
    return { summary, tokens };
  }

  /** 派生回测实验反查（experiments 量级小，jsonb 路径过滤无性能顾虑） */
  async listDerivedExperiments(collectionId) {
    const c = this._client();
    const { data, error } = await c.from('experiments')
      .select('id, name, status, trading_mode, created_at')
      .eq('config->backtest->>caseCollectionId', collectionId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw this._dbError('派生实验反查失败', error);
    return data || [];
  }

  _dbError(prefix, dbError) {
    const e = new Error(`${prefix}: ${dbError.message}`);
    e.status = 500;
    e.cause = dbError;
    return e;
  }
}

module.exports = {
  CaseCollectionService,
  normalizeTokenAddress,
  validateCollectionInput,
  normalizeTag,
  normalizeTags,
  buildTokenMetaSnapshot,
  CASE_PLATFORMS,
  SYNC_TICK_PAGE,
  SYNC_EVENT_LIMIT,
  SYNC_MAX_ROWS_PER_RUN,
  TAG_MAX_LEN,
  TAG_ADDR_BATCH,
};
