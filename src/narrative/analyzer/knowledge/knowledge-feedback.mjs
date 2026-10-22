/**
 * 叙事知识库反馈回写（C165 用户裁定自动沉淀——模拟 Claude Code 的渐进积累）
 *
 * 分析完成保存成功后调用：高评级票 / （毕业 ∧ 非 low 票）自动 upsert 进
 * quasi-feedback 知识文件，成为后续分析的背景知识（下次分析热载生效）。
 *
 * 红线：
 * - 只沉淀客观字段（名字/地址/叙事摘要/评级/毕业时间），narrative=intro 截断 +
 *   '本系统评 {rating}：' + reason 截断——全部取自分析产物，不让 LLM 自由编写知识；
 * - 失败 warn 不抛（绝不影响分析主链路）；写走读旧→upsert→驱逐→tmp(pid+rand)+rename
 *   原子重写（多 worker 并发同票丢更新可接受，下次分析自愈）；
 * - 毕业点查走 dbManager（service key——wss_events 对 anon 被 RLS 静默过滤），
 *   按 token_address 过滤点查（有索引；kind 无索引坑只影响全局扫，此处不涉）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from '../../core/logger.mjs';
import { getKnowledgeConfig } from './knowledge-config.mjs';
import { dbManager } from '../../../services/dbManager.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * 纯判定（单测锚）：rating ∈ captureRatings，或（graduatedAlso ∧ isGraduated ∧ rating ≠ 'low'）
 * @param {Object} record - { address, symbol, name, rating, ... }
 * @param {Object} feedbackConfig - { captureRatings, graduatedAlso }
 * @param {boolean} isGraduated - 毕业点查结果
 * @returns {boolean}
 */
export function _shouldCapture(record, feedbackConfig, isGraduated) {
  if (!record || !record.address || !record.rating) return false;
  const cfg = feedbackConfig || { captureRatings: ['high'], graduatedAlso: true };
  if ((cfg.captureRatings || ['high']).includes(record.rating)) return true;
  if (cfg.graduatedAlso !== false && isGraduated && record.rating !== 'low') return true;
  return false;
}

/** 毕业点查：wss_events graduation 行存在性（token_address 过滤可用索引，limit 1 毫秒级） */
export async function _isGraduated(address, options = {}) {
  if (options.queryGraduation) return Boolean(await options.queryGraduation(address));
  const client = dbManager.getClient();
  const { data, error } = await client.from('wss_events')
    .select('created_at')
    .eq('token_address', address)
    .eq('kind', 'graduation')
    .limit(1);
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

/** 客观叙事摘要：intro 截 120 + '本系统评 {rating}：' + reason 截 200 */
function buildNarrative(record) {
  const intro = String(record.introCn || record.description || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const reason = String(record.reason || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const parts = [];
  if (intro) parts.push(intro);
  if (record.rating) parts.push(`本系统评 ${record.rating}${reason ? `：${reason}` : ''}`);
  return parts.join('｜');
}

/**
 * 分析完成后的反馈回写（analyzer 最终 save 成功后调用）
 * @param {Object} record - 全部取自分析产物：{ address, symbol, name, introCn,
 *   description, rating, tokenCategory, reason, analyzedAt, graduatedAt }
 * @param {Object} [options] - 单测注入 { config, fs, root, now, queryGraduation, isGraduated }
 * @returns {Promise<boolean>} 是否写入（false=不满足条件/配置关/全部失败 warn）
 */
export async function maybeCaptureKnowledgeFeedback(record, options = {}) {
  let cfg;
  try {
    cfg = options.config !== undefined ? getKnowledgeConfig({ config: options.config }) : getKnowledgeConfig();
  } catch (e) {
    logger.warn('Knowledge', `反馈回写配置读取失败（跳过，不影响分析）| ${e.message}`);
    return false;
  }
  if (!cfg || !cfg.feedback || cfg.feedback.enabled === false) return false;
  const fb = cfg.feedback;

  let isGraduated = Boolean(record?.graduatedAt);
  if (!isGraduated && fb.graduatedAlso !== false && record?.rating && record.rating !== 'low') {
    try {
      isGraduated = options.isGraduated !== undefined
        ? options.isGraduated
        : await _isGraduated(record.address, options);
    } catch (e) {
      logger.warn('Knowledge', `毕业点查失败（本票按未毕业处理）| ${record.address} | ${e.message}`);
      isGraduated = false;
    }
  }
  if (!_shouldCapture(record, fb, isGraduated)) return false;

  const fsImp = options.fs ?? fs;
  const root = options.root ?? ROOT;
  const file = path.resolve(root, fb.path);
  const now = options.now ?? new Date().toISOString();

  const entry = {
    id: `q:${String(record.address).toLowerCase()}`,
    kind: 'quasi',
    name: record.name || record.symbol || '',
    symbol: record.symbol || '',
    aliases: [],
    address: String(record.address).toLowerCase(),
    twitter: record.twitter || null,
    narrative: buildNarrative(record),
    graduatedAt: record.graduatedAt || (isGraduated ? now : null),
    rating: record.rating || null,
    tokenCategory: record.tokenCategory || null,
    corpusTrigger: true,
    source: 'feedback',
    analyzedAt: record.analyzedAt || now,
    updatedAt: now,
  };

  try {
    await fsImp.promises.mkdir(path.dirname(file), { recursive: true });
    let doc;
    try {
      doc = JSON.parse(await fsImp.promises.readFile(file, 'utf8'));
    } catch {
      doc = null; // 首写/损坏（feedback 文件损坏宁可重建——数据可从下次分析再生）
    }
    const entries = Array.isArray(doc?.entries) ? doc.entries.filter((e) => e && e.id !== entry.id) : [];
    entries.push(entry); // 同地址 upsert（留最新）
    // 超 maxEntries 驱逐最旧（analyzedAt 升序；缺 analyzedAt 视为最旧）
    let evicted = 0;
    if (entries.length > fb.maxEntries) {
      entries.sort((a, b) => String(a.analyzedAt || '').localeCompare(String(b.analyzedAt || '')));
      const keep = entries.slice(entries.length - fb.maxEntries);
      evicted = entries.length - keep.length;
      entries.length = 0;
      entries.push(...keep);
    }
    const out = { kind: 'quasi', version: 1, generatedAt: now, entries };
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    await fsImp.promises.writeFile(tmp, JSON.stringify(out, null, 2));
    await fsImp.promises.rename(tmp, file);
    logger.info('Knowledge', `反馈沉淀 ${entry.symbol || entry.name} | ${entry.address} | 评 ${entry.rating}`
      + `${evicted ? ` | 驱逐 ${evicted} 旧条目` : ''}`);
    return true;
  } catch (e) {
    logger.warn('Knowledge', `反馈回写失败（不影响分析）| ${record.address} | ${e.message}`);
    return false;
  }
}
