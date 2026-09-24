/**
 * Servidor MCP por stdio, para conectar Sin Humo a un agente de IA local
 * (por ejemplo, en la configuración de MCP de un cliente de escritorio):
 *
 *   { "command": "node", "args": ["dist/src/entry/mcp-stdio.js"],
 *     "env": { "SINHUMO_API_KEY": "sh_live_...", "DATABASE_URL": "postgres://...", "VAULT_MASTER_KEY": "..." } }
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "../infrastructure/integrations/McpServer";
import { platformFromEnv } from "./env";

async function main() {
  const { platform: p, store } = await platformFromEnv();
  const caller = await p.integrations.apiKeys.authenticate(process.env.SINHUMO_API_KEY);
  const server = buildMcpServer({ gateway: p.gateway, access: p.access, composer: p.composer, replies: p.replies, reviews: p.reviews, outlets: store.repos.outlets }, caller);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
