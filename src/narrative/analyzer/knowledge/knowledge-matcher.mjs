/**
 * 叙事知识库匹配器（纯函数：零 IO、零 Date.now、零网络）
 *
 * 规则分级（优先级序）：
 *   1 address_exact   本票地址 == 条目地址（本票即在册代币，最强信号）
 *   2 name_exact      归一化 symbol/name == 条目 name/alias
 *   3 name_substring  名字最长公共子串达标（哭哭奶龙×哭哭马共享「哭哭」命中；
 *                     彪弟×彪哥共享 1 字不命中=设计如此，靠规则 4 语料提及）
 *   4 corpus_contains 语料文本提及完整条目名/alias（彪弟票宣告推提及「彪哥」）
 *   5 concept_keyword concept 条目按 keywords 任一词在语料出现（「股票」「flap」）
 *
 * ★ twitter_exact 已退役（2026-10-22 用户裁定「同 Dev 关联不恰当——同一个 Dev
 *   发的绝大多数代币叙事根本无关」）：票的宣告账号 == 条目 twitter 只说明同
 *   部署者，不说明同叙事（与 C168 撤去重 twitter 臂同判据：twitter=语料出处/
 *   部署者账号，非叙事关联）。matchInput.twitterHandle 保留参数形状但不再消费。
 *
 * 防噪三防线：a) 代码级 denylist（latin 通用 meme 词，仅压 substring/corpus 两级，
 * name_exact 同名是强信号不压）；b) 条目级 corpusTrigger:false（builder 对短名/
 * 噪声词条目自动置 false，数据侧防线）；c) maxEntries 封顶按优先级截断留痕。
 */

/** 通用 meme 噪声词（归一化 latin 形）：条目名归一化后含任一词 → substring/corpus 级不触发 */
const NOISE_SUBSTRING_DENYLIST = [
  'pepe', 'doge', 'shib', 'meme', 'coin', 'token', 'baby', 'elon', 'moon', 'king',
  'cat', 'dog', 'inu', 'pump', 'binance', 'cz',
];

const CJK_RE = /[一-鿿㐀-䶿]/;
const CJK_GLOBAL_RE = /[一-鿿㐀-䶿]/g;

/** 规则优先级序（越小越高；kind 权重用于同级排序） */
const RULE_ORDER = ['address_exact', 'name_exact', 'name_substring', 'corpus_contains', 'concept_keyword'];
const KIND_ORDER = { bluechip: 0, quasi: 1, concept: 2 };

/**
 * 归一化匹配形：小写+剥空白/下划线/连字符/@+剥 emoji 与杂符号。
 * 镜像 account-community-rules normalizeForMatch 并扩展剥离 emoji（\u{1F300}-\u{1FAFF}
 * 等代理对区间用 u flag），保留 CJK 与字母数字。
 */
export function normalizeForKnowledgeMatch(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[\s_\-@#.!,?，。！？、：:;；'"]/gu, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}]/gu, '')
    .trim();
}

/** 最长公共子串（经典 DP；名字都很短 <40，无需滚动优化）。按 code unit 迭代——CJK 单 unit，emoji 已在归一化剥除 */
function longestCommonSubstring(a, b) {
  if (!a || !b) return '';
  let best = '';
  let bestLen = 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > bestLen) {
          bestLen = cur[j];
          best = a.slice(i - cur[j], i);
        }
      }
    }
    prev = cur;
  }
  return best;
}

/** 子串达标判定：CJK 字数 ≥ minCjk，或含连续 latin/数字 ≥ minLatin 的 run */
function substringSatisfies(sub, minCjk, minLatin) {
  if (!sub) return false;
  const cjkCount = (sub.match(CJK_GLOBAL_RE) || []).length;
  if (cjkCount >= minCjk) return true;
  const runs = sub.match(/[a-z0-9]+/g) || [];
  return runs.some((r) => r.length >= minLatin);
}

/** 归一化串含任一 denylist 词（子串包含）→ substring/corpus 级拒绝 */
function hitsDenylist(norm) {
  if (!norm) return false;
  return NOISE_SUBSTRING_DENYLIST.some((w) => norm.includes(w));
}

/** 条目最小校验（loader 与 builder 共用）：name+kind 必填；带地址须 0x 开头 40 hex */
export function isValidKnowledgeEntry(e) {
  if (!e || typeof e !== 'object') return false;
  if (!e.name || typeof e.name !== 'string') return false;
  if (!['bluechip', 'quasi', 'concept'].includes(e.kind)) return false;
  if (e.address !== undefined && e.address !== null) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(e.address))) return false;
  }
  return true;
}

