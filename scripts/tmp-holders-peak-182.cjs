#!/usr/bin/env node
/**
 * 182 专用：v22/v23/v24 成交票 holders 曲线重建（2026-10-19 持有者门阈值分析）
 *
 * 对每张成交票拉 token 全量 wss_price_ticks（web holder-series 同款分页形状），
 * buildHolderSeries 同口径重放，取买入后 holders 峰值/卖出时刻值/终值。
 * 只在 182 跑（本地 VPN 逐 token 全史扫描必超时——红线 9）。
 *
 * 输入：./tmp-tokens-for-182.json（111 票清单，本地生成后 scp）
 * 输出：./tmp-holders-peak-result.json
 */
'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { buildHolderSeries } = require('../src/web/services/holder-series');

const IN_FILE = path.join(__dirname, 'tmp-tokens-for-182.json');
const OUT_FILE = path.join(__dirname, 'tmp-holders-peak-result.json');

async function fetchAllTicks(db, tokenAddress) {
  const PAGE = 5000;
  const MAX_ROWS = 500000;
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error, count } = await db
      .from('wss_price_ticks')
      .select('block_time, block_number, log_index, trade_type, token_amount, bnb_amount, sender_address, trader_address', { count: 'exact' })
      .eq('token_address', tokenAddress)
      .order('block_time', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    offset += page.length;
    const total = Number.isFinite(count) ? count : null;
    if (!page.length || (total !== null && rows.length >= total)) break;
    if (rows.length > MAX_ROWS) throw new Error(`rows > ${MAX_ROWS} guard: ${tokenAddress}`);
  }
  return rows;
}

async function main() {
  const db = dbManager.getClient();
  const tokens = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
  const results = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    try {
      const rows = await fetchAllTicks(db, tk.addr);
      // maxPoints 大值 = 不降采样（峰值不被抽样削掉）
      const series = buildHolderSeries(rows, { maxPoints: 1e9 });
      const pts = series.points;
      const holdersAt = (ts) => {
        let v = null;
        for (const p of pts) { if (p.t <= ts) v = p.holders; else break; }
        return v;
      };
      const after = pts.filter(p => p.t >= tk.buyAt);
      let peak = -1, peakAt = null;
      for (const p of after) if (p.holders > peak) { peak = p.holders; peakAt = p.t; }
      results.push({
        ...tk,
        totalRows: rows.length,
        holdersAtBuy: holdersAt(tk.buyAt),
        peakAfterBuy: peak >= 0 ? peak : null,
        peakAt: peakAt,
        holdersAtSell: tk.lastSellAt ? holdersAt(tk.lastSellAt) : null,
        finalHolders: series.holders,
        finalPointT: pts.length ? pts[pts.length - 1].t : null,
      });
    } catch (e) {
      results.push({ ...tk, error: e.message });
    }
    if ((i + 1) % 10 === 0 || i === tokens.length - 1) {
      console.log(`[${i + 1}/${tokens.length}] done`);
      fs.writeFileSync(OUT_FILE, JSON.stringify(results)); // 周期落盘防中断全丢
    }
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(results));
  console.log('ALL DONE:', results.length, '->', OUT_FILE);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
