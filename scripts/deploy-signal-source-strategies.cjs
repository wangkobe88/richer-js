#!/usr/bin/env node
// ══════════ 已退役（T202 策略库二期，2026-11-20）══════════
// 本脚本随策略库二期整体退役：strategy_library 表不再有 side/legs 两列
// （v1 同侧腿组条目形态已删除），本脚本的入库形状对新表非法。
//
// 现行唯一部署通道：scripts/deploy-trading-strategy.cjs（条目=完整交易策略包：
// 买/卖腿 + stallClose/burstCooldown + 四检测模块版本键；买 14 腿与 本脚本
// v34 时代的 LEGS 同源，provenance 见其头注）。
//
// v1→v34 演进史（T117/T119~T201 各案用户裁定原文）在 git 历史（本文件退役前版本）
// 与 docs/交易策略改进与Case台账.md；本文件保留 tombstone 防误用防 --commit 复活
// 旧形状（low-zone-stall-exit 弃用臂防复活同款纪律）。
'use strict';
console.error('FATAL 本脚本已退役（T202 策略库二期 2026-11-20）——策略库表已换 definition 形状，');
console.error('      旧 side/legs 入库形状非法。现行部署通道：node scripts/deploy-trading-strategy.cjs [--commit]');
process.exit(1);
