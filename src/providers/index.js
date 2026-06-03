import { OpenAiCompatibleProvider } from "./openaiCompatible.js";

export function createProvider(config, secretStore, providerName = config.upstreamProvider) {
  return new OpenAiCompatibleProvider(config, secretStore, providerName);
}
