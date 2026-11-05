/**
 * BP 测试集本地文件服务（BP3，2026-11-05）：读 scripts/buy-point/sets/*.json
 * （set JSON 进 git；*-ticks/ 目录不进不读——点位页只消费 set 内锚+前向收益）。
 * 纯文件读零 DB 零网络（182 不跑 web；本地 3010 消费）。
 */
const fs = require('fs');
const path = require('path');

const SETS_DIR = path.resolve(__dirname, '..', '..', '..', 'scripts', 'buy-point', 'sets');

/** set 名安全校验（防路径穿越：仅 [\w.-] 且不舔 ..） */
function assertSetName(name) {
  if (!/^[\w.-]+$/.test(String(name || '')) || String(name).includes('..')) {
    const err = new Error(`set 名非法: ${name}`);
    err.status = 400;
    throw err;
  }
}

function listSets() {
  if (!fs.existsSync(SETS_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(SETS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const name = f.slice(0, -5);
    if (name.endsWith('-ticks')) continue; // ticks 目录同名 JSON 不存在，防御双保险
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(SETS_DIR, f), 'utf8'));
      out.push({
        name,
        builtAt: doc.builtAt || null,
        points: Array.isArray(doc.points) ? doc.points.length : 0,
        tokens: doc.counts && doc.counts.tokens || 0,
        source: (doc.sampleRule && doc.sampleRule.source) || null,
      });
    } catch (e) {
      out.push({ name, builtAt: null, points: 0, tokens: 0, source: null, error: `解析失败: ${e.message}` });
    }
  }
  out.sort((a, b) => String(b.builtAt || '').localeCompare(String(a.builtAt || '')));
  return out;
}

/** 单 set（tokenFilter 小写可选过滤点位）；含 tokens meta/counts/sampleRule */
function getSet(name, tokenFilter) {
  assertSetName(name);
  const file = path.join(SETS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    const err = new Error(`set 不存在: ${name}`);
    err.status = 404;
    throw err;
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (tokenFilter) {
    const k = String(tokenFilter).toLowerCase();
    doc.points = (doc.points || []).filter((p) => String(p.tokenAddress || '').toLowerCase() === k);
  }
  return doc;
}

module.exports = { listSets, getSet, SETS_DIR };
