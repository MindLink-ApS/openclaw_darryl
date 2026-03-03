import type { OpenClawPluginApi, OpenClawPluginServiceContext } from "openclaw/plugin-sdk";
import { LeadsDB } from "./src/db.js";
import { createLeadsTools } from "./src/tools.js";

const plugin = {
  id: "darryl-leads",
  name: "Darryl Leads",
  description: "SQLite-backed P&C executive lead tracking",

  register(api: OpenClawPluginApi) {
    const cfg = api.pluginConfig as { dbPath?: string };
    const dbPath = api.resolvePath(cfg?.dbPath ?? "~/.openclaw/darryl/leads.db");

    // Eagerly create DB; migrations run on open
    const db = new LeadsDB(dbPath);

    for (const tool of createLeadsTools(db)) {
      api.registerTool(tool);
    }

    api.registerService({
      id: "darryl-leads-db",
      start(ctx: OpenClawPluginServiceContext) {
        ctx.logger.info(`darryl-leads: database at ${dbPath}`);
      },
      stop(ctx: OpenClawPluginServiceContext) {
        db.close();
        ctx.logger.info("darryl-leads: database closed");
      },
    });
  },
};

export default plugin;
