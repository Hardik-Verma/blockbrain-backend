const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
res.json({
status: "MineGPT backend running"
});
});

app.post("/chat", async (req, res) => {
try {
const { message } = req.body;

    const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            model: "llama-3.3-70b-versatile",
            messages: [
                {
                    role: "system",
                    content: "You are MineGPT, an advanced Minecraft AI assistant."
                },
                {
                    role: "user",
                    content: message
                }
            ]
        },
        {
            headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            }
        }
    );

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
