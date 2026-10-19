import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDataDirectory } from "../src/server/data-directory.js";

describe("resolveDataDirectory", () => {
  it("prefers an explicit BOSS_WATCH_DATA_DIR override", () => {
    const override = join("custom", "boss-watch");
    expect(resolveDataDirectory({ BOSS_WATCH_DATA_DIR: override })).toBe(override);
  });

  it("ignores a blank override and falls back to the platform default", () => {
    const resolved = resolveDataDirectory({ BOSS_WATCH_DATA_DIR: "   " });
    expect(resolved).not.toBe("   ");
    expect(resolved.length).toBeGreaterThan(0);
  });

  it("resolves a platform-specific directory that names the product", () => {
    const resolved = resolveDataDirectory({});
    expect(resolved.endsWith("BossWatchAgent")).toBe(true);
    expect(resolved).not.toContain("undefined");
  });

  it("uses LOCALAPPDATA on Windows", () => {
    if (process.platform !== "win32") return;
    expect(resolveDataDirectory({ LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" })).toBe(
      join("C:\\Users\\demo\\AppData\\Local", "BossWatchAgent"),
    );
  });

  it("uses XDG_DATA_HOME on Linux", () => {
    if (process.platform !== "linux") return;
    expect(resolveDataDirectory({ XDG_DATA_HOME: "/home/demo/.local/share" })).toBe(
      join("/home/demo/.local/share", "BossWatchAgent"),
    );
  });

  it("falls back to the macOS library directory on darwin", () => {
    if (process.platform !== "darwin") return;
    expect(resolveDataDirectory({})).toBe(
      join(homedir(), "Library", "Application Support", "BossWatchAgent"),
    );
  });
});
