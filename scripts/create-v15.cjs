const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../config/.env") });
const COMMIT = process.argv.includes("--commit");
const SRC = "8e271a2d-1eb9-48e2-b925-38fcf10c5077"; // v14 live both（两阶段喂食版）

async function main() {
  const { ExperimentFactory } = require("../src/trading-engine/factories/ExperimentFactory");
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC);
  if (!src) throw new Error("源实验不存在: " + SRC);
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== "both") throw new Error("源 platform != both: " + cfg.platform);
  const buy = cfg.strategiesConfig?.buyStrategies?.[0];
  if (!buy) throw new Error("买腿缺失");
  // 源形状锁定（v13 谱系 3 项 preBuy——v13 起删 uniqueWallets 门）
  if (!buy.condition.includes("holderTrendSlope > 0") || !buy.condition.includes("marketCap < 15000"))
    throw new Error("源 fire condition 非 v14 形状: " + buy.condition);
  if (buy.gmgnCheckCondition) throw new Error("源已有 gmgnCheckCondition，拿错源: " + buy.gmgnCheckCondition);
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error("源 perCardBNB 缺失: " + JSON.stringify(cfg.positionManagement));
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 11) throw new Error("源卖腿数=" + sellLegs.length + " 期望 11（P0-P9+P11）");

  // ── v15 变更（单一变量：买腿第三层 GMGN 门）──
  buy.gmgnCheckCondition = "gmgnBundlerWalletRatio <= 75"; // buy-v2 v11 同款；covered=0 机制硬拒不进表达式
  // live→virtual 模式切换：去 live 钱包段，补虚拟资金段（v7/v10 谱系同款）
  delete cfg.wallet;
  cfg.virtual = { tradeAmount: 0.1, initialBalance: 100 };

  cfg.name = "v15-虚拟-both-GMGN门-1014";
  cfg.description = "v14 切虚拟 + 买腿第三层 GMGN 条件（496844c，FAKER 0xc6ee6bd2…7777 团伙盘案）："
    + "触发→预检查→GMGN 三层，前两层全过、下单前才真调 GMGN getTokenInfo（per-token 5s TTL+失败 10s 冷却）；"
    + "fail-closed——API 失败/超时/未索引/key 缺失 covered=0 机制硬拒。门 gmgnBundlerWalletRatio <= 75（FAKER 案 87.5 会被拦）。"
    + "其余 config 与 v14 8e271a2d 逐字零改动（buy-v2 v13 谱系 3 项 preBuy 买门+11 卖腿+perCardBNB 0.001 全继承）。源=v14 8e271a2d";

  console.log("platform:", cfg.platform, "| perCardBNB:", cfg.positionManagement.perCardBNB, "| sellLegs:", sellLegs.length);
  console.log("fire:", buy.condition);
  console.log("preBuy:", buy.preBuyCheckCondition);
  console.log("gmgn :", buy.gmgnCheckCondition);
  console.log("virtual:", JSON.stringify(cfg.virtual), "| wallet 段:", cfg.wallet === undefined ? "已删" : "残留!");
  if (!COMMIT) { console.log("[dry-run]"); process.exit(0); }
  const c = await factory.createFromConfig(cfg, "virtual");
  console.log("V15_VIRTUAL_ID=" + c.id);
  process.exit(0);
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
