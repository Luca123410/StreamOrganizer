
// ============================================================
// 🚀 StreamOrganizer – Server Index (Vercel Ready)
// Autore: Luca Drogo
// Descrizione: Entry point per l'app StreamOrganizer, con
// sicurezza avanzata, rate limiting e compatibilità Vercel.
// ============================================================

import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// ============================================================
// 🔧 Inizializzazione base
// ============================================================
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

// ============================================================
// 🛡️ Sicurezza e middleware
// ============================================================

// CORS – consente solo richieste da domini autorizzati
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

// Helmet – aggiunge intestazioni di sicurezza
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

// Rate Limiting – protegge da flood e brute force
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  limit: 100, // max 100 richieste per IP
  message: { error: "Too many requests, please try again later." },
});
app.use(limiter);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// 🌐 Routing e file statici
// ============================================================

// Percorso alla cartella frontend buildata (es. "dist" o "public")
const staticPath = path.join(__dirname, "public");
app.use(express.static(staticPath));

// API base (esempio)
app.get("/api/status", (req, res) => {
  res.json({ status: "ok", message: "StreamOrganizer server active" });
});

// Catch-all per tutte le altre route (corregge CANNOT GET)
app.get("*", (req, res) => {
  res.sendFile(path.join(staticPath, "index.html"));
});

// ============================================================
// 🚀 Avvio server
// ============================================================
app.listen(PORT, () => {
  console.log(`✅ StreamOrganizer server running on port ${PORT}`);
});

// ============================================================
// 📘 Nota finale
// ============================================================
// Important Note:
// I’m not a professional developer. Without the help of AI, I would
// never have been able to bring my ideas to life. Coding is a passion,
// and this project is the result of learning, experimenting, and improving.
// Mobile experience fully optimized: StreamOrganizer works smoothly
// on both desktop and mobile devices.
// https://stream-organizer.vercel.app/
// ============================================================
