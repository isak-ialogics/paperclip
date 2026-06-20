import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PaperclipConfig } from "../config/schema.js";
import type { CheckResult } from "./index.js";
import { resolveRuntimeLikePath } from "./path-resolver.js";

export async function databaseCheck(config: PaperclipConfig, configPath?: string): Promise<CheckResult> {
  if (config.database.mode === "postgres") {
    if (!config.database.connectionString) {
      return {
        name: "Database",
        status: "fail",
        message: "PostgreSQL mode selected but no connection string configured",
        canRepair: false,
        repairHint: "Run `paperclipai configure --section database`",
      };
    }

    try {
      const { createDb } = await import("@paperclipai/db");
      const db = createDb(config.database.connectionString);
      await db.execute("SELECT 1");
      return {
        name: "Database",
        status: "pass",
        message: "PostgreSQL connection successful",
      };
    } catch (err) {
      return {
        name: "Database",
        status: "fail",
        message: `Cannot connect to PostgreSQL: ${err instanceof Error ? err.message : String(err)}`,
        canRepair: false,
        repairHint: "Check your connection string and ensure PostgreSQL is running",
      };
    }
  }

  if (config.database.mode === "embedded-postgres") {
    const dataDir = resolveRuntimeLikePath(config.database.embeddedPostgresDataDir, configPath);

    // Detect when embedded-postgres is pointing at a temp dir — usually caused by
    // PAPERCLIP_HOME / PAPERCLIP_IN_WORKTREE leaking into the primary instance env.
    // Use os.tmpdir() as primary check; fall back to common temp paths if os.tmpdir()
    // returns a non-absolute path (e.g. TMPDIR env var set to a non-path string).
    const tmpDirCheck = os.tmpdir();
    const isTempPath = dataDir.startsWith(tmpDirCheck) ||
      (tmpDirCheck !== dataDir && !path.isAbsolute(tmpDirCheck) && (
        dataDir.startsWith("/tmp") ||
        dataDir.startsWith(path.join(os.homedir(), "AppData", "Local", "Temp"))
      ));
    if (isTempPath) {
      return {
        name: "Database",
        status: "warn",
        message: `Embedded PostgreSQL data dir is inside the OS temp directory (${dataDir}). This is usually caused by PAPERCLIP_HOME / PAPERCLIP_IN_WORKTREE leaking from a worktree environment. The primary instance will boot against an empty database — existing users will not be visible. Unset PAPERCLIP_HOME and PAPERCLIP_IN_WORKTREE for the primary instance, or pass --data-dir to point at the real data directory.`,
      };
    }

    const reportedPath = dataDir;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(reportedPath, { recursive: true });
    }

    return {
      name: "Database",
      status: "pass",
      message: `Embedded PostgreSQL configured at ${dataDir} (port ${config.database.embeddedPostgresPort})`,
    };
  }

  return {
    name: "Database",
    status: "fail",
    message: `Unknown database mode: ${String(config.database.mode)}`,
    canRepair: false,
    repairHint: "Run `paperclipai configure --section database`",
  };
}
