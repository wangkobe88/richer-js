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
 */

export const JEV_CORPUSGATE_QUESTIONS_VERSION = 'CG1.0';

/**
 * 构建语料充分门问题集
 * @returns {Object} questions {id: {type, instructions, criteria}}
 */
export function buildCorpusGateQuestions() {
  return {
    corpus_gate_sufficiency: {
      type: 'choice',
      instructions: `Narrative corpus sufficiency for skipping the remaining external-source fetches. The corpus below is the TWITTER-primary corpus (tweet text, account profile / timeline). At the very end, an [UNFETCHED SOURCES] annex lists the platforms whose links appear in the token's sources but whose content has NOT been fetched yet, each with its URL. Answer ONE question only: based on the available textual corpus alone, is the evidence for the narrative judgment already sufficient? That is, could the unfetched platforms' content (video titles / captions / creator profiles / follower or play counts / posts / repo info / in-content text) possibly carry key evidence that would CHANGE the judgment?
Pick need_fetch if ANY of these holds:
- The narrative subject plausibly lives on an unfetched platform: the token appears to ride a platform-native creator, a trending topic there, or a meme whose point of origin is commonly there (Chinese-language memes often originate on douyin or weibo; tech / project tokens often hinge on github repo evidence such as stars or maintainer identity).
- The name evidence may live in the unfetched content: the token Symbol/Name has no literal or semantic link to the textual corpus, and the only possible carrier of the reference is a video title, a creator's username, in-video/in-image text, or a repo/doc on an unfetched platform.
- Weak textual reference: the tweet text does not clearly state what this coin refers to or which event it rides, and the unfetched content is needed to complete the reference.
Pick sufficient only if ALL of these hold:
- The textual corpus already names the narrative subject and event clearly (who, what happened, and the link to the coin name is judgeable).
- The coin name's reference has literal or semantic evidence in the text and does not depend on the unfetched content.
- Every unfetched link is most likely just a secondary carrier of the same event / an atmospheric supplement that carries no judgment-changing evidence.
⚠️ The judgment target is "could the unfetched content CHANGE the verdict", NOT "is it useful" — when the textual reference is already clear, pure atmospheric or duplicate links still count as sufficient.`,
      criteria: {
        sufficient: 'Textual corpus is already sufficient: subject / event / reference are clear, no unfetched platform carries key evidence that would change the judgment — skipping all remaining fetches loses nothing',
        need_fetch: 'Textual corpus is insufficient: the narrative subject is plausibly native to an unfetched platform / the coin name reference may only exist in unfetched content / the reference is otherwise unclear — the remaining fetches are needed',
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