/**
 * builder 自动判定 corpusTrigger（数据侧防线，与代码侧 denylist/长度门同判据单一真相）：
 * 任一名字归一化后命中 denylist → false（整体压制，防止 alias 绕过）；
 * 全部名字长度不达标（<2 CJK 且 <4 latin）→ false（语料级触发不可靠）。
 * @param {string[]} names - name+aliases 原文数组
 * @returns {boolean} 建议的 corpusTrigger 值
 */
export function autoCorpusTriggerForEntry(names) {
  const list = (Array.isArray(names) ? names : [names]).filter((n) => n && String(n).trim());
  if (!list.length) return false;
  const norms = list.map((n) => normalizeForKnowledgeMatch(n));
  if (norms.some((n) => n && hitsDenylist(n))) return false;
  return norms.some((n) => substringSatisfies(n, 2, 4));
}

/**
 * 条目数组 → 内存索引（加载时现建，不落盘——杜绝派生索引与条目文件漂移）
 * @param {Array} entries - 已过 isValidKnowledgeEntry 的条目
 * @returns {{ byAddress:Map, byExactName:Map, entries:Array }}
 *   每条目挂 _normNames（归一化 name+aliases）供 substring/corpus 级复用
 */
export function buildKnowledgeIndex(entries) {
  const list = Array.isArray(entries) ? entries.filter(isValidKnowledgeEntry) : [];
  const byAddress = new Map();
  const byExactName = new Map();
  for (const e of list) {
    e._normNames = [e.name, ...(Array.isArray(e.aliases) ? e.aliases : [])]
      .map(normalizeForKnowledgeMatch)
      .filter(Boolean);
    if (e.address) byAddress.set(String(e.address).toLowerCase(), e);
    for (const n of e._normNames) {
      if (!byExactName.has(n)) byExactName.set(n, e); // 同名首条优先（manual 已在 loader 层覆盖在后）
    }
  }
  return { byAddress, byExactName, entries: list };
}

/**
 * feedback 自反馈排除（C165 回归现场反证）：analysis 回写的 feedback 条目命中
 * 本票自身地址时剔除——「本系统评 high」注入自己的重析=自锚定锁死（reanalyze 的
 * 目的就是重新判断，上轮主观评级不得当本轮证据）。蓝筹（b:）自命中=客观 ATH 事实、
 * graduations 自命中=客观毕业事实，均保留注入。
 */
export function excludeSelfFeedback(matches, tokenAddress) {
  const addr = tokenAddress ? String(tokenAddress).toLowerCase() : '';
  if (!addr || !Array.isArray(matches)) return matches || [];
  return matches.filter((m) => !(m.entry && m.entry.source === 'feedback' && m.entry.address === addr));
}

/**
 * 蓝筹去重检测（C168，用户裁定「蓝筹需要去重，小蓝筹不需要——短期热门叙事
 * 往往会发好些个票」）：票以 name_exact 撞**蓝筹**（b:，已验证大叙事 ATH>$1M
 * curated 库）→ 后来的票是纯复制品，返回证据供 mapper 拦 low。
 *
 * 刻意范围（四项裁定形状）：
 *   - 仅 kind==='bluechip'：quasi（feedback/graduations 小票）**不参与**——同叙事
 *     连发多票是 meme 常态（BIAOQING 三连发 2026-10-22 裁定不拦）；蓝筹叙事已
 *     定型出过冠军，撞名=复制品（rule 0.52「同名蓝筹废除移交叙事层」的接棒，
 *     判据从宽口径同名升级为 curated 库+exact）
 *   - **仅 name_exact；twitter_exact 臂上线即撤（2026-10-22 回归反证）**：
 *     蓝筹条目的 twitter 字段记录的是该票引用的语料源（借壳大 V：binance/
 *     cz_binance/heyibinance 等占库里 twitter 的多数），twitter 是叙事**出处**
 *     不是票的**身份**——后来的票引用同一大 V ≠ 复制品（同源多票恰是「短期
 *     热门叙事连发」的另一种形态）；首轮回归 9 票误拦实证（交易猫/币安菠萝/
 *     BI 簇/何一 Agent ID/BINA 复刻全被 @binance 系撞拦，顶翻 C110/C109a/C83/
 *     C138/C162 五个用户裁定票）
 *   - name_substring 是有意义变体（哭哭奶龙×哭哭马 C151）、corpus_contains
 *     是背景注入语义（C165），都不是重复叙事
 *   - 自地址排除：蓝筹本体票重析（selfAddress=条目 address）不得被自己拦
 *
 * 实现复用 matchKnowledge（窄输入 corpusText=''/address=null/twitterHandle=null
 * 使 address/name_substring/corpus/concept 四级天然不触发），零新匹配逻辑；
 * maxEntries 放大防 exact 命中被注入用的 5 条封顶挤掉。
 * @param {{symbol:string, name:string, address:string, twitterHandle:string|null,
 *          corpusText:string}} matchInput - 与注入匹配同源输入（twitterHandle/
 *          corpusText/address 被忽略）
 * @param {Object} index - buildKnowledgeIndex 产物
 * @param {{selfAddress?:string}} [opts]
 * @returns {null|{rule:string, matchedOn:string, matchedField:string,
 *                 entryId:string, entryName:string, entryAddress:string|null}}
 */
