import dotenv from "dotenv";
import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

// Önce .env dosyasını oku, sonra .env.local dosyasını oku (override eder)
dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// CORS desteği
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Accept");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.get("/tskonutihbariagent/api/signed-url", async (req, res) => {
  try {
    let agentId = process.env.VITE_UNITE_DEFAULT_AGENT_ID;
    const apiKey = process.env.VITE_UNITE_API_KEY;

    if (!agentId || !apiKey) {
      return res.status(500).json({ error: "Agent kimlik bilgileri eksik." });
    }

    const allowedToken = req.query.token;

    const isDamageFixed = req.query.isDamageFixed === true;
    if (isDamageFixed) {
      agentId = process.env.VITE_UNITE_REPAIRED_AGENT_ID;
    } else if (isDamageFixed === false) {
      agentId = process.env.VITE_UNITE_NOT_REPAIRED_AGENT_ID;
    } else {
      agentId = process.env.VITE_UNITE_DEFAULT_AGENT_ID;
    }

    const expectedToken = process.env.VITE_ALLOWED_TOKEN;
    if (allowedToken !== expectedToken) {
      return res.status(500).json({
        error: "Yetkisiz erişim.",
      });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}&connection=webrtc`,
      { headers: { "xi-api-key": apiKey } },
    );

    if (!response.ok) {
      const details = await response.text();
      return res.status(response.status).json({
        error: "Signed URL isteği başarısız oldu.",
        details,
      });
    }

    const data = await response.json();

    if (!data?.token) {
      return res.status(500).json({
        error: "Signed URL yanıtı geçersiz.",
        details: data,
      });
    }

    res.json({ token: data.token });
  } catch (err) {
    console.error("*** Server error:", err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.use(express.static(path.join(__dirname, "dist")));

app.use((req, res, next) => {
  if (
    req.method === "GET" &&
    !req.path.startsWith("/tsmobileredirectagent/api")
  ) {
    return res.sendFile(path.join(__dirname, "dist", "index.html"));
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
