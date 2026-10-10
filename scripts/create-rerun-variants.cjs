#!/usr/bin/env node
// ============================================================================
// TPA wallet 口径修复后重跑 + lag 门/earlyTradesUniqueWallets 对照建臂（2026-10-10）
//
// 背景：二期（commit 9d18253）TPA 链路 + wallet_offline_profiles 画像库整套切
// sender（wallet）口径，画像库 columnsTag MISS 全量重建后，重跑两实验对拍
// TPA 因子变化；另按用户裁定做两个买门对照：
//   ①「我非常质疑购买条件中 earlyReturn >= 100 是否还有效果……倾向于尽可能早的
//     购入代币，而不是需要一些盘面的确认信息。我的想法是去掉这个条件」——
//     earlyReturn >= 100 是 lag 门 (narrativeCorpusLagSec < 300 OR earlyReturn >= 100)
//     的 OR 右臂（晚票的盘面确认证据）。去掉右臂 = lag>=300 晚票全拦（收紧，
//     与意图相反）；去整条 = 晚票不再要盘面确认（与「尽可能早买入」一致）→ C 臂去整条。
//   ②「earlyTradesUniqueWallets 也是同理，看看是否适合放宽」——D 臂 15→10 / 15→5。
//
// 臂定义（全部 backtest，与源实验同窗口同源 bit-identical）：
//   b1  复刻 e15401a9（三门窗口 2 基底 R0b：src=a21fa102，10-08 14:37→10-10 04:58）
//       —— 对拍基线：源实验净额 -0.9893 BNB（22 票，胜率 22.7%），差分 = 纯 TPA 库切换
//   b2  复刻 3e57ed75（三门验证 G1低名+G7slope+G4bundler：src=36a2c12a，10-04→10-08）
//   c   b1 + pbc 去掉整条 lag 门子句（narrativeCorpusLagSec 与 earlyReturn 两键全退场）
//   d10 b1 + pbc 的 earlyTradesUniqueWallets >= 15 → >= 10
//   d5  b1 + earlyTradesUniqueWallets >= 15 → >= 5
//
// 叙事缓存：两窗口 J1.29 口径缓存均已落（R0b/载体门臂真调落缓存），全部臂
// 缓存命中零 Jev 真调 → 各臂叙事口径一致，差分纯来自画像库/门子句。
// 跑序无依赖，可串行跑；⚠️ 必须等画像库重建完成 + 删死行之后再启动 run-engine
// （回测启动时读画像库，混杂期数据脏）。
//
// 用法（182）：node scripts/create-rerun-variants.cjs --arm all|b1|b2|c|d10|d5 [--commit]
//   默认 dry-run 打印各臂 diff 摘要；--commit 真建。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const E15401A9 = 'e15401a9-ddf9-4760-8ecc-b7b7b75815bc'; // 窗口 2 基底 R0b
const E3E57ED75 = '3e57ed75-133e-497d-b8c8-b190eca2a6b8'; // 窗口 1 三门臂

// lag 门整条子句（含前导 AND，与源 pbc 逐字对齐）
const LAG_CLAUSE = ' AND (narrativeCorpusLagSec < 300 OR earlyReturn >= 100)';
const UW_OLD = 'earlyTradesUniqueWallets >= 15';

const ARMS = {
    b1: { src: E15401A9, suffix: '-TPAwallet重跑', desc: 'TPA wallet 口径修复后重跑（b1）' },
    b2: { src: E3E57ED75, suffix: '-TPAwallet重跑', desc: 'TPA wallet 口径修复后重跑（b2）' },
    c: { src: E15401A9, suffix: '-去lag门', desc: 'lag 门整条去除对照臂（c）' },
    d10: { src: E15401A9, suffix: '-uw10', desc: 'earlyTradesUniqueWallets 15→10 放宽臂（d10）' },
    d5: { src: E15401A9, suffix: '-uw5', desc: 'earlyTradesUniqueWallets 15→5 放宽臂（d5）' },
};

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const armIdx = args.indexOf('--arm');
const ARM = armIdx > -1 ? args[armIdx + 1] : 'all';
if (ARM !== 'all' && !Object.keys(ARMS).includes(ARM)) {
    throw new Error('--arm 只接受 all|' + Object.keys(ARMS).join('|') + '，收到: ' + ARM);
}

