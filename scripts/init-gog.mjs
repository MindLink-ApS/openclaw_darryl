#!/usr/bin/env node
// Provision gogcli credentials from environment variables, then start the gateway.
// This replaces the bash init script because Render only captures Node process output.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const configDir = join(process.env.XDG_CONFIG_HOME || "/data/.config", "gogcli");
const keyringDir = join(configDir, "keyring");

const clientId = process.env.GOG_OAUTH_CLIENT_ID || "";
const clientSecret = process.env.GOG_OAUTH_CLIENT_SECRET || "";

console.log("[init-gog] env check:", {
  GOG_OAUTH_CLIENT_ID: clientId ? "set" : "MISSING",
  GOG_OAUTH_CLIENT_SECRET: clientSecret ? "set" : "MISSING",
  GOG_KEYRING_TOKEN_EMMA: process.env.GOG_KEYRING_TOKEN_EMMA ? "set" : "MISSING",
  GOG_KEYRING_TOKEN_EMMA_DEFAULT: process.env.GOG_KEYRING_TOKEN_EMMA_DEFAULT ? "set" : "MISSING",
  GOG_KEYRING_PASSWORD: process.env.GOG_KEYRING_PASSWORD ? "set" : "MISSING",
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || "(default)",
  configDir,
});

if (clientId && clientSecret) {
  mkdirSync(keyringDir, { recursive: true });

  writeFileSync(
    join(configDir, "credentials.json"),
    JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  );
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify({ keyring_backend: process.env.GOG_KEYRING_BACKEND || "file" }),
  );

  if (process.env.GOG_KEYRING_TOKEN_EMMA) {
    writeFileSync(
      join(keyringDir, "token:assistant.emmajones@gmail.com"),
      process.env.GOG_KEYRING_TOKEN_EMMA,
    );
  }
  if (process.env.GOG_KEYRING_TOKEN_EMMA_DEFAULT) {
    writeFileSync(
      join(keyringDir, "token:default:assistant.emmajones@gmail.com"),
      process.env.GOG_KEYRING_TOKEN_EMMA_DEFAULT,
    );
  }

  try {
    chmodSync(configDir, 0o700);
  } catch {}
  try {
    chmodSync(keyringDir, 0o700);
  } catch {}

  console.log("[init-gog] credentials provisioned at", configDir);

  // Bootstrap Gmail watch state
  if (process.env.EMMA_GMAIL_ADDRESS) {
    try {
      execFileSync(
        "gog",
        [
          "gmail",
          "watch",
          "start",
          "--account",
          process.env.EMMA_GMAIL_ADDRESS,
          "--label",
          "INBOX",
          "--topic",
          "projects/mail-project-489210/topics/gmail-watch-emma",
          "--no-input",
        ],
        { stdio: "inherit", timeout: 15_000 },
      );
      console.log("[init-gog] gmail watch started");
    } catch (e) {
      console.log("[init-gog] gmail watch start failed:", e.message);
    }
  }
} else {
  console.log("[init-gog] skipping — OAuth credentials not set");
}
