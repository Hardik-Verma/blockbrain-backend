const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const USAGE_FILE = path.join(__dirname, "usage.json");

function getUsage(uuid) {
    if (!fs.existsSync(USAGE_FILE)) {
        return 0;
    }
    try {
        const data = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
        return data[uuid] || 0;
    } catch (e) {
        return 0;
    }
}

function incrementUsage(uuid) {
    let data = {};
    if (fs.existsSync(USAGE_FILE)) {
        try {
            data = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
        } catch (e) {
            data = {};
        }
    }
    data[uuid] = (data[uuid] || 0) + 1;
    try {
        fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
        console.error("Failed to write usage file:", e);
    }
}

function isDevPasscode(passcode) {
    if (!passcode) return false;
    const trimmed = passcode.trim();
    if (trimmed.toUpperCase() === "MINEGPT_DEV_UNLIMITED" || trimmed.toUpperCase() === "DEV_UNLIMITED_2026") {
        return true;
    }
    // Verify SHA-256 hashes for cryptographic uncrackability
    const hash = crypto.createHash("sha256").update(trimmed).digest("hex");
    if (hash === "9018e6922d9b2326b5c39cb5c5dfb5a4b7ffb5f0dc91f32a76db20202d5efbfb" ||
        hash === "2e6f4776b2512f71661605f63d04fcaeb4ba509426f43de9c1626fdbcc474f8a") {
        return true;
    }
    if (process.env.DEV_PASSCODE && trimmed === process.env.DEV_PASSCODE) {
        return true;
    }
    return false;
}

app.get("/", (req, res) => {
    res.json({
        status: "MineGPT backend running"
    });
});

app.get("/health", (req, res) => {
    res.status(200).send("OK");
});

app.get("/models", (req, res) => {
    res.json({
        models: [
            { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Default)" }
        ]
    });
});

app.post("/chat", async (req, res) => {
    try {
        const playerUuid = req.header("X-MineGPT-Player-UUID") || "default-player";
        const passcode = req.header("X-MineGPT-Passcode") || "";

        const isDev = isDevPasscode(passcode);

        if (!isDev) {
            const usage = getUsage(playerUuid);
            if (usage >= 3) {
                return res.status(403).json({
                    code: "FREE_LIMIT_REACHED",
                    message: "You've used your free MineGPT requests. Please upgrade or configure a Custom API key in Settings."
                });
            }
        }

        const { message, messages } = req.body;
        let apiMessages = [];

        if (messages && Array.isArray(messages)) {
            apiMessages = messages;
        } else {
            apiMessages = [
                {
                    role: "system",
                    content: "You are MineGPT, an advanced Minecraft AI assistant."
                },
                {
                    role: "user",
                    content: message || ""
                }
            ];
        }

        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                messages: apiMessages
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        if (!isDev && playerUuid !== "default-player") {
            incrementUsage(playerUuid);
        }

        res.json({
            response: response.data.choices[0].message.content
        });

    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({
            error: "AI request failed"
        });
    }
});

app.listen(PORT, () => {
    console.log(`MineGPT backend running on port ${PORT}`);
});
