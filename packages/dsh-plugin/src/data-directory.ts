import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 解析本机数据目录：SQLite、简历工件与服务凭据的落点。与 Controller 共用同一套解析规则，保证两侧指向同一目录。
 *
 * 解析优先级：
 * 1. `BOSS_WATCH_DATA_DIR` 环境变量（显式覆盖，跨平台一致）
 * 2. Windows：`%LOCALAPPDATA%\BossWatchAgent`
 * 3. macOS：`~/Library/Application Support/BossWatchAgent`
 * 4. 其余平台（含 WSL/Linux）：`$XDG_DATA_HOME` 或 `~/.local/share` 下的 `BossWatchAgent`
 *
 * Args:
 *   environment: 环境变量表，默认取 `process.env`
 *
 * Returns:
 *   绝对数据目录路径。目录本身不在此处创建。
 */
export function resolveDataDirectory(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const override = environment.BOSS_WATCH_DATA_DIR;
  if (override !== undefined && override.trim().length > 0) return override;

  if (process.platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    if (localAppData !== undefined && localAppData.trim().length > 0) {
      return join(localAppData, "BossWatchAgent");
    }
    return join(homedir(), "AppData", "Local", "BossWatchAgent");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "BossWatchAgent");
  }

  const xdgDataHome = environment.XDG_DATA_HOME;
  const dataHome =
    xdgDataHome !== undefined && xdgDataHome.trim().length > 0
      ? xdgDataHome
      : join(homedir(), ".local", "share");
  return join(dataHome, "BossWatchAgent");
}
