/**
 * 持仓分析服务（TokenPositionAnalyzer 落表数据展示；pumpfun 回迁批 4 web 展示）
 *
 * 数据源：token_position_analyses 表（每触发代币一行，v1 trigger_no=1）。
 * 与 StrategyAnalysisService 的区别：strategy-analysis 是 per-tick replay（重算因子），
 *   本服务是「读模块已落表的 as-of 分析结果」（verdict / holding 因子）。
 *
 * BSC 适配（对齐母版 PositionAnalysisService）：
 *   - token 分类读 token_profiles 全局表（token_address PK，无 experiment 维度）——
 *     母版按 pumpfun_tokens.token_profile 挂实验 id 需 source 转换，此处直接 .in() 查询
 *   - _persist 不落 wallet_profiles/wallet_score_summary（对齐母版现行 4c461cf 瘦身后），
 *     totalScore 落表镜像在 holding_factors.TPAPre_tokenScore（列表「代币总分」列同源读法）
 *   - 表达式过滤触发快照操作数：buyBnb / currentPriceBnb（BSC 原生价口径）
 */

const { dbManager } = require('../../services/dbManager');
// HOLDING_FACTOR_KEYS（已带 TPAPre_ 前缀）= 历史数据兼容映射的真相源（旧数据键名无前缀，按前缀切片反推旧名）
const { HOLDING_FACTOR_KEYS } = require('../../services/tpa-factor-keys');

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

class PositionAnalysisService {

