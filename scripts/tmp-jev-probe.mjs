// Jev 真调用探针（2026-11-15，182 跑）：充值后确认 systemone 真调用恢复（非仅 /v1/models 可达）
import { JevClient } from '../src/narrative/analyzer/llm/JevClient.mjs';

const t0 = Date.now();
try {
  const res = await JevClient.ask(
    '探针：用于确认 API 可用性的最小 state。',
    { probe_ping: { type: 'choice', instructions: '这是一个连通性探针。', criteria: { ok: '服务正常', bad: '服务异常' } } },
    { label: 'probe' },
  );
  console.log(`OK ${Date.now() - t0}ms model=${res.model} answer=${JSON.stringify(res.answers.probe_ping?.choice)} tokens=${res.usage?.total_tokens ?? '?'}`);
  process.exit(0);
} catch (e) {
  console.error(`FAIL ${Date.now() - t0}ms ${e.message}`);
  process.exit(1);
}