/** 还原 name/description 后 JSON 串（diff 校验用） */
function strip(cfg) {
    const s = JSON.parse(JSON.stringify(cfg));
    delete s.name;
    delete s.description;
    return JSON.stringify(s);
}

async function main() {
    const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
    const factory = ExperimentFactory.getInstance();
    const [srcA, srcB] = await Promise.all([factory.load(E15401A9), factory.load(E3E57ED75)]);
    if (!srcA) throw new Error('源实验不存在: ' + E15401A9);
    if (!srcB) throw new Error('源实验不存在: ' + E3E57ED75);

    const toRun = ARM === 'all' ? Object.keys(ARMS) : [ARM];
    const created = [];

    for (const arm of toRun) {
        const def = ARMS[arm];
        const src = def.src === E15401A9 ? srcA : srcB;
        const cfg = JSON.parse(JSON.stringify(src.config));
        const buy = cfg.strategiesConfig.buyStrategies[0];
        const origPbc = buy.preBuyCheckCondition;

        if (arm === 'c') {
            if (!origPbc.includes(LAG_CLAUSE)) {
                throw new Error(`[${arm}] 源 pbc 未含 lag 门子句（替换落空防静默），pbc=${origPbc}`);
            }
            buy.preBuyCheckCondition = origPbc.replace(LAG_CLAUSE, '');
            if (buy.preBuyCheckCondition.includes('narrativeCorpusLagSec')
                || buy.preBuyCheckCondition === origPbc) {
                throw new Error(`[${arm}] lag 门子句替换后校验失败`);
            }
        } else if (arm === 'd10' || arm === 'd5') {
            if (!origPbc.includes(UW_OLD)) {
                throw new Error(`[${arm}] 源 pbc 未含 ${UW_OLD}（替换落空防静默），pbc=${origPbc}`);
            }
            buy.preBuyCheckCondition = origPbc.replace(UW_OLD,
                'earlyTradesUniqueWallets >= ' + (arm === 'd10' ? '10' : '5'));
        }

        // diff 校验：b1/b2 与源零差异；c/d10/d5 除 pbc 外零差异
        const chk = JSON.parse(JSON.stringify(cfg));
        delete chk.name; delete chk.description;
        if (arm === 'b1' || arm === 'b2') {
            if (JSON.stringify(chk) !== JSON.stringify((({ name, description, ...rest }) => rest)(src.config))) {
                throw new Error(`[${arm}] 与源实验差异超出 name/description——应零差异`);
            }
        } else {
            const base = JSON.parse(JSON.stringify(src.config));
            delete base.name; delete base.description;
            base.strategiesConfig.buyStrategies[0].preBuyCheckCondition = buy.preBuyCheckCondition;
            if (JSON.stringify(chk) !== JSON.stringify(base)) {
                throw new Error(`[${arm}] 与源实验差异超出 name/description/pbc——应零差异`);
            }
        }

        cfg.name = (src.config.name || src.config.experiment_name || '回测') + def.suffix;
        cfg.description = `${def.desc}：源 ${def.src} config ` + (arm === 'b1' || arm === 'b2'
            ? 'bit-identical（同窗口同源），唯一变量 = TPA 链路+画像库二期切 wallet 口径（9d18253）'
            : (arm === 'c'
                ? '去 lag 门整条 (narrativeCorpusLagSec < 300 OR earlyReturn >= 100)——晚票不再要盘面确认（用户裁定 2026-10-10）'
                : `pbc ${UW_OLD} 放宽（用户裁定 2026-10-10）`))
            + `；画像库 = 二期 sender 口径重建版。`;

        console.log(`\n===== 臂 ${arm}（源 ${def.src}）=====`);
        console.log('  name:', cfg.name);
        console.log('  condition:', buy.condition);
        console.log('  preBuy:', buy.preBuyCheckCondition);
        console.log('  backtest:', JSON.stringify(cfg.backtest));
        created.push({ arm, cfg });
    }

    if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建'); process.exit(0); }

    for (const { arm, cfg } of created) {
        const container = await factory.createFromConfig(cfg, 'backtest');
        console.log(`\n[${arm}] created: ${container.id}`);
        console.log(`  下一步：node src/run-engine.js ${container.id}  # 须画像库重建完成后`);
    }
    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
