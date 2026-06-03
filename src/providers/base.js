export class BaseProvider {
  constructor(config, secretStore) {
    this.config = config;
    this.secretStore = secretStore;
  }

  async chat() {
    throw new Error("Not implemented");
  }

  async models() {
    throw new Error("Not implemented");
  }

  async getSecret(providerName) {
    const row = await this.secretStore.getProviderSecret(providerName);
    if (!row) {
      throw new Error(`No API key configured for ${providerName}.`);
    }
    return row;
  }
}
