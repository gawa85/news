/**
 * Mail de punta a punta con un servidor SMTP REAL (smtp-server) y un cliente real (nodemailer):
 * el usuario reenvía un mail → se analiza → se responde EN EL MISMO HILO.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import nodemailer from "nodemailer";
import { SmtpInboundServer } from "../src/infrastructure/mail/MailAdapters";
import { testPlatform } from "./helpers/platform";

describe("Mail por SMTP", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let server: SmtpInboundServer;
  let port: number;
  const processed: { status: string; reason?: string }[] = [];
  let waiters: (() => void)[] = [];

  before(async () => {
    t = await testPlatform();
    server = new SmtpInboundServer({ host: "127.0.0.1", port: 0, acceptedDomains: ["sinhumo.example"], maxMessageBytes: 2_000_000 });
    ({ port } = await server.start(async (raw) => {
      processed.push(await t.p.content.receiveEmail.execute(raw));
      waiters.splice(0).forEach((w) => w());
    }));
  });
  after(() => server.stop());

  const client = () => nodemailer.createTransport({ host: "127.0.0.1", port, secure: false, ignoreTLS: true });
  const nextProcessed = () => new Promise<void>((r) => waiters.push(r));

  test("mail reenviado de un remitente autenticado → análisis → respuesta en el mismo hilo", async () => {
    const done = nextProcessed();
    await client().sendMail({
      from: "Ana Gómez <ana@correo.example>",
      to: "analizar@sinhumo.example",
      subject: "Fwd: URGENTE lo que no te cuentan",
      messageId: "<original-1@correo.example>",
      headers: { "Authentication-Results": "mx.sinhumo.example; spf=pass smtp.mailfrom=correo.example; dkim=pass header.d=correo.example; dmarc=pass" },
      text: [
        "Mirá esto que me llegó.",
        "",
        "---------- Forwarded message ---------",
        "From: Cadena Informativa <avisos@cadena.example>",
        "Date: lun, 21 sept 2026",
        "",
        "URGENTE: según fuentes cercanas habrá un colapso histórico del sistema eléctrico. Sube 300% la luz mañana. Más info en https://bit.ly/abc123",
      ].join("\n"),
    });
    await done;

    assert.equal(processed.at(-1)!.status, "answered");
    const reply = t.mail.sent.at(-1)!;
    assert.equal(reply.to, "ana@correo.example");
    assert.equal(reply.inReplyTo, "<original-1@correo.example>");
    assert.equal(reply.subject, "Re: URGENTE lo que no te cuentan");
    assert.match(reply.text, /Índice de humo/);
    assert.match(reply.text, /Remitente verificado/);
    assert.match(reply.text, /Cadena Informativa/, "detecta el autor original del reenvío");
    assert.match(reply.text, /Links acortados/);
    assert.ok(reply.html?.includes("<h2"), "el mail va con versión HTML");

    const user = await t.store.repos.users.findByChannel("email", "ana@correo.example");
    assert.equal(user?.channels[0]?.verified, true, "SPF/DKIM probaron que la dirección es suya");
  });

  test("remitente NO autenticado (encabezado falso de otro servidor) → no se responde (evita backscatter)", async () => {
    const before = t.mail.sent.length;
    const done = nextProcessed();
    await client().sendMail({
      from: "impostor@banco.example",
      to: "analizar@sinhumo.example",
      subject: "hola",
      headers: { "Authentication-Results": "servidor-falso.example; spf=pass; dkim=pass; dmarc=pass" },
      text: "Texto cualquiera con un dato: 50%.",
    });
    await done;
    assert.deepEqual(processed.at(-1), { status: "ignored", reason: "remitente no autenticado" });
    assert.equal(t.mail.sent.length, before);
  });

  test("no acepta mails para otros dominios (no es un relay abierto)", async () => {
    await assert.rejects(client().sendMail({ from: "a@b.example", to: "alguien@otro.example", subject: "x", text: "x" }), /550/);
  });
});