export function detectDuplicateNarrative(matchInput, index, opts = {}) {
  if (!index || !matchInput) return null;
  const narrow = matchKnowledge({
    symbol: matchInput.symbol,
    name: matchInput.name,
    address: null, // address_exact=本票即在册，非重复叙事（重析形状），源头不评估
    twitterHandle: null, // twitter=语料出处非票身份（借壳大 V 同源多票是常态），不参与
    corpusText: '', // corpus_contains/concept_keyword=背景提及语义，不参与
  }, index, { maxEntries: 50 });
  const selfAddr = opts.selfAddress ? String(opts.selfAddress).toLowerCase() : '';
  const hit = narrow.matches.find((m) =>
    m.kind === 'bluechip'
    && m.rule === 'name_exact' // twitter_exact 不参与（见函数头归因）
    // 条目级豁免（C137 裁定「名字一样本质叙事不一样不拦」）：口号级泛名/同
    // 部署者连发名等非「独占 meme 名」条目人工标 dedupExempt=true（manual
    // 同 id 覆盖），默认拦+逐条豁免
    && !m.entry?.dedupExempt
    && !(selfAddr && m.entry && String(m.entry.address || '').toLowerCase() === selfAddr));
  if (!hit) return null;
  return {
    rule: hit.rule,
    matchedOn: hit.matchedOn,
    matchedField: hit.matchedField,
    entryId: hit.entryId,
    entryName: hit.entry?.name ?? null,
    entryAddress: hit.entry?.address ?? null,
  };
}

/**
 * 匹配（分级规则，输出可审计）
 * @param {{symbol:string, name:string, address:string, twitterHandle:string|null,
 *          corpusText:string}} matchInput
 * @param {Object} index - buildKnowledgeIndex 产物
 * @param {Object} matchConfig - { maxEntries, minCjk, minLatin }
 * @returns {{ matches:Array, truncated:boolean, scannedEntries:number }}
 *   Match = { entryId, kind, rule, matchedOn, matchedField, entry }
 */
