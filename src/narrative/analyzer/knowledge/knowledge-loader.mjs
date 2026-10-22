/**
 * 叙事知识库加载器（5 文件聚合 + 按 id 合并 + mtime 热载）
 *
 * 形态裁定（C165）：每类单文件聚合而非一票一文件——条目由 builder/反馈回写整批
 * 生成，tmp+rename 原子重写是安全不变量；「索引」由本模块加载时现建内存索引
 * 承担（不落盘派生索引，杜绝双源漂移）。
 *
 * 热载：每次 getKnowledgeBase 前对全部文件 stat（mtime+size 指纹），变化即重载
 * ——分析任务 spawn Worker 线程天然新鲜；主线程直调/惰性 import 常驻路径靠
 * mtime 覆盖。知识文件更新免重启 worker（config 段变更仍需重启，与全仓一致）。
 *
 * 容错语义：知识 miss=正常态。配置关/全部文件缺失/全部空 → null（注入全旁路，
 * state 逐字节 bit-parity）；单文件 JSON 损坏 → warn 跳过该文件（分析路径
 * fail-open，绝不因知识文件问题让 analyze 失败）；条目最小校验剔除（缺
 * name/kind/地址形状非法）。
 *
 * 合并序（后读覆盖先读同 id）：concepts → bluechips → quasiGraduations →
 * quasiFeedback → manual（manual 人工补录覆盖权最高——彪哥掉榜兜底先例）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from '../../core/logger.mjs';
import { getKnowledgeConfig } from './knowledge-config.mjs';
import { buildKnowledgeIndex, isValidKnowledgeEntry } from './knowledge-matcher.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** 读取序=覆盖序（files 配置键） */
const FILE_ORDER = ['concepts', 'bluechips', 'quasiGraduations', 'quasiFeedback', 'manual'];

let _cache = null; // { fingerprint, kb }

/** 条目合并键：显式 id 优先；缺 id 派生 kind:address（无地址退 kind:归一化名） */
function entryKey(e) {
  if (e.id) return String(e.id);
  if (e.address) return `${e.kind}:${String(e.address).toLowerCase()}`;
  return `${e.kind}:${e.name}`;
}

/**
 * 取知识库（模块级单例 + mtime 热载）
 * @param {Object} [options] - 单测注入 { config, fs, root, forceReload }
 * @returns {Promise<{index:Object, files:Array, entriesTotal:number, loadedAt:string}|null>}
 *   null = 配置关 / 全部文件缺失或全空（知识 miss=正常态，注入全旁路）
 */
export async function getKnowledgeBase(options = {}) {
  const cfg = options.config !== undefined ? getKnowledgeConfig({ config: options.config }) : getKnowledgeConfig();
  if (!cfg) return null;
  const fsImp = options.fs ?? fs;
  const root = options.root ?? ROOT;

  const paths = FILE_ORDER.map((k) => path.resolve(root, cfg.files[k]));
  const stats = await Promise.all(paths.map((p) =>
    fsImp.promises.stat(p)
      .then((s) => `${s.mtimeMs}:${s.size}`)
      .catch(() => null), // 缺失=正常态（代码可先于数据落地）
  ));
  const fingerprint = paths.map((p, i) => `${p}|${stats[i] ?? 'missing'}`).join('\n');
  if (_cache && _cache.fingerprint === fingerprint && !options.forceReload) {
    return _cache.kb;
  }

  const files = [];
  const entriesById = new Map();
  for (let i = 0; i < paths.length; i++) {
    if (!stats[i]) continue;
    let doc;
    try {
      doc = JSON.parse(await fsImp.promises.readFile(paths[i], 'utf8'));
    } catch (e) {
      logger.warn('Knowledge', `知识文件 JSON 损坏跳过（分析 fail-open）| ${paths[i]} | ${e.message}`);
      continue;
    }
    const arr = Array.isArray(doc?.entries) ? doc.entries : [];
    let count = 0;
    for (const e of arr) {
      if (!isValidKnowledgeEntry(e)) continue;
      entriesById.set(entryKey(e), { ...e }); // 后读覆盖先读
      count++;
    }
    files.push({ path: paths[i], mtime: stats[i], count });
  }

  const kb = entriesById.size === 0
    ? null
    : {
        index: buildKnowledgeIndex([...entriesById.values()]),
        files,
        entriesTotal: entriesById.size,
        loadedAt: new Date().toISOString(),
      };
  _cache = { fingerprint, kb };
  return kb;
}

/** 单测用：清模块级缓存 */
export function invalidateKnowledgeBase() {
  _cache = null;
}
