import type { OpenClawPluginApi, OpenClawPluginServiceContext } from "openclaw/plugin-sdk";
import { ApolloClient } from "./src/client.js";
import { ApolloUsageDB } from "./src/db.js";
import { createApolloTools } from "./src/tools.js";
import { createWebhookHandler } from "./src/webhook.js";

interface ApolloPluginConfig {
  apiKey?: string;
  syncMonthlyLimit?: number;
  asyncPhoneMonthlyLimit?: number;
  webhookBaseUrl?: string;
  webhookSecret?: string;
  dataDir?: string;
  leadsDbPath?: string;
}

const plugin = {
  id: "darryl-apollo",
  name: "Darryl Apollo",
  description:
    "Apollo.io enrichment for P&C executive leads — email + phone with hybrid sync/async",

  register(api: OpenClawPluginApi) {
    const cfg = api.pluginConfig as ApolloPluginConfig;

    // ---- Resolve config ----

    const apiKey = cfg?.apiKey;
    if (!apiKey) {
      console.warn("darryl-apollo: no apiKey configured, plugin disabled");
      return;
    }

    const syncLimitDefault = cfg?.syncMonthlyLimit ?? 100;
    const asyncPhoneLimitDefault = cfg?.asyncPhoneMonthlyLimit ?? 50;
    const webhookSecret = cfg?.webhookSecret;
    const webhookBaseUrl = cfg?.webhookBaseUrl;
    const dataDir = api.resolvePath(cfg?.dataDir ?? "~/.openclaw/darryl/apollo");
    const leadsDbPath = api.resolvePath(cfg?.leadsDbPath ?? "~/.openclaw/darryl/leads.db");

    // ---- Build webhook URL ----

    let webhookUrl: string | undefined;
    if (webhookBaseUrl && webhookSecret) {
      webhookUrl = `${webhookBaseUrl}/apollo-phone-webhook/${webhookSecret}`;
    }

    // ---- Initialize DB + client ----

    const dbPath = `${dataDir}/apollo.db`;
    const db = new ApolloUsageDB(dbPath);
    const client = new ApolloClient(apiKey, webhookUrl);

    // ---- Register tools ----

    for (const tool of createApolloTools({
      db,
      client,
      syncLimitDefault,
      asyncPhoneLimitDefault,
    })) {
      api.registerTool(tool);
    }

    // ---- Register webhook HTTP route ----

    if (webhookSecret) {
      const webhookPath = `/apollo-phone-webhook/${webhookSecret}`;
      const handler = createWebhookHandler({
        db,
        leadsDbPath,
      });

      api.registerHttpRoute({
        path: webhookPath,
        auth: "plugin", // Custom auth via secret URL path — no gateway auth needed
        match: "exact",
        handler,
      });
    }

    // ---- Register service lifecycle ----

    api.registerService({
      id: "darryl-apollo-db",
      start(ctx: OpenClawPluginServiceContext) {
        ctx.logger.info(
          `darryl-apollo: database at ${dbPath}, webhook ${webhookUrl ? "enabled" : "disabled"}`,
        );
      },
      stop(ctx: OpenClawPluginServiceContext) {
        db.close();
        ctx.logger.info("darryl-apollo: database closed");
      },
    });
  },
};

export default plugin;
