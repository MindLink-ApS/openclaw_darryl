import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfigEnvVars } from "../../../src/config/env-substitution.js";

const repoRoot = process.cwd();

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("Darryl production research config", () => {
  it("uses native web and browser tools without Firecrawl", () => {
    const config = JSON.parse(readText("config/darryl-config.json")) as {
      tools?: {
        web?: {
          search?: Record<string, unknown>;
          fetch?: Record<string, unknown>;
        };
      };
      browser?: Record<string, unknown>;
    };
    const rendered = JSON.stringify(config);

    expect(rendered).not.toMatch(/firecrawl/i);
    expect(config.tools?.web?.search).toMatchObject({
      enabled: true,
      maxResults: 10,
      cacheTtlMinutes: 60,
    });
    expect(config.tools?.web?.search?.provider).toBeUndefined();
    expect(config.tools?.web?.search?.perplexity).toMatchObject({
      model: "perplexity/sonar-pro",
    });
    expect(config.tools?.web?.fetch).toMatchObject({
      enabled: true,
      maxChars: 50000,
      maxRedirects: 5,
    });
    expect(config.browser).toMatchObject({
      enabled: true,
      headless: true,
      noSandbox: true,
      defaultProfile: "openclaw",
    });
  });

  it("provisions browser support on Render and does not request Firecrawl secrets", () => {
    const renderYaml = readText("render.yaml");

    expect(renderYaml).toContain("OPENCLAW_INSTALL_BROWSER");
    expect(renderYaml).toContain('value: "1"');
    expect(renderYaml).toContain("PLAYWRIGHT_BROWSERS_PATH");
    expect(renderYaml).toContain("DARRYL_PUBLIC_BASE_URL");
    expect(renderYaml).not.toContain("FIRECRAWL_API_KEY");
  });

  it("keeps Darryl public callback URLs configurable for GCP migration", () => {
    const config = JSON.parse(readText("config/darryl-config.json")) as {
      gateway?: { controlUi?: { allowedOrigins?: string[] } };
      tools?: { web?: { fetch?: { userAgent?: string } } };
      plugins?: {
        entries?: {
          "darryl-apollo"?: { config?: { webhookBaseUrl?: string } };
        };
      };
    };
    const rendered = JSON.stringify(config);

    expect(config.gateway?.controlUi?.allowedOrigins).toEqual(["${DARRYL_PUBLIC_BASE_URL}"]);
    expect(config.tools?.web?.fetch?.userAgent).toContain("${DARRYL_PUBLIC_BASE_URL}");
    expect(config.plugins?.entries?.["darryl-apollo"]?.config?.webhookBaseUrl).toBe(
      "${DARRYL_PUBLIC_BASE_URL}",
    );
    expect(rendered).not.toContain("openclaw-darryl.onrender.com");
  });

  it("resolves Darryl public callback URLs from the runtime environment", () => {
    const config = JSON.parse(readText("config/darryl-config.json"));
    const resolved = resolveConfigEnvVars(config, {
      APOLLO_API_KEY: "apollo-key",
      APOLLO_WEBHOOK_SECRET: "apollo-webhook-secret",
      DARRYL_PUBLIC_BASE_URL: "https://darryl-agent.example.com",
      EMMA_GMAIL_ADDRESS: "emma@example.com",
      EMMA_GMAIL_APP_PASSWORD: "gmail-app-password",
      GMAIL_PUSH_TOKEN: "gmail-push-token",
      HOOKS_TOKEN: "hooks-token",
      OPENAI_API_KEY: "openai-key",
    }) as {
      gateway?: { controlUi?: { allowedOrigins?: string[] } };
      tools?: { web?: { fetch?: { userAgent?: string } } };
      plugins?: {
        entries?: {
          "darryl-apollo"?: { config?: { webhookBaseUrl?: string } };
        };
      };
    };

    expect(resolved.gateway?.controlUi?.allowedOrigins).toEqual([
      "https://darryl-agent.example.com",
    ]);
    expect(resolved.tools?.web?.fetch?.userAgent).toContain("+https://darryl-agent.example.com");
    expect(resolved.plugins?.entries?.["darryl-apollo"]?.config?.webhookBaseUrl).toBe(
      "https://darryl-agent.example.com",
    );
  });

  it("supports a no-outbound boot path for Darryl migration audits", () => {
    const start = readText("scripts/start.sh");

    expect(start).toContain("OPENCLAW_DARRYL_NO_OUTBOUND");
    expect(start).toContain("OPENCLAW_DARRYL_SKIP_CRON_SEED");
    expect(start).toContain("OPENCLAW_DARRYL_SKIP_KICKSTART");
    expect(start).toContain("OPENCLAW_SKIP_CRON=1");
    expect(start).toContain("OPENCLAW_SKIP_GMAIL_WATCHER=1");
    expect(start).toContain("skipping immediate daily-scout run");
  });

  it("does not overwrite Darryl cron jobs unless explicitly requested", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "darryl-cron-seed-"));
    const cronDir = path.join(stateDir, "cron");
    const jobsFile = path.join(cronDir, "jobs.json");
    fs.mkdirSync(cronDir, { recursive: true });
    fs.writeFileSync(jobsFile, '{"sentinel":true}\n');

    execFileSync("sh", ["scripts/seed-crons.sh"], {
      cwd: repoRoot,
      env: { ...process.env, OPENCLAW_STATE_DIR: stateDir },
      stdio: "pipe",
    });
    expect(fs.readFileSync(jobsFile, "utf8")).toBe('{"sentinel":true}\n');

    execFileSync("sh", ["scripts/seed-crons.sh"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: stateDir,
        OPENCLAW_DARRYL_CRON_SEED_OVERWRITE: "1",
      },
      stdio: "pipe",
    });
    expect(fs.readFileSync(jobsFile, "utf8")).toContain('"id": "daily-scout"');
  });

  it("skips Darryl cron seeding in no-outbound mode", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "darryl-cron-no-outbound-"));
    const jobsFile = path.join(stateDir, "cron", "jobs.json");

    execFileSync("sh", ["scripts/seed-crons.sh"], {
      cwd: repoRoot,
      env: { ...process.env, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_DARRYL_NO_OUTBOUND: "1" },
      stdio: "pipe",
    });

    expect(fs.existsSync(jobsFile)).toBe(false);
  });

  it("keeps Darryl's broad newsletter flow and browser fallback in the agent guidance", () => {
    const workspace = readText("workspace/AGENTS.md");
    const newsletter = readText("workspace/skills/newsletter-parse/SKILL.md");
    const dailyScout = readText("workspace/skills/daily-scout/SKILL.md");
    const leadReport = readText("workspace/skills/lead-report/SKILL.md");

    expect(workspace).toContain("Firecrawl is not available");
    expect(workspace).toContain('browser` with `profile: "openclaw"');
    expect(workspace).toContain("High-priority direct pull");
    expect(workspace).toContain("Capacity Snapshot");
    expect(workspace).toContain("source_label, source_url");
    expect(newsletter).toContain("no matter the title");
    expect(newsletter).toContain("qualification_score >= 60");
    expect(newsletter).toContain('browser` with `profile: "openclaw"');
    expect(dailyScout).toContain("https://www.businessinsurance.com/");
    expect(dailyScout).toContain("Business Insurance - Comings & Goings");
    expect(dailyScout).toContain('source_type: "newsletter"');
    expect(dailyScout).toContain("qualification_score >= 70");
    expect(dailyScout).toContain("Do not use Firecrawl");
    expect(dailyScout).toContain("Capacity Snapshot");
    expect(dailyScout).toContain("apollo_usage");
    expect(leadReport).toContain("Capacity Snapshot");
    expect(leadReport).toContain("apollo_usage");
  });
});
