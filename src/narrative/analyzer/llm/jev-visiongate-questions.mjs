/**
 * Jev vision 预判门问题集（C72，2026-10-15 用户裁定）
 *
 * 对象：主推文首图 vision 分析（analyzeTweetImage，Qwen3-Omni 单图实测 11.2s）
 * 的前置充分性预判——文字语料已足够确认叙事时整段跳过 vision（无图语义）。
 * 1 题 Choice，state = 与主 Jev 同语料的无图形态（buildJevState）。
 *
 * 误判方向 fail-safe：误判 sufficient → 无图语义 → J1.30/C59 图证据豁免不
 * 触发 → 偏拦（损失是错过票，不是买入风险）；误判 need_image / Jev 调用
 * 失败 → 跑 vision = 原行为（多付 ~0.5s）。
 *
 * 版本：改动题面 instructions/criteria 或 judgeVisionGate 聚合语义后必须 bump
 * G1.0：首版（2026-10-15，小黑案 0x9641293a…7777：vision 6.6s 占直调 8.05s
 *   的 82%；题面锚定「图会不会改变判定」而非「图有没有用」——文字指代已
 *   清晰时纯表情包/氛围配图也算 sufficient）
 */

export const JEV_VISIONGATE_QUESTIONS_VERSION = 'G1.0';

/**
 * 构建 vision 预判门问题集
 * @returns {Object} questions {id: {type, instructions, criteria}}
 */
export function buildVisionGateQuestions() {
  return {
    vision_gate_sufficiency: {
      type: 'choice',
      instructions: `Narrative corpus sufficiency for skipping image analysis. The corpus below does NOT contain an image analysis block — the source tweet has one attached image but it has not been visually analyzed yet. Answer ONE question only: based on the available TEXTUAL corpus alone (tweet text / account info / website / background material), is the evidence for the narrative judgment already sufficient? That is, could this attached image possibly carry key evidence that would CHANGE the judgment?
Pick need_image if ANY of these holds:
- The name evidence may live in the image: the token Symbol/Name has no literal or semantic link to the textual corpus, and the only possible carrier of the reference is in-image text or the visual subject of the attached image (meme names that only appear in a screenshot's caption / search bar / watermark).
- Visual reversal evidence: the token name points to some entity / character / brand, and the attached image could be decisive visual evidence of that entity (the concrete appearance of a character or figure, a brand-hijack confirmation or its refutation) — the image's content would directly change the reference or hijack judgment.
- Weak textual reference: the tweet text does not clearly state what this coin refers to or which event it rides, and the image is needed to complete the reference.
Pick sufficient only if ALL of these hold:
- The textual corpus already names the narrative subject and event clearly (who, what happened, and the link to the coin name is judgeable).
- The coin name's reference has literal or semantic evidence in the text and does not depend on in-image text.
- Even if the image has content, it is most likely just an atmospheric/decorative image that carries no judgment-changing evidence.
⚠️ The judgment target is "could the image CHANGE the verdict", NOT "is the image useful" — when the textual reference is already clear, a pure reaction-meme or decorative image still counts as sufficient.`,
      criteria: {
        sufficient: 'Textual corpus is already sufficient: subject / event / reference are clear, the attached image carries no key evidence that would change the judgment — skipping visual analysis loses nothing',
        need_image: 'Textual corpus is insufficient: coin name has weak textual linkage / the meme name may only exist in the image\'s in-image text / the image could be visual evidence of an entity or brand hijack — visual analysis is needed',
      },
    },
  };
}

/**
 * 薄判定：读预判答案（JevClient._validate 已保证 answer 存在，缺答案在 ask 层 throw）
 * probabilities.sufficient 缺失 → 0 = 不跳过（fail-safe 跑 vision，与 mapper
 * 「miss 不误拦」保守口径同向——门的 miss 方向是宁跑勿跳）
 * @param {Object} answers JevClient answers 映射
 * @param {Object} [opts] { minSufficientProb }（config vision.gate.minSufficientProb）
 * @returns {{skipped: boolean, choice: string|null, prob: number|null}}
 */
export function judgeVisionGate(answers, opts = {}) {
  const minSufficientProb = opts.minSufficientProb ?? 0.6;
  const a = answers?.vision_gate_sufficiency;
  const choice = a?.choice === 'sufficient' ? 'sufficient' : 'need_image';
  const prob = a == null ? null : Number(a.probabilities?.sufficient ?? 0);
  return { skipped: choice === 'sufficient' && (prob ?? 0) >= minSufficientProb, choice, prob };
}
