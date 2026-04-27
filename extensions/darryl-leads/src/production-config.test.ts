import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
    expect(renderYaml).not.toContain("FIRECRAWL_API_KEY");
  });

  it("keeps Darryl's broad newsletter flow and browser fallback in the agent guidance", () => {
    const workspace = readText("workspace/AGENTS.md");
    const newsletter = readText("workspace/skills/newsletter-parse/SKILL.md");
    const dailyScout = readText("workspace/skills/daily-scout/SKILL.md");

    expect(workspace).toContain("Firecrawl is not available");
    expect(workspace).toContain('browser` with `profile: "openclaw"');
    expect(workspace).toContain("Forwarded newsletter threshold");
    expect(newsletter).toContain("no matter the title");
    expect(newsletter).toContain("qualification_score >= 60");
    expect(newsletter).toContain('browser` with `profile: "openclaw"');
    expect(dailyScout).toContain("qualification_score >= 70");
    expect(dailyScout).toContain("Do not use Firecrawl");
  });
});
