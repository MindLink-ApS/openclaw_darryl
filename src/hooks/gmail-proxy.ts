/**
 * Reverse proxy for Gmail Pub/Sub push notifications.
 *
 * On single-port deployments (e.g. Render) the gateway is the only
 * publicly reachable endpoint.  This stage forwards requests that
 * match the `gog gmail watch serve` path (default `/gmail-pubsub`)
 * to the local gog process so Google Pub/Sub push delivery works
 * without exposing a second port.
 */

import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "../config/config.js";
import {
  DEFAULT_GMAIL_SERVE_BIND,
  DEFAULT_GMAIL_SERVE_PATH,
  DEFAULT_GMAIL_SERVE_PORT,
} from "./gmail.js";

export function handleGmailPubsubProxy(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const cfg = loadConfig();
  const gmail = cfg.hooks?.gmail;

  if (!cfg.hooks?.enabled || !gmail?.account) {
    return Promise.resolve(false);
  }

  const servePath = gmail.serve?.path ?? DEFAULT_GMAIL_SERVE_PATH;
  const normalized = servePath.startsWith("/") ? servePath : `/${servePath}`;
  const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;

  if (requestPath !== normalized) {
    return Promise.resolve(false);
  }

  const targetPort = gmail.serve?.port ?? DEFAULT_GMAIL_SERVE_PORT;
  const targetHost = gmail.serve?.bind ?? DEFAULT_GMAIL_SERVE_BIND;

  return new Promise<boolean>((resolve) => {
    const proxyReq = httpRequest(
      {
        hostname: targetHost,
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
        resolve(true);
      },
    );

    proxyReq.on("error", () => {
      res.statusCode = 502;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Bad Gateway");
      resolve(true);
    });

    req.pipe(proxyReq);
  });
}
