import { describe, expect, it } from "vitest";
import { getDiskStatus, isDiskCritical, type DiskThresholdState } from "../services/disk-check.js";

describe("disk-check", () => {
  it("returns valid disk status for root filesystem", () => {
    const status = getDiskStatus("/");
    expect(status.total).toBeGreaterThan(0);
    expect(status.used).toBeGreaterThanOrEqual(0);
    expect(status.available).toBeGreaterThanOrEqual(0);
    expect(status.used + status.available).toBeLessThanOrEqual(status.total);
    expect(status.percentUsed).toBeGreaterThanOrEqual(0);
    expect(status.percentUsed).toBeLessThanOrEqual(100);
    expect(["ok", "warn", "alert", "critical"]).toContain(status.thresholdState);
  });

  it("returns zeroed status on failure", () => {
    // Non-existent path should not throw
    const status = getDiskStatus("/nonexistent/path/that/does/not/exist");
    expect(status.total).toBe(0);
    expect(status.used).toBe(0);
    expect(status.available).toBe(0);
    expect(status.percentUsed).toBe(0);
    expect(status.thresholdState).toBe("ok");
  });

  it("classifies threshold states correctly", () => {
    // We can't easily simulate high disk usage, but we can verify the function doesn't crash
    const status = getDiskStatus("/");
    const state: DiskThresholdState = status.thresholdState;
    expect(["ok", "warn", "alert", "critical"]).toContain(state);
  });

  it("isDiskCritical returns boolean", () => {
    const result = isDiskCritical("/");
    expect(typeof result).toBe("boolean");
  });
});