  /**
   * 列表 + 聚合 summary。
   * @param {string} experimentId
   * @param {Object} [opts] { verdict, limit, offset, profileCategory, search, expression }
   *   - expression: ConditionEvaluator 表达式（与策略 condition 同语法），对每行 holding_factors+trigger_snapshot 内存求值过滤。
   *     ConditionEvaluator 仅支持数值比较（无字符串相等），verdict 是字符串须用 verdict 下拉而非表达式。
   */
  async getAnalyses(experimentId, opts = {}) {
    try {
      const limit = Math.min(Math.max(parseInt(opts.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      const offset = Math.max(parseInt(opts.offset) || 0, 0);
      const profileCategory = opts.profileCategory || null;
      const expression = opts.expression ? String(opts.expression).trim() : null;

      // 表达式预解析：语法错误不中断列表，结构化返回 exprError 供前端展示。
      let exprAst = null, exprError = null, evaluator = null;
      if (expression) {
        try {
          const { ConditionEvaluator } = require('../../strategies/ConditionEvaluator');
          evaluator = new ConditionEvaluator();
          exprAst = evaluator.parseCondition(expression);
        } catch (e) {
          exprError = e.message || '表达式语法错误';
        }
      }

      const supabase = dbManager.getClient();
      // select 列集不含 wallet_score_summary/wallet_profiles（richer-js _persist 不落，select 不存在列 PGRST204 报错）
      const SELECT_COLS = 'token_address,trigger_no,as_of,trigger_snapshot,verdict,block_reasons,holding_factors,enforce,created_at';

      // 内存过滤触发：离线/OPB 分类(profileCategory) 或 表达式(expression) 均需全量取行 + 内存过滤
      //   —— 分类不在本表、表达式因子在 holding_factors JSONB 内，DB 层都无法 eq 过滤。
      // 复用 _fetchAllRows 键集分页（规避 1000 行上限 + statement_timeout）；verdict/search 仍 DB 层先过一遍。
      // 单实验 token_position_analyses 通常几百~几千行轻量字段，全量可接受。
      if (profileCategory || expression) {
        // 全量键集分页取；展示需 created_at 倒序，DB 层按非索引列 order 会超时，改取回后 JS 排序（数千行 <10ms）。
        const all = await this._fetchAllRows(experimentId, SELECT_COLS, {
          builder: q => {
            if (opts.verdict) q = q.eq('verdict', opts.verdict);
            if (opts.search) q = q.ilike('token_address', '%' + String(opts.search).trim() + '%');
            return q;
          },
        });
        all.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        await this._mergeTokenProfiles(all);
        this._normalizeHoldingFactors(all);
        this._slimWalletScoreSummaries(all);
        this._attachZhuangRetail(all);

        let filtered = all;
        if (profileCategory) {
          // '__unclassified__' = 该 token 无分类行（未定性 / token_profiles 缺失）
          const isUnclassified = profileCategory === '__unclassified__';
          filtered = filtered.filter(a =>
            isUnclassified ? !a.token_profile_category : a.token_profile_category === profileCategory
          );
        }
        if (exprAst) {
          filtered = filtered.filter(a => this._evalExpression(exprAst, evaluator, a));
        }

        const summary = await this._buildSummary(experimentId);
        const verdictCondition = await this._getVerdictCondition(experimentId);
        return {
          success: true,
          data: { analyses: filtered.slice(offset, offset + limit), summary, verdictCondition, limit, offset, filteredTotal: filtered.length, exprError },
        };
      }

      let query = supabase
        .from('token_position_analyses')
        .select(SELECT_COLS)
        .eq('experiment_id', experimentId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (opts.verdict) query = query.eq('verdict', opts.verdict);
      if (opts.search) query = query.ilike('token_address', '%' + String(opts.search).trim() + '%');

      const { data, error } = await query;
      if (error) throw new Error(`查询持仓分析失败: ${error.message}`);

      const analyses = data || [];
      // 附加代币分类（token_profiles 全局表），供列表「离线/OPB 分类」列对照 TPA verdict
      await this._mergeTokenProfiles(analyses);
      this._normalizeHoldingFactors(analyses);
      this._slimWalletScoreSummaries(analyses);
      this._attachZhuangRetail(analyses);

      const summary = await this._buildSummary(experimentId);
      const verdictCondition = await this._getVerdictCondition(experimentId);

      return { success: true, data: { analyses, summary, verdictCondition, limit, offset } };
    } catch (error) {
      console.error('持仓分析列表失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 单代币完整记录（供下钻）。
   */
  async getAnalysis(experimentId, tokenAddress) {
    try {
      const supabase = dbManager.getClient();
      const { data, error } = await supabase
        .from('token_position_analyses')
        .select('*')
        .eq('experiment_id', experimentId)
        .eq('token_address', tokenAddress)
        .order('trigger_no', { ascending: false })
        .limit(1);

      if (error) throw new Error(`查询持仓分析详情失败: ${error.message}`);

      return { success: true, data: (data && data[0]) || null };
    } catch (error) {
      console.error('持仓分析详情失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 批量取代币分类（token_profiles 全局表，token_address PK 无实验维度——BSC 适配：
   * 母版按 pumpfun_tokens.token_profile 挂实验 id 需 source 转换，此处直接查）。
   * 返回 {token_address: {category, source, maxMcap, classifiedAt}}；查询失败降级为空 map（列空，不阻断主列表）。
   */
  async getTokenProfileByAddresses(addresses) {
    try {
      if (!addresses || addresses.length === 0) return {};
      const supabase = dbManager.getClient();
      const BATCH = 200; // PostgREST in() URL 长度限制，200 一批（同 ExperimentDataService.getTokenMetadataByAddresses）
      const map = {};
      for (let i = 0; i < addresses.length; i += BATCH) {
        const batch = addresses.slice(i, i + BATCH);
        const { data, error } = await supabase
          .from('token_profiles')
          .select('token_address,category,source,profile,classified_at,peak_mcap_usd')
          .in('token_address', batch);
        if (error) throw new Error(`查询 token_profiles 失败: ${error.message}`);
        (data || []).forEach(r => {
          if (r && r.category) {
            map[r.token_address] = {
              category: r.category,
              source: r.source || null,
              // 顶层冗余列优先（可索引），缺省回退 profile JSONB（=max_market_cap_usd 同值）
              maxMcap: r.peak_mcap_usd ?? (r.profile && r.profile.max_market_cap_usd) ?? null,
              classifiedAt: r.classified_at || null,
            };
          }
        });
      }
      return map;
    } catch (error) {
      console.error('查询 token_profiles 失败:', error);
      return {};
    }
  }

  /**
   * 取本实验实际生效的 zhuangCondition（verdict approve 条件字符串）。
   * 复用 TokenPositionAnalyzer.mergeConfig 同一套 normalize 规则（exp.zhuangCondition 优先，否则
   * zhuangScoreGatesToCondition 默认/老格式转换）→ 与引擎 _decideVerdict 实际求值的条件字面一致。
   * 供前端 approve 行展示 verdict 真正引用的因子（而非写死 tokenScore/庄散比）。
   */
  async _getVerdictCondition(experimentId) {
    try {
      const { mergeConfig } = require('../../services/TokenPositionAnalyzer');
      const supabase = dbManager.getClient();
      const { data, error } = await supabase.from('experiments').select('config').eq('id', experimentId).single();
      if (error || !data) return null;
      const config = typeof data.config === 'string' ? JSON.parse(data.config) : data.config;
      const tpa = (config && config.tokenPositionAnalyzer) || {};
      return mergeConfig(tpa).zhuangCondition;
    } catch (e) {
      console.error('取 verdict 条件失败:', e);
      return null;
    }
  }

  /**
   * 将代币分类合并到 analyses 每行（附 token_profile_category/source/max_mcap/classified_at）。
   */
  async _mergeTokenProfiles(analyses) {
    if (!analyses.length) return;
    const addresses = [...new Set(analyses.map(a => a.token_address).filter(Boolean))];
    const profileMap = await this.getTokenProfileByAddresses(addresses);
    analyses.forEach(a => {
      const p = profileMap[a.token_address];
      if (p && p.category) {
        a.token_profile_category = p.category;
        a.token_profile_source = p.source;
        a.token_profile_max_mcap = p.maxMcap;
        a.token_profile_classified_at = p.classifiedAt;
      }
    });
  }

  /**
   * 精简 wallet_score_summary：列表/弹窗只读 totalScore/holderCount/penalized/penaltyReason/concentration。
   * richer-js _persist 不落 wallet_score_summary/wallet_profiles（对齐母版 4c461cf 落表瘦身）——
   * totalScore 的落表镜像在 holding_factors.TPAPre_tokenScore（落表同值）——summary 缺失时
   * 回填镜像分，列表「代币总分」列/verdict 操作数实际值继续有数；holderCount/penalized 明细已不
   * 落表 → null（前端显 -）。须在 _normalizeHoldingFactors 之后调用（旧实验无前缀键先归一化）。
   */
  _slimWalletScoreSummaries(analyses) {
    for (const a of analyses) {
      const s = a.wallet_score_summary;
      if (s && typeof s === 'object') {
        a.wallet_score_summary = {
          totalScore: s.totalScore ?? null,
          holderCount: s.holderCount ?? null,
          penalized: s.penalized ?? false,
          penaltyReason: s.penaltyReason ?? null,
          concentration: s.concentration ?? null,
        };
      } else {
        const mirror = a.holding_factors?.TPAPre_tokenScore;
        if (mirror != null) {
          a.wallet_score_summary = {
            totalScore: mirror,
            holderCount: null,
            penalized: null,
            penaltyReason: null,
            concentration: null,
          };
        }
      }
    }
  }

  /**
   * 庄散聚合（4 桶占比 + 庄散比 + 持仓者数）：读 holding_factors 落表的决策口径（与 verdict 同源，
   * 由 TokenPositionAnalyzer._analyze 注入），供列表「block 原因」列 / factor 弹窗展示。无落表字段
   * （新字段上线前跑的）→ null，不回退 computeZhuangRetail 现算（现算口径随 classifyHolder
   * 演进漂移，与落表 verdict 不一致）。
   */
  _attachZhuangRetail(analyses) {
    for (const a of analyses) {
      const hf = a.holding_factors || {};
      const hasPersisted = hf.TPAPre_zhuangPct != null || hf.TPAPre_zhuangRetailRatio != null
        || hf.TPAPre_zhuangRetailRatioInfinite === true || hf.TPAPre_zhuangHolderCount != null;
      a.zhuang_retail = hasPersisted ? {
        TPAPre_zhuangPct: hf.TPAPre_zhuangPct ?? null,
        TPAPre_newWalletPct: hf.TPAPre_newWalletPct ?? null,
        TPAPre_retailPct: hf.TPAPre_retailPct ?? null,
        TPAPre_neutralPct: hf.TPAPre_neutralPct ?? null,
        // retail=0 落表为 ratio=null + infinite=true → ∞ 用布尔透传（JSON.stringify(Infinity)=null
        // 静默丢值，直接传 Infinity 前端只见 null 显 '-'——母版实证缺陷，此处修复）
        TPAPre_zhuangRetailRatio: hf.TPAPre_zhuangRetailRatio ?? null,
        TPAPre_zhuangRetailRatioInfinite: hf.TPAPre_zhuangRetailRatioInfinite === true,
        TPAPre_zhuangHolderCount: hf.TPAPre_zhuangHolderCount ?? null,
        // ★庄散加权分（verdict 自定义 zhuangCondition 可能引用；与 _decideVerdict factors 对称。
        //   前端 approve 行据此展示）
        TPAPre_zhuangScore: hf.TPAPre_zhuangScore ?? null,
        TPAPre_retailScore: hf.TPAPre_retailScore ?? null,
        TPAPre_newWalletScore: hf.TPAPre_newWalletScore ?? null,
        TPAPre_neutralScore: hf.TPAPre_neutralScore ?? null,
        TPAPre_minZR: hf.TPAPre_minZR ?? null,
        TPAPre_gapZR: hf.TPAPre_gapZR ?? null,
        source: 'persisted',
      } : null;
    }
  }

  /**
   * 历史数据兼容：旧实验 holding_factors JSONB 键名无 TPAPre_ 前缀（改名前跑的），
   * 此处仅在内存把旧键映射到新键（不改 DB），使 _attachZhuangRetail / 表达式过滤对新旧实验统一工作。
   * 改名后新数据无旧名键 → 无副作用；改名前旧数据补齐新键。
   */
  _normalizeHoldingFactors(analyses) {
    for (const a of analyses) {
      const hf = a.holding_factors;
      if (!hf || typeof hf !== 'object') continue;
      for (const newKey of HOLDING_FACTOR_KEYS) {
        if (hf[newKey] === undefined) {
          const oldKey = newKey.slice('TPAPre_'.length);
          if (hf[oldKey] !== undefined) hf[newKey] = hf[oldKey];
        }
      }
    }
  }

  /**
   * 表达式过滤求值：对单行构造 factors 对象喂 ConditionEvaluator（与策略 condition 同一套语义）。
   * factors = 归一化后的 holding_factors(TPAPre_ 键) + TPAAnalyzed(0/1) + trigger_snapshot 数值字段
   * （BSC 口径：buyBnb / currentPriceBnb）。
   * 未知因子（检测前缺失的 TPAPre_*）→ ConditionEvaluator 返回 false（IS NULL 仍可用）。
   */
  _evalExpression(ast, evaluator, analysis) {
    const hf = analysis.holding_factors || {};
    const ts = analysis.trigger_snapshot || {};
    const factors = {
      ...hf,
      TPAAnalyzed: (hf && Object.keys(hf).length > 0) ? 1 : 0,
      ageSeconds: ts.ageSeconds ?? null,
      tradeCount: ts.tradeCount ?? null,
      buyBnb: ts.buyBnb ?? null,
      currentPriceBnb: ts.currentPriceBnb ?? null,
      blockDiff: ts.blockDiff ?? null,
    };
    try {
      return evaluator.evaluate(ast, factors);
    } catch {
      return false;
    }
  }

  /**
   * 汇总：总数 / approve vs block（count 探针）+ 代币分类明细 + 核心指标（全量行合并）。
   */
  async _buildSummary(experimentId) {
    const [base, cat] = await Promise.all([
      this._getSummary(experimentId),
      this._getCategoryBreakdown(experimentId),
    ]);
    return { ...base, ...cat };
  }

  /**
   * 总数 / approve vs block（head:true count 探针分桶，不取行）。
   */
  async _getSummary(experimentId) {
    const supabase = dbManager.getClient();
    const base = () => supabase.from('token_position_analyses').select('*', { count: 'exact', head: true }).eq('experiment_id', experimentId);

    const safeCount = async (q) => {
      const { count, error } = await q;
      if (error) return 0;
      return count != null ? Number(count) : 0;
    };

    const [total, approve, block] = await Promise.all([
      safeCount(base()),
      safeCount(base().eq('verdict', 'approve')),
      safeCount(base().eq('verdict', 'block')),
    ]);

    return { total, approve, block };
  }

  /**
   * 全量取某实验的 token_position_analyses 行。规避两个坑：
   *  ① Supabase 单次 1000 行上限：未分页会被静默截断，聚合/筛选漏行。
   *  ② statement_timeout：按非索引列（id / created_at）order + range 分页会对过滤后行集做显式
   *    Sort，单实验数千行易撞 DB 的 statement_timeout。
   * 改用 token_address 键集分页（gt(last_token) + order(token_address) + limit）：
   *  (experiment_id, token_address) 有 idx_tpa_experiment_token 索引，走索引扫描无 Sort，不超时。
   *  trigger_no 架构上恒 1（一 token 一行）→ 同实验 token_address 唯一，键集无重无漏。
   * select 列由 caller 指定；可选 builder 叠加 verdict/search 等 DB 层过滤。
   * 返回行序为 token_address 升序（非 created_at）——需要展示序的 caller 自行 JS 排序。
   */
  async _fetchAllRows(experimentId, selectCols, opts = {}) {
    const { builder = null } = opts;
    const supabase = dbManager.getClient();
    const PAGE = 1000;
    let lastToken = null;
    const rows = [];
    while (true) {
      let q = supabase
        .from('token_position_analyses')
        .select(selectCols)
        .eq('experiment_id', experimentId)
        .order('token_address')
        .limit(PAGE);
      if (lastToken) q = q.gt('token_address', lastToken);
      if (builder) q = builder(q);
      const { data, error } = await q;
      if (error) throw new Error(`查询持仓分析失败: ${error.message}`);
      const page = data || [];
      rows.push(...page);
      if (page.length < PAGE) break;
      lastToken = page[page.length - 1].token_address;
    }
    return rows;
  }

  /**
   * 代币分类明细：全量取 token_address+verdict 轻量行 → 合并 token_profiles 分类 →
   * 按 category 计 {total, approve, block}（无分类行归 '__unclassified__'）+ 两个核心指标：
   *   - highMcapPassRate：高市值(high_mcap) 通过率 = approve/total（无高市值代币 → null）
   *   - washShareOfApproved：通过代币中的流水盘(wash) 占比 = approve(wash)/approve(全部)（无通过 → null）
   * v1 trigger_no 恒 1（一 token 一行），无需去重，Σ(分类.total) === summary.total。
   */
  async _getCategoryBreakdown(experimentId) {
    try {
      const rows = await this._fetchAllRows(experimentId, 'token_address,verdict');

      const addresses = [...new Set(rows.map(r => r.token_address).filter(Boolean))];
      const profileMap = await this.getTokenProfileByAddresses(addresses);

      const categories = {};
      let approveAll = 0;
      for (const r of rows) {
        const cat = (profileMap[r.token_address] && profileMap[r.token_address].category) || '__unclassified__';
        if (!categories[cat]) categories[cat] = { total: 0, approve: 0, block: 0 };
        categories[cat].total++;
        if (r.verdict === 'approve') { categories[cat].approve++; approveAll++; }
        else if (r.verdict === 'block') categories[cat].block++;
      }

      const hm = categories['high_mcap'] || { total: 0, approve: 0 };
      const wash = categories['wash'] || { total: 0, approve: 0 };
      const coreMetrics = {
        highMcapPassRate: hm.total > 0 ? Number(((hm.approve / hm.total) * 100).toFixed(1)) : null,
        washShareOfApproved: approveAll > 0 ? Number(((wash.approve / approveAll) * 100).toFixed(1)) : null,
        highMcapTotal: hm.total,
        washApproved: wash.approve,
        approveAll,
      };

      return { categories, coreMetrics };
    } catch (error) {
      console.error('分类明细聚合失败:', error);
      return { categories: {}, coreMetrics: {} };
    }
  }

  /**
   * 按需分析单个钱包的全局 as-of 画像（母版 trader 详情页「🔍 立即分析」同款；richer-js 首期
   * 挂在持仓分析页外暂无入口，保留方法供后续 wallets 页接线）。
   * 无需 token 触发上下文：直接复用 TPA._fetchAndBuildProfile 查该钱包 wss_price_ticks 全历史
   *   → 离线 profile 命中则用/增量合并，否则实时取行算 rawTotal/tokenCount/金额桶/badAction。
   * 画像收口后 profile 不含 tags/category/clusterIds（不再读 wallets.*）；下方从 wallets 表补 DB 人工标注。
   * 注：_fetchAndBuildProfile 不检查 _enabled，不触发 _analyze 评分/落表逻辑（此处只取 profile）。
   */
  async analyzeWallet(address, opts = {}) {
    try {
      if (!address) throw new Error('address 必填');
      const { TokenPositionAnalyzer, TRIGGER_NOT_USED } = require('../../services/TokenPositionAnalyzer');
      const { scoreProfile, classifyHolderDetail } = require('../../services/wallet-scorer');
      // collectBreakdown=true：_fetchAndBuildProfile 返回 { profile(merged), breakdown:{offline,inc} }。
      // 三段（离线预计算 / 实时增量 / 汇总）各自 _packProfile 成展示格式（profile 已无 perToken）。
      // trigger=TRIGGER_NOT_USED：本服务只用 _fetchAndBuildProfile 画像方法，不消费触发条件
      // （实验层 trigger 必填校验的显式豁免）
      const analyzer = new TokenPositionAnalyzer({ walletScore: { enabled: true }, trigger: TRIGGER_NOT_USED }, { experimentId: null, factorAggregator: null });
      const now = Date.now();
      const { profile: merged, breakdown } = await analyzer._fetchAndBuildProfile(address, now, { collectBreakdown: true });

      const dataThroughMs = merged.dataThroughMs ?? null;
      const offlineProfile = breakdown && breakdown.offline
        ? analyzer._packProfile(breakdown.offline, { source: 'offline', dataThroughMs })
        : null;
      // 增量栏 source 标 'realtime'（未命中=全量实时 lookback→now；命中=增量 data_through→now，都是实时算的那段）
      const incrementalProfile = breakdown && breakdown.inc
        ? analyzer._packProfile(breakdown.inc, { source: 'realtime' })
        : null;
      const mergedProfile = merged;

      // 单钱包评分（无 floatPct 概念）：直接 scoreProfile(merged) 得 0-5 分 + 各维度 breakdown。
      // 用 wallet-scorer DEFAULT_PARAMS（与 TPAPre_tokenScore 聚合同口径）。
      let score = null;
      try { score = scoreProfile(merged); }
      catch (e) { console.warn('钱包评分失败(忽略):', e.message); }

      // 补 DB 离线标签（web 无 FA labelMaps）：wallets.category（人工分类）/ wallets.tags
      const supabase = dbManager.getClient();
      const { data: w } = await supabase.from('wallets').select('category,tags').eq('address', address).limit(1);
      if (w && w[0]) {
        if (mergedProfile.tags == null) mergedProfile.tags = w[0].tags || null;
        if (mergedProfile.category == null) mergedProfile.category = w[0].category || null;
      }

      // 庄散性质（Layer1）：classifyHolderDetail 现算 bucket + 命中维度 + 子类（实时，不落库）
      let nature = null;
      try { nature = classifyHolderDetail(mergedProfile); }
      catch (e) { console.warn('庄散性质判定失败(忽略):', e.message); }

      return {
        success: true,
        data: { address, analyzedAt: new Date().toISOString(), offline: offlineProfile, incremental: incrementalProfile, profile: mergedProfile, score, nature },
      };
    } catch (error) {
      console.error('按需分析钱包失败:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = { PositionAnalysisService };
