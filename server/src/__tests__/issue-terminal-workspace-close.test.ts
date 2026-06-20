import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  executionWorkspaces,
  issueComments,
  issueInboxArchives,
  issueRelations,
  issues,
  projectWorkspaces,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping issue terminal workspace close tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function ensureIssueRelationsTable(db: ReturnType<typeof createDb>) {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "issue_relations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "company_id" uuid NOT NULL,
      "issue_id" uuid NOT NULL,
      "related_issue_id" uuid NOT NULL,
      "type" text NOT NULL,
      "created_by_agent_id" uuid,
      "created_by_user_id" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `));
}

describeEmbeddedPostgres("issue terminal status stamps execution_workspace cleanup-eligible", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-terminal-ws-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyAndProject() {
    const companyId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Test project",
      status: "in_progress",
    });
    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      companyId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
    });

    return { companyId, projectId, projectWorkspaceId };
  }

  it("stamps closedAt, cleanupEligibleAt, and cleanupReason=issue_terminal when issue transitions to done", async () => {
    const { companyId, projectId, projectWorkspaceId } = await seedCompanyAndProject();
    const executionWorkspaceId = randomUUID();

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      companyId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Issue workspace",
      status: "active",
      providerType: "local_fs",
      cwd: "/tmp/test-workspace",
    });

    const issue = await svc.create(companyId, {
      title: "Test issue",
      status: "todo",
      priority: "medium",
      projectId,
    });

    await db
      .update(issues)
      .set({ executionWorkspaceId })
      .where(eq(issues.id, issue.id));

    await svc.update(issue.id, { status: "done" });

    const [ws] = await db
      .select({
        status: executionWorkspaces.status,
        closedAt: executionWorkspaces.closedAt,
        cleanupEligibleAt: executionWorkspaces.cleanupEligibleAt,
        cleanupReason: executionWorkspaces.cleanupReason,
      })
      .from(executionWorkspaces)
      .where(eq(executionWorkspaces.id, executionWorkspaceId));

    expect(ws).toBeDefined();
    expect(ws.status).toBe("idle");
    expect(ws.closedAt).not.toBeNull();
    expect(ws.cleanupEligibleAt).not.toBeNull();
    expect(ws.cleanupReason).toBe("issue_terminal");
  });

  it("does NOT stamp shared_workspace mode rows when issue transitions to done", async () => {
    const { companyId, projectId, projectWorkspaceId } = await seedCompanyAndProject();
    const executionWorkspaceId = randomUUID();

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      companyId,
      projectId,
      projectWorkspaceId,
      mode: "shared_workspace",
      strategyType: "project_primary",
      name: "Shared workspace",
      status: "active",
      providerType: "local_fs",
      cwd: "/tmp/shared-workspace",
    });

    const issue = await svc.create(companyId, {
      title: "Test issue shared",
      status: "todo",
      priority: "medium",
      projectId,
    });

    await db
      .update(issues)
      .set({ executionWorkspaceId })
      .where(eq(issues.id, issue.id));

    await svc.update(issue.id, { status: "done" });

    const [ws] = await db
      .select({
        status: executionWorkspaces.status,
        closedAt: executionWorkspaces.closedAt,
        cleanupEligibleAt: executionWorkspaces.cleanupEligibleAt,
        cleanupReason: executionWorkspaces.cleanupReason,
      })
      .from(executionWorkspaces)
      .where(eq(executionWorkspaces.id, executionWorkspaceId));

    expect(ws).toBeDefined();
    expect(ws.status).toBe("active");
    expect(ws.closedAt).toBeNull();
    expect(ws.cleanupEligibleAt).toBeNull();
    expect(ws.cleanupReason).toBeNull();
  });

  it("does NOT stamp workspace rows when another non-terminal issue shares the same workspace", async () => {
    const { companyId, projectId, projectWorkspaceId } = await seedCompanyAndProject();
    const executionWorkspaceId = randomUUID();

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      companyId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Shared isolated workspace",
      status: "active",
      providerType: "local_fs",
      cwd: "/tmp/shared-isolated",
    });

    const issueA = await svc.create(companyId, {
      title: "Issue A",
      status: "todo",
      priority: "medium",
      projectId,
    });
    const issueB = await svc.create(companyId, {
      title: "Issue B (still active)",
      status: "todo",
      priority: "medium",
      projectId,
    });

    await db
      .update(issues)
      .set({ executionWorkspaceId })
      .where(eq(issues.id, issueA.id));
    await db
      .update(issues)
      .set({ executionWorkspaceId })
      .where(eq(issues.id, issueB.id));

    await svc.update(issueA.id, { status: "done" });

    const [ws] = await db
      .select({
        status: executionWorkspaces.status,
        closedAt: executionWorkspaces.closedAt,
        cleanupEligibleAt: executionWorkspaces.cleanupEligibleAt,
        cleanupReason: executionWorkspaces.cleanupReason,
      })
      .from(executionWorkspaces)
      .where(eq(executionWorkspaces.id, executionWorkspaceId));

    expect(ws).toBeDefined();
    expect(ws.status).toBe("active");
    expect(ws.closedAt).toBeNull();
    expect(ws.cleanupEligibleAt).toBeNull();
    expect(ws.cleanupReason).toBeNull();
  });
});
