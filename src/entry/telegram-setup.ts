/**
 * Conecta el bot de Telegram con este servidor.
 *
 *   docker compose exec api node dist/src/entry/telegram-setup.js https://<tu-url-publica>
 *
 * 1) Muestra quién es el bot.
 * 2) Si todavía no hay webhook, lista quiénes le escribieron (chat id): para SANDBOX_RECIPIENTS.
 * 3) Registra el webhook <url>/webhooks/telegram con TELEGRAM_SECRET_TOKEN.
 * Sin URL, sólo hace 1 y 2 (y muestra el webhook actual).
 */
import { TelegramBotAdmin } from "../infrastructure/messaging/ChannelAdapters";
import { FetchHttpClient } from "../infrastructure/system/EventsAndHttp";

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = process.env.TELEGRAM_SECRET_TOKEN?.trim();
  if (!token) throw new Error("Falta TELEGRAM_BOT_TOKEN (lo da @BotFather). Ponelo en .env y reiniciá: docker compose up -d api");
  const bot = new TelegramBotAdmin(new FetchHttpClient(), token);

  const me = await bot.me();
  console.log(`Bot: @${me.username} (${me.first_name})`);

  const current = await bot.webhookInfo();
  if (!current.url) {
    const chats = await bot.recentChats();
    if (chats.length) {
      console.log("\nLe escribieron (chat id → poné el tuyo en SANDBOX_RECIPIENTS):");
      for (const c of chats) console.log(`  ${c.chatId}  ${c.name}  "${c.text}"`);
    } else {
      console.log(`\nNadie le escribió todavía. Mandale "hola" a @${me.username} y corré esto de nuevo para ver tu chat id.`);
    }
  } else {
    console.log(`\nWebhook actual: ${current.url} (pendientes: ${current.pending_update_count})`);
    if (current.last_error_message) console.log(`Último error de Telegram: ${current.last_error_message}`);
  }

  const base = process.argv[2]?.replace(/\/+$/, "");
  if (!base) return;
  if (!/^https:\/\//.test(base)) throw new Error("Telegram exige una URL https (usá el túnel: docker compose --profile tunel up -d tunel).");
  if (!secret || secret.length < 16) throw new Error("Falta TELEGRAM_SECRET_TOKEN (al menos 16 caracteres, letras, números, _ o -). Ponelo en .env y reiniciá la API.");
  await bot.setWebhook(`${base}/webhooks/telegram`, secret);
  console.log(`\nListo: Telegram manda los mensajes a ${base}/webhooks/telegram`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
