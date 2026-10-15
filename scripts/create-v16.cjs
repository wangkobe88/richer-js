const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../config/.env") });
const COMMIT = process.argv.includes("--commit");
const SRC = "e3a68c26-f4ce-432f-af9b-513aa079773d"; // v15 virtual both（GMGN 门首跑版）
const WALLET_REF = "8e271a2d-1eb9-48e2-b925-38fcf10c5077"; // v14 live both（wallet 段来源）

async function main() {
  const { ExperimentFactory } = require("../src/trading-engine/factories/ExperimentFactory");
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC);
  if (!src) throw new Error("源实验不存在: " + SRC);
  if (src.status !== "stopped") throw new Error("源实验未停止: " + src.status);
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== "both") throw new Error("源 platform != both: " + cfg.platform);
  const buy = cfg.strategiesConfig?.buyStrategies?.[0];
  if (!buy) throw new Error("买腿缺失");
  // 源形状锁定（v15 谱系：v14 + GMGN 门 + 虚拟资金段）
  if (!buy.condition.includes("holderTrendSlope > 0") || !buy.condition.includes("marketCap < 15000"))
    throw new Error("源 fire condition 非 v15 形状: " + buy.condition);
  if (buy.gmgnCheckCondition !== "gmgnBundlerWalletRatio <= 75")
    throw new Error("源 gmgnCheckCondition 非 v15 形状: " + buy.gmgnCheckCondition);
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error("源 perCardBNB 缺失: " + JSON.stringify(cfg.positionManagement));
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 11) throw new Error("源卖腿数=" + sellLegs.length + " 期望 11（P0-P9+P11）");

  // ── v16 变更（单一变量：virtual→live 模式切换）──
  // wallet 段从 v14 live 原样取（executorId 双源钱包，不在脚本里硬编码）
  const ref = await factory.load(WALLET_REF);
  if (!ref?.config?.wallet?.executorId) throw new Error("v14 wallet.executorId 缺失");
  delete cfg.virtual;
  cfg.wallet = { executorId: ref.config.wallet.executorId };

  cfg.name = "v16-实盘-both-GMGN门-1015";
  cfg.description = "v15 切实盘（GMGN 门首跑验证收口）：买腿三层（触发→预检查→GMGN fail-closed 门 gmgnBundlerWalletRatio<=75）"
    + "与 v15 虚拟版同策略同参数（buy-v2 v13 谱系 3 项 preBuy 买门+11 卖腿+perCardBNB 0.001）；"
    + "wallet 段沿用 v14 8e271a2d 同一 executor（复用历史钱包）。其余 config 与 e3a68c26 逐字零改动（仅删 virtual 段）。源=v15 e3a68c26";

  console.log("platform:", cfg.platform, "| perCardBNB:", cfg.positionManagement.perCardBNB, "| sellLegs:", sellLegs.length);
  console.log("fire:", buy.condition);
  console.log("preBuy:", buy.preBuyCheckCondition);
  console.log("gmgn :", buy.gmgnCheckCondition);
  console.log("wallet:", JSON.stringify(cfg.wallet), "| virtual 段:", cfg.virtual === undefined ? "已删" : "残留!");
  if (!COMMIT) { console.log("[dry-run]"); process.exit(0); }
  const c = await factory.createFromConfig(cfg, "live");
  console.log("V16_LIVE_ID=" + c.id);
  process.exit(0);
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
