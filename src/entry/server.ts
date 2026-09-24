/**
 * Servidor de producción: API HTTP (bots, webhooks de canales, pagos, MCP por HTTP),
 * recepción de mails por SMTP y tareas periódicas (sincronizar fuentes, medir impacto).
 *
 *   VAULT_MASTER_KEY=... DATABASE_URL=postgres://... node dist/src/entry/server.js
 */
import { httpApiDeps } from "../composition/platform";
import { createHttpApi } from "../infrastructure/http/HttpApi";
import { SmtpInboundServer } from "../infrastructure/mail/MailAdapters";
import { platformFromEnv } from "./env";

async function main() {
  const { platform: p, store, logger } = await platformFromEnv();
  const env = process.env;

  const api = createHttpApi(httpApiDeps(p, {
    secrets: {
      whatsappVerifyToken: env.WHATSAPP_VERIFY_TOKEN ?? "",
      whatsappAppSecret: env.WHATSAPP_APP_SECRET ?? "",
      telegramSecretToken: env.TELEGRAM_SECRET_TOKEN ?? "",
      paymentsSecret: env.PAYMENTS_WEBHOOK_SECRET ?? "",
    },
    metricsToken: env.METRICS_TOKEN,
  }));
  const port = Number(env.PORT ?? 8080);
  await new Promise<void>((r) => api.listen(port, r));
  console.log(`API escuchando en :${port} (base de datos: ${store.engine})`);

  let smtp: SmtpInboundServer | undefined;
  if (env.SMTP_INBOUND_PORT) {
    smtp = new SmtpInboundServer({
      host: env.SMTP_INBOUND_HOST ?? "0.0.0.0",
      port: Number(env.SMTP_INBOUND_PORT),
      acceptedDomains: (env.SMTP_ACCEPTED_DOMAINS ?? "").split(",").filter(Boolean),
      maxMessageBytes: 10_000_000,
    });
    const { port: smtpPort } = await smtp.start(async (raw) => {
      await p.content.receiveEmail.execute(raw);
    });
    console.log(`Recepción de mails por SMTP en :${smtpPort}`);
  }

  // Tareas periódicas por COLA DE TRABAJOS: persisten, se reintentan y no se duplican
  // aunque haya varios servidores. Cada servidor planifica y procesa.
  const worker = p.jobs.worker();
  let running = false;
  const loop = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await p.jobs.scheduler.tick();
      await worker.runOnce();
    } catch (e) {
      logger.error("Cola de trabajos", { error: String(e) });
    } finally {
      running = false;
    }
  }, 5_000);
  const timers = [loop];

  const shutdown = async () => {
    timers.forEach(clearInterval);
    await new Promise<void>((r) => api.close(() => r()));
    await smtp?.stop();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
