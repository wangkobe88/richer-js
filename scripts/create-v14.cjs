const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../config/.env") });
const COMMIT = process.argv.includes("--commit");
const SRC = "51bd22ad-23a3-4518-8a48-ae84482d429e";

async function main() {
  const { ExperimentFactory } = require("../src/trading-engine/factories/ExperimentFactory");
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC);
  if (!src) throw new Error("源实验不存在: " + SRC);
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== "both") throw new Error("源 platform != both: " + cfg.platform);
  const buy = cfg.strategiesConfig?.buyStrategies?.[0];
  if (!buy) throw new Error("买腿缺失");
  if (!buy.condition.includes("holderTrendSlope > 0") || buy.condition.includes("IS NULL"))
    throw new Error("源 fire condition 非 buy-v2 v10 形状: " + buy.condition);
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error("源 perCardBNB 缺失: " + JSON.stringify(cfg.positionManagement));
  if (!cfg.wallet?.executorId) throw new Error("源无 wallet.executorId");
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 11) throw new Error("源卖腿数=" + sellLegs.length + " 期望 11（P0-P9+P11）");

  cfg.name = "v14-实盘-both-两阶段喂食-1014";
  cfg.description = "v13 换行（2026-10-14 鸡蛋案修复）：引擎/FA 层两阶段喂食（5488c93）——价格段 WSS 到达即喂"
    + "（fire 价/lastTickAt 零回查依赖）+ wallet 段 sender 回查后补（holders/K 组/GMGN 真 sender 计数）"
    + "+ chainLate 复合水位拦迟到旧价 + holderTrend defer 路径事件缓冲反推正放重放。"
    + "config 与 v13 51bd22ad 逐字零改动（buy-v2 v10 买门+11 卖腿+perCardBNB 0.001+executor 全继承）。源=v13 51bd22ad";

  console.log("platform:", cfg.platform, "| perCardBNB:", cfg.positionManagement.perCardBNB, "| sellLegs:", sellLegs.length);
  console.log("fire:", buy.condition);
  if (!COMMIT) { console.log("[dry-run]"); process.exit(0); }
  const c = await factory.createFromConfig(cfg, "live");
  console.log("V14_LIVE_ID=" + c.id);
  process.exit(0);
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
