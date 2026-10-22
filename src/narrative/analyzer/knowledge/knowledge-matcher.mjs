/**
 * 叙事知识库匹配器（纯函数：零 IO、零 Date.now、零网络）
 *
 * 规则分级（优先级序）：
 *   1 address_exact   本票地址 == 条目地址（本票即在册代币，最强信号）
 *   2 twitter_exact   本票挂的 twitter handle == 条目 handle
 *   3 name_exact      归一化 symbol/name == 条目 name/alias
 *   4 name_substring  名字最长公共子串达标（哭哭奶龙×哭哭马共享「哭哭」命中；
 *                     彪弟×彪哥共享 1 字不命中=设计如此，靠规则 5 语料提及）
 *   5 corpus_contains 语料文本提及完整条目名/alias（彪弟票宣告推提及「彪哥」）
 *   6 concept_keyword concept 条目按 keywords 任一词在语料出现（「股票」「flap」）
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
const RULE_ORDER = ['address_exact', 'twitter_exact', 'name_exact', 'name_substring', 'corpus_contains', 'concept_keyword'];
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
  const handleNorm = normalizeForKnowledgeMatch(matchInput.twitterHandle);
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

    // 2 twitter_exact（条目 twitter 为 URL 或裸 handle 皆可——归一化后只余 handle 字符）
    if (handleNorm && entry.twitter) {
      const entryHandle = normalizeForKnowledgeMatch(
        String(entry.twitter).replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, ''),
      );
      if (entryHandle && entryHandle === handleNorm) {
        offer(entry, 'twitter_exact', handleNorm, 'twitterHandle', 900);
        continue;
      }
    }

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
