import { BaseProvider } from "./base.js";

export class OpenAiCompatibleProvider extends BaseProvider {
  constructor(config, secretStore, providerName) {
    super(config, secretStore);
    this.providerName = providerName;
  }

  async chat({ model, messages, maxTokens, temperature, stream }) {
    const secret = await this.getSecret(this.providerName);
    const response = await fetch(`${secret.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secret.apiKey}`,
        "Content-Type": "application/json",
        "Accept": stream ? "text/event-stream" : "application/json",
        ...(this.providerName === "openrouter"
          ? { "HTTP-Referer": "https://blockbrain.cloud", "X-Title": "BlockBrain" }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: Boolean(stream),
      }),
    });

    if (!response.ok) {
      throw new Error(`Upstream request failed with HTTP ${response.status}.`);
    }
    return response;
  }

  async models() {
    const secret = await this.getSecret(this.providerName);
    const response = await fetch(`${secret.baseUrl.replace(/\/$/, "")}/models`, {
      headers: {
        "Authorization": `Bearer ${secret.apiKey}`,
        "Accept": "application/json",
        ...(this.providerName === "openrouter"
          ? { "HTTP-Referer": "https://blockbrain.cloud", "X-Title": "BlockBrain" }
          : {}),
      },
    });
    if (!response.ok) {
      throw new Error(`Upstream model fetch failed with HTTP ${response.status}.`);
    }
    return response.json();
  }
}
