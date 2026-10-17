/**
 * Jev 语料充分门问题集（C79，2026-10-16 用户裁定）
 *
 * 对象：非主语料外部资源抓取（justoneapi 串行桶 weibo/youtube/douyin/tiktok/
 * bilibili/binanceSquare/weixin/amazon/xiaohongshu/instagram + github 桶；抖音
 * 实测 2.8-4.4s 是买腿直调最大单点）的前置充分性预判——twitter 主语料等齐后
 * 判一次「其余待抓平台语料还需要吗」，sufficient 则全部待抓段整段跳过（各
 * results.<x>Info 保持 null = 无该平台 URL / 抓取失败同形状，下游零改动）。
 * 1 题 Choice，state = 与主 Jev 同语料的 partial 形态（buildJevState：twitter
 * 已抓，待抓平台缺席）+ 末尾 [UNFETCHED SOURCES] 附加段列待抓平台与 URL。
 *
 * 用户原话（2026-10-16）：「不仅仅是抖音的调用，很多外部资源的调用都是类似
 * 思路，就是如果对叙事的理解已经不需要其它信息补充，那就不用去取了」——
 * twitter（判据来源/主语料）不可跳；websites 有 websiteFetch.enabled 独立开关
 * （显式 opt-in）刻意不纳门管。
 *
 * 误判方向 fail-safe：误判 sufficient → 待抓段缺席 → 证据少载体的最坏结果是
 * 评级偏 low → 偏拦（损失是错过票，不是买入风险）；误判 need_fetch / Jev 调用
 * 失败 / 超时 → 照抓 = 原行为（多付一次门调用 ≤2s）。
 *
 * 版本：改动题面 instructions/criteria 或 judgeCorpusGate 聚合语义后必须 bump
 * CG1.0：首版（2026-10-16，偷窥狂案 0x57ef…7777 起案；当日由 douyin 专属门
 *   D1.0 泛化而来——题面从单平台语境改为 [UNFETCHED SOURCES] 待抓清单语境，
 *   判据保留平台敏感性提示：中文梗源头常在抖音/微博、tech 盘常吃 github 仓
 *   库证据。题面锚定「未抓内容会不会改变判定」而非「有没有用」——文字指代
 *   已清晰时纯氛围/重复链接也算 sufficient）
 * CG2.0（2026-10-17 用户裁定，롱캣 0xd97a…7777 案）：判据从「未抓内容会不会
 *   改变判定」改为「推文能否直接理解叙事」。基本原则=采信推文陈述：宣告推
 *   对热度/来源/叙事对象的陈述默认为真，验证其真实性不是本门的任务（验证代
 *   价 douyin 2.8-4.4s 买腿不可接受）。CG1.0 的「meme 源头可能在未抓平台」
 *   独立 need_fetch 臂正是本案翻车点（롱캣推文已说清韩国跑者 meme+抖音官方
 *   账号，Jev 仍按源头平台臂判 need_fetch）——删除；need_fetch 收紧为仅剩
 *   「文本无法辨认叙事主体 / 名字唯一载体在未抓内容」两臂。误判方向不变：
 *   误 sufficient=证据少=评级偏 low=偏拦（fail-closed）
 */

export const JEV_CORPUSGATE_QUESTIONS_VERSION = 'CG2.0';

/**
 * 构建语料充分门问题集
 * @returns {Object} questions {id: {type, instructions, criteria}}
 */
export function buildCorpusGateQuestions() {
  return {
    corpus_gate_sufficiency: {
      type: 'choice',
      instructions: `Narrative corpus sufficiency for skipping the remaining external-source fetches. The corpus below is the TWITTER-primary corpus (tweet text, account profile / timeline). At the very end, an [UNFETCHED SOURCES] annex lists the platforms whose links appear in the token's sources but whose content has NOT been fetched yet, each with its URL.
TRUST PRINCIPLE (governs everything below): statements in the tweet corpus itself are taken at face value. What the announcement tweet says about the narrative — what the meme/subject is, where it comes from, how popular it is, who created it — is ASSUMED TRUE. Verifying those claims is NOT this judgment's job. The only question: can the narrative be understood clearly from the textual corpus ALONE?
Pick need_fetch ONLY if the narrative itself is NOT understandable from the text, i.e. ANY of:
- Unidentifiable subject: the corpus does not state and does not allow inferring what this coin refers to — the narrative subject cannot be made out from the text.
- Name evidence only in unfetched content: the token Symbol/Name has no literal or semantic link to the textual corpus, and the only possible carrier of the reference is unfetched content (a video title, a creator's username, in-video/in-image text, a repo/doc on an unfetched platform).
Popularity / authenticity / whether the claimed origin is real are NEVER reasons to pick need_fetch — the tweet's word is accepted. An unfetched link that merely re-hosts, illustrates, or supplements an already-understandable narrative (e.g. the announcement tweet itself references a douyin/youtube video of the meme it already describes in words) is NOT a reason to fetch.
Pick sufficient if the text makes the narrative subject, event, and its link to the coin name understandable — even if the claims are unverified.
⚠️ The bar for need_fetch is high: only genuine textual incomprehension qualifies, not absence of verification.`,
      criteria: {
        sufficient: 'The narrative is understandable from the text alone (subject / event / link to the coin name are clear, tweet claims accepted at face value) — skipping all remaining fetches loses nothing for understanding',
        need_fetch: 'The narrative is NOT understandable from the text: the subject cannot be identified, or the coin name reference can only be resolved via unfetched content — the remaining fetches are needed',
      },
    },
  };
}

/**
 * 薄判定：读预判答案（JevClient._validate 已保证 answer 存在，缺答案在 ask 层 throw）
 * probabilities.sufficient 缺失 → 0 = 不跳过（fail-safe 照抓，与 G1.0 同款保守
 * 口径——门的 miss 方向是宁抓勿跳）
 * @param {Object} answers JevClient answers 映射
 * @param {Object} [opts] { minSufficientProb }（config corpusGate.minSufficientProb）
 * @returns {{skipped: boolean, choice: string|null, prob: number|null}}
 */
export function judgeCorpusGate(answers, opts = {}) {
  const minSufficientProb = opts.minSufficientProb ?? 0.6;
  const a = answers?.corpus_gate_sufficiency;
  const choice = a?.choice === 'sufficient' ? 'sufficient' : 'need_fetch';
  const prob = a == null ? null : Number(a.probabilities?.sufficient ?? 0);
  return { skipped: choice === 'sufficient' && (prob ?? 0) >= minSufficientProb, choice, prob };
}
