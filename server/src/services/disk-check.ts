import { statfsSync } from "node:fs";

export type DiskThresholdState = "ok" | "warn" | "alert" | "critical";

export interface DiskStatus {
  total: number;
  used: number;
  available: number;
  percentUsed: number;
  thresholdState: DiskThresholdState;
}

const WARN_THRESHOLD = 0.85;
const ALERT_THRESHOLD = 0.90;
const CRITICAL_THRESHOLD = 0.95;

function getThresholdState(percentUsed: number): DiskThresholdState {
  if (percentUsed >= CRITICAL_THRESHOLD) return "critical";
  if (percentUsed >= ALERT_THRESHOLD) return "alert";
  if (percentUsed >= WARN_THRESHOLD) return "warn";
  return "ok";
}

/**
 * Read disk usage for the filesystem containing the given path.
 * Falls back to the root filesystem if the path is unavailable.
 */
export function getDiskStatus(filePath?: string): DiskStatus {
  const targetPath = filePath || "/";
  try {
    const raw = statfsSync(targetPath) as unknown as { bsize: number; blocks: number; bfree: number; bavail: number };
    const { bsize, blocks, bfree, bavail } = raw;
    const total = blocks * bsize;
    const free = bfree * bsize;
    const used = total - free;
    const percentUsed = total > 0 ? used / total : 0;
    // Round to 2 decimal places
    const percentUsedRounded = Math.round(percentUsed * 10000) / 100;

    return {
      total,
      used,
      available: bavail * bsize,
      percentUsed: percentUsedRounded,
      thresholdState: getThresholdState(percentUsed),
    };
  } catch {
    // Fallback: cannot determine disk status
    return {
      total: 0,
      used: 0,
      available: 0,
      percentUsed: 0,
      thresholdState: "ok",
    };
  }
}

/**
 * Check if disk is at critical level (>95% used).
 * Useful for gating dispatches before Postgres goes offline.
 */
export function isDiskCritical(filePath?: string): boolean {
  return getDiskStatus(filePath).thresholdState === "critical";
}
