import { db } from "./database";

/**
 * 数据迁移：在应用启动时调用。
 * 预留 schemaVersion 升级逻辑。当前为 v1，无需迁移。
 */
export async function runMigrations(): Promise<void> {
  // 示例：未来 v1 -> v2 时
  // if (db.verno < 2) {
  //   // 对新增字段回填默认值
  // }
}