export function matchKnowledge(matchInput, index, matchConfig) {
  const cfg = matchConfig || {};
  const maxEntries = cfg.maxEntries ?? 5;
  const minCjk = cfg.minCjk ?? 2;
  const minLatin = cfg.minLatin ?? 4;
  if (!index || !matchInput) return { matches: [], truncated: false, scannedEntries: 0 };

  const addrNorm = matchInput.address ? String(matchInput.address).toLowerCase() : '';
  const symbolNorm = normalizeForKnowledgeMatch(matchInput.symbol);
  const nameNorm = normalizeForKnowledgeMatch(matchInput.name);
  // twitterHandle 刻意不归一化不消费（twitter_exact 退役，见文件头归因）
  const corpusNorm = normalizeForKnowledgeMatch(matchInput.corpusText);

  /** entryId → Match（保留最高优先级规则） */
  const byEntry = new Map();
  const offer = (entry, rule, matchedOn, matchedField, score) => {
    const prev = byEntry.get(entry.id);
    if (prev) {
      if (RULE_ORDER.indexOf(rule) < RULE_ORDER.indexOf(prev.rule)) {
        byEntry.set(entry.id, { entryId: entry.id, kind: entry.kind, rule, matchedOn, matchedField, entry, _score: score });
      }
      return;
    }
    byEntry.set(entry.id, { entryId: entry.id, kind: entry.kind, rule, matchedOn, matchedField, entry, _score: score });
  };

  for (const entry of index.entries) {
    const normNames = entry._normNames || [];

    // 1 address_exact
    if (addrNorm && entry.address && addrNorm === String(entry.address).toLowerCase()) {
      offer(entry, 'address_exact', addrNorm, 'address', 1000);
      continue; // 最高级已中，不再降级评估
    }

    // 2 twitter_exact 已退役（2026-10-22 用户裁定「同 Dev 关联不恰当——同一个 Dev
    //   发的绝大多数代币叙事根本无关」；与 C168 撤去重 twitter 臂同判据：
    //   部署者同号 ≠ 叙事相关），原位留档防复活——同 Dev 前作不再作为注入背景。

    // 3 name_exact（强信号：denylist 不压）
    if ((symbolNorm || nameNorm) && normNames.some((n) => n && (n === symbolNorm || n === nameNorm))) {
      offer(entry, 'name_exact', symbolNorm || nameNorm, symbolNorm ? 'symbol' : 'name', 800);
      continue;
    }

    // 4 name_substring：最长公共子串（双向包含之外的共享片段，哭哭奶龙×哭哭马）。
    // concept 条目不参与——类目名（「股票概念币」）是通用标签非专名，共享「概念」
    // 这类通用词的子串命中全是噪声（单测 G2 现场反证）；concept 只按 keywords 触发
    if ((symbolNorm || nameNorm) && entry.kind !== 'concept' && entry.corpusTrigger !== false && normNames.length) {
      const tokenNorm = symbolNorm || nameNorm;
      const extraNorm = symbolNorm && nameNorm && symbolNorm !== nameNorm ? nameNorm : null;
      for (const n of normNames) {
        if (hitsDenylist(n)) continue;
        const sub = longestCommonSubstring(tokenNorm, n);
        if (sub && sub.length < Math.max(tokenNorm.length, n.length) && substringSatisfies(sub, minCjk, minLatin)) {
          // 子串须是「共享片段」而非全等（全等已被 name_exact 收走）
          offer(entry, 'name_substring', sub, symbolNorm ? 'symbol' : 'name', 400 + sub.length);
          break;
        }
        if (extraNorm) {
          const sub2 = longestCommonSubstring(extraNorm, n);
          if (sub2 && sub2.length < Math.max(extraNorm.length, n.length) && substringSatisfies(sub2, minCjk, minLatin)) {
            offer(entry, 'name_substring', sub2, 'name', 400 + sub2.length);
            break;
          }
        }
      }
    }

    // 5 corpus_contains：语料提及完整条目名/alias
    if (corpusNorm && entry.corpusTrigger !== false) {
      for (const n of normNames) {
        if (n.length < 2) continue; // 单字符名不做语料触发（噪声不可控）
        if (hitsDenylist(n)) continue;
        if (!substringSatisfies(n, minCjk, minLatin)) continue; // 名字本身不达标（1 CJK/3 latin）不触发
        if (corpusNorm.includes(n)) {
          offer(entry, 'corpus_contains', n, 'corpus', 300 + n.length);
          break;
        }
      }
    }

    // 6 concept_keyword：concept 条目按 keywords 触发（BSC 基础概念按语料关键词命中）
    if (entry.kind === 'concept' && corpusNorm && Array.isArray(entry.keywords)) {
      for (const kw of entry.keywords) {
        const kwNorm = normalizeForKnowledgeMatch(kw);
        if (kwNorm && kwNorm.length >= 2 && corpusNorm.includes(kwNorm)) {
          offer(entry, 'concept_keyword', kwNorm, 'corpus', 200 + kwNorm.length);
          break;
        }
      }
    }
  }

  // 排序：规则优先级 → kind 权重 → 相关性得分（LCS/名字长度）→ entryId 稳定序
  const all = [...byEntry.values()].sort((a, b) =>
    (RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule))
    || ((KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9))
    || ((b._score ?? 0) - (a._score ?? 0))
    || String(a.entryId).localeCompare(String(b.entryId)),
  );
  const truncated = all.length > maxEntries;
  const matches = all.slice(0, maxEntries).map(({ _score, ...m }) => m); // 剥内部排序键
  return { matches, truncated, scannedEntries: index.entries.length };
}
