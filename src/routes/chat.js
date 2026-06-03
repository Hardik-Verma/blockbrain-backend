import { z } from "zod";
import express from "express";
import { pool } from '../database/index.js';
import { verifyToken } from '../auth/auth.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticCachePath = path.join(__dirname, '../data/static_cache.json');
const staticCache = JSON.parse(fs.readFileSync(staticCachePath, 'utf8'));

const chatSchema = z.object({
  clientId: z.string().min(16),
  prompt: z.string().min(1).max(12000),
  model: z.string().min(1).max(200).optional(),
  maxTokens: z.number().int().min(32).max(4096).optional(),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
  messages: z.array(z.object({ text: z.string().min(1).max(12000) })).max(50).optional(),
  minecraftContext: z.object({
    minecraftVersion: z.string().optional(),
    installedMods: z.string().optional(),
    dimension: z.string().optional(),
    gameMode: z.string().optional(),
  }).optional(),
});

export function createChatRouter({ providerService, usageService, authMiddleware }) {
  const router = express.Router();

  // Try to authenticate but don't block unauthenticated requests
  const optionalAuth = (req, _res, next) => {
    const token = req.cookies?.bb_token;
    if (token) {
      try {
        const decoded = verifyToken(token, process.env.JWT_SECRET || 'dev-secret-change-in-production');
        req.user = { accountId: decoded.accountId, role: decoded.role };
      } catch {
        // Invalid token — proceed as unauthenticated
      }
    }
    next();
  };

  router.post("/", optionalAuth, async (req, res, next) => {
    const startTime = Date.now();
    try {
      const body = chatSchema.parse(req.body);

      if (body.prompt.trim().toLowerCase().includes("blockbrain cloud is loading")) {
        return res.json({ response: "", remainingFreeRequests: 999 });
      }

      // Intent Classification Layer
      const intentMatch = body.prompt.match(/(?:how to craft|recipe for|what is the durability of)\s+(.*)/i);
      if (intentMatch) {
        const item = intentMatch[1].trim().toLowerCase();
        for (const [key, value] of Object.entries(staticCache)) {
          if (item.includes(key)) {
            const stream = body.stream !== false;
            if (stream) {
              res.status(200);
              res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
              res.setHeader("Cache-Control", "no-cache, no-transform");
              res.setHeader("Connection", "keep-alive");
              
              // Emulate SSE streaming
              const chunks = value.split(' ');
              for (const word of chunks) {
                res.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(word + " ")}}}]}\n\n`);
              }
              res.write("data: [DONE]\n\n");
              res.end();
              logRequest(body.clientId, req.user?.accountId, body.prompt, startTime, 'success (cache)', body.minecraftContext);
              return;
            } else {
              logRequest(body.clientId, req.user?.accountId, body.prompt, startTime, 'success (cache)', body.minecraftContext);
              return res.json({ response: value, remainingFreeRequests: 999 });
            }
          }
        }
      }

      // Check if user is a developer (unlimited access)
      const accountResult = await pool.query('SELECT email FROM accounts WHERE minecraft_uuid = $1', [body.clientId]);
      const isDev = accountResult.rows.length > 0 && 
                   (accountResult.rows[0].email === 'hardikverma1902@gmail.com' || accountResult.rows[0].email === 'hnv.videos4@gmail.com');

      let freeTier = { allowed: true, remaining: 999 };
      if (!isDev) {
        freeTier = await usageService.consumeIfAvailable(body.clientId, 3);
        if (!freeTier.allowed) {
          return res.status(402).json({
            code: "FREE_LIMIT_REACHED",
            message: "You've used your free BlockBrain requests.",
          });
        }
      }

      const messages = buildMessages(body);
      const stream = body.stream !== false;
      const response = await providerService.chat({
        model: body.model || "llama-3.3-70b-versatile",
        messages,
        maxTokens: body.maxTokens,
        temperature: body.temperature,
        stream,
      });

      if (stream) {
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        await relayStream(response, res);
        logRequest(body.clientId, req.user?.accountId, body.prompt, startTime, 'success', body.minecraftContext);
        return;
      }

      const json = await response.json();
      const content = extractContent(json);
      logRequest(body.clientId, req.user?.accountId, body.prompt, startTime, 'success', body.minecraftContext);
      return res.json({ response: content, remainingFreeRequests: freeTier.remaining });
    } catch (error) {
      logRequest(req.body?.clientId, req.user?.accountId, req.body?.prompt, startTime, 'error', null, error.message);
      next(error);
    }
  });

  return router;
}

function logRequest(clientId, accountId, prompt, startTime, status, context, errorMessage) {
  const latencyMs = Date.now() - startTime;
  const promptPreview = (prompt || '').substring(0, 200);
  pool.query(
    `INSERT INTO request_logs(client_id, account_id, prompt_preview, latency_ms, status, error_message, context_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [clientId, accountId || null, promptPreview, latencyMs, status, errorMessage || null, context ? JSON.stringify(context) : null]
  ).catch(err => console.error('Failed to log request:', err.message));
}

function buildMessages(body) {
  const context = body.minecraftContext || {};
  const systemPrompt = [
    "You are BlockBrain, an advanced Minecraft AI assistant helping players with Minecraft-related questions.",
    "Answer naturally, clearly, and practically.",
    `Minecraft version: ${context.minecraftVersion || "unknown"}`,
    `Installed mods: ${context.installedMods || "unknown"}`,
    `Player dimension: ${context.dimension || "unknown"}`,
    `Player gamemode: ${context.gameMode || "unknown"}`,
  ].join("\n");

  const messages = [{ role: "system", content: systemPrompt }];
  for (const item of body.messages || []) {
    messages.push({ role: "user", content: item.text });
  }
  messages.push({ role: "user", content: body.prompt });
  return messages;
}

function extractContent(json) {
  const choice = json.choices?.[0];
  return choice?.message?.content || choice?.delta?.content || json.response || json.content || "";
}

async function relayStream(response, res) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content || parsed.response || "";
        if (delta) {
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
      } catch {
        if (payload) {
          res.write(`data: ${JSON.stringify({ delta: payload })}\n\n`);
        }
      }
    }
  }
  res.write("data: [DONE]\n\n");
  res.end();
}
