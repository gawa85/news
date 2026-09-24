import type { ILLMClient, LLMRequest, LLMUsage } from "./ILLMClient";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/** Implementación de ILLMClient con la API de Claude (Messages API). */
export class AnthropicLLMClient implements ILLMClient {
  constructor(private readonly config: AnthropicConfig) {}

  async completeJSON<T>(req: LLMRequest): Promise<{ data: T; usage?: LLMUsage }> {
    const res = await fetch(`${this.config.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: req.maxTokens ?? 2000,
        system: `${req.system}\nRespondé SOLO con JSON válido, sin texto adicional.`,
        messages: [{ role: "user", content: req.user }],
      }),
    });
    if (!res.ok) throw new Error(`Error de la API de IA: ${res.status} ${await res.text()}`);

    const data = (await res.json()) as { content: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number } };
    const text = data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return {
      data: JSON.parse(json) as T,
      usage: data.usage ? { model: this.config.model, inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } : undefined,
    };
  }
}
