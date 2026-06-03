import express from "express";

export function createModelsRouter({ providerService }) {
  const router = express.Router();

  router.get("/", async (req, res, next) => {
    try {
      const json = await providerService.models();
      const models = normalizeModels(json);
      res.json({ models });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function normalizeModels(json) {
  const data = json.data || json.models || [];
  return data.map((model) => ({
    id: model.id || model.name,
    label: model.name || model.id || "Unknown model",
  }));
}
