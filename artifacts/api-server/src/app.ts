import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { fileURLToPath } from "node:url";
import { processWhopWebhook } from "./lib/billing-runtime";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors());
app.disable("x-powered-by");
app.post("/api/whop/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  if (!req.get("webhook-signature") || !Buffer.isBuffer(req.body)) { res.status(400).json({ error: "invalid_webhook" }); return; }
  try {
    const headers = Object.fromEntries(Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    await processWhopWebhook(req.body, headers);
    res.json({ received: true });
  } catch {
    req.log.warn({ code: "whop_webhook_rejected" }, "Whop webhook not accepted");
    res.status(400).json({ error: "invalid_webhook" });
  }
});
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
const emailSessionMiddleware = clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? "", process.env.CLERK_PUBLISHABLE_KEY),
}));
app.use((req, res, next) => {
  // Native Telegram proof and calendar OAuth state remain independent of email sessions.
  if (req.path === "/api/mini-app/calendar/callback"
    || (req.headers.authorization?.startsWith("tma ") && /^\/api\/(?:mini-app|tasks)(?:\/|$)/.test(req.path))) return next();
  return emailSessionMiddleware(req, res, next);
});

// This source module and the production bundle are each one level below public/.
const homePage = fileURLToPath(new URL("../public/index.html", import.meta.url));
app.get("/", (_request, response, next) => {
  response.sendFile(homePage, { headers: { "Cache-Control": "no-cache" } }, error => {
    if (error) next(error);
  });
});
app.get(/^\/sign-(in|up)(\/.*)?$/, (_req, res) => {
  res.sendFile(fileURLToPath(new URL("../public/auth.html", import.meta.url)), { headers: { "Cache-Control": "no-store" } });
});

app.use("/api", router);
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url)), { index: false, maxAge: 0 }));

const handleError: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) return next(error);
  const status = error?.type === "entity.too.large" ? 413
    : error instanceof SyntaxError ? 400 : 500;
  logger.error({ status }, "Request failed");
  response.status(status).json({ ok: false, error: status < 500 ? "invalid_request" : "server_error" });
};
app.use(handleError);

export default app;
