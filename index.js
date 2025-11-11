// ============================================================
// 🚀 StreamOrganizer – API Entry (Vercel Ready Serverless)
// Autore: Luca Drogo
// ============================================================

import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import serverless from "serverless-http";

// ============================================================
// 🔧 Setup Express
// ============================================================
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 🛡️ Sicurezza e middleware
// ============================================================

const allowedOrigins = [
  "https://stream-organizer.vercel.app",
  "http://localhost:3000"
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS not allowed"));
      }
    },
    credentials: true,
  })
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://vercel.live"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "https://api.themoviedb.org"],
        objectSrc: ["'none'"],
      },
    },
  })
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  message: { error: "Too many requests, please try again later." },
});
app.use(limiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// 🌐 Routing
// ============================================================

app.get("/api/status", (req, res) => {
  res.json({ status: "ok", message: "StreamOrganizer API active" });
});

// Catch-all per richieste non gestite
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

// ============================================================
// 🧠 Esportazione per Vercel
// ============================================================
export const handler = serverless(app);
export default app;
