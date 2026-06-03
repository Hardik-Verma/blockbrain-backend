import express from "express";

export function createVersionRouter(config) {
  const router = express.Router();

  router.get("/", (_req, res) => {
    res.json({
      latestVersion: config.version,
      downloadUrl: config.downloadUrl,
      changelog: config.changelog,
    });
  });

  return router;
}
