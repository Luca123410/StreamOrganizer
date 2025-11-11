// ============================================================
// 🚀 StreamOrganizer – Entry Serverless (Vercel Ready)
// ============================================================

const express = require("express");
const fetch = require("node-fetch");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const Joi = require("joi");
const serverless = require("serverless-http");

// AbortController per Node <18
if (!global.AbortController) {
  const { AbortController } = require("abort-controller");
  global.AbortController = AbortController;
}

// ============================================================
// 🔧 Setup Express
// ============================================================
const app = express();

// ============================================================
// 🛡️ Sicurezza
// ============================================================

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", "https://api.strem.io", "https://api.github.com"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  })
);

const allowedOrigins = [
  "https://stream-organizer.vercel.app",
  "http://localhost:3000"
];

app.use(
  require("cors")({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("CORS not allowed"), false);
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ============================================================
// 🔧 Rate Limit
// ============================================================

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Troppo richieste. Riprova tra 15 minuti." },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Troppi tentativi di login. Riprova tra 15 minuti." },
});

app.use(limiter);

// ============================================================
// 🔧 Helper Functions
// ============================================================

function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const privateIPs = [/^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./];
    if (privateIPs.some((r) => r.test(parsed.hostname))) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, options, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    if (err.name === "AbortError") throw new Error("Richiesta al server scaduta (timeout).");
    throw err;
  }
}

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

// ============================================================
// 🔧 Joi Schemas
// ============================================================

const authKeySchema = Joi.object({ authKey: Joi.string().min(1).required() });
const loginSchema = Joi.object({ email: Joi.string().email().required(), password: Joi.string().min(6).required() });
const manifestUrlSchema = Joi.object({ manifestUrl: Joi.string().uri().required() });
const setAddonsSchema = Joi.object({ addons: Joi.array().min(1).required(), email: Joi.string().email().allow(null) });

// ============================================================
// 🔧 Funzioni principali
// ============================================================

async function getAddonsByAuthKey(authKey) {
  const { error } = authKeySchema.validate({ authKey });
  if (error) throw new Error("AuthKey non valido.");
  const res = await fetchWithTimeout("https://api.strem.io/api/addonCollectionGet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authKey: authKey.trim() }),
  });
  const data = await res.json();
  if (data.error || !data.result) throw new Error(data.error?.message || "Impossibile recuperare gli addon.");
  return data.result.addons || [];
}

async function getStremioData(email, password) {
  const { error } = loginSchema.validate({ email, password });
  if (error) throw new Error("Email o Password non validi.");
  const res = await fetchWithTimeout("https://api.strem.io/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  const data = await res.json();
  if (data.error || !data.result?.authKey) throw new Error(data.error?.message || "Credenziali non valide.");
  const addons = await getAddonsByAuthKey(data.result.authKey);
  return { addons, authKey: data.result.authKey };
}

// ============================================================
// 🔧 Endpoints
// ============================================================

// Login
app.post("/login", loginLimiter, async (req, res) => {
  const { email, password, authKey: providedAuthKey } = req.body;
  try {
    let data;
    if (email && password) data = await getStremioData(email, password);
    else if (providedAuthKey) data = { addons: await getAddonsByAuthKey(providedAuthKey), authKey: providedAuthKey };
    else return res.status(400).json({ error: "Email/password o authKey obbligatori." });

    res.cookie("authKey", data.authKey, cookieOptions);
    res.json({ addons: data.addons });
  } catch (err) {
    const status = err.message.includes("timeout") ? 504 : 401;
    res.status(status).json({ error: err.message });
  }
});

// Get addons
app.post("/get-addons", async (req, res) => {
  const { authKey } = req.cookies;
  if (!authKey) return res.status(401).json({ error: "authKey mancante" });

  try {
    const addons = await getAddonsByAuthKey(authKey);
    res.json({ addons });
  } catch (err) {
    res.status(err.message.includes("timeout") ? 504 : 500).json({ error: err.message });
  }
});

// Set addons
app.post("/set-addons", async (req, res) => {
  const { authKey } = req.cookies;
  if (!authKey) return res.status(401).json({ error: "authKey mancante" });

  const { error } = setAddonsSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const { addons } = req.body;
    const addonsToSave = addons.map(a => {
      const clean = JSON.parse(JSON.stringify(a));
      if (clean.isEditing) delete clean.isEditing;
      if (clean.newLocalName) delete clean.newLocalName;
      if (clean.manifest) { delete clean.manifest.newLocalName; delete clean.manifest.isEditing; }
      clean.manifest.name = a.manifest.name.trim();
      if (!clean.manifest.id) clean.manifest.id = `external-${Math.random().toString(36).substring(2,9)}`;
      return clean;
    });

    const resSet = await fetchWithTimeout("https://api.strem.io/api/addonCollectionSet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authKey: authKey.trim(), addons: addonsToSave })
    });

    const dataSet = await resSet.json();
    if (dataSet.error) throw new Error(dataSet.error.message || "Errore salvataggio addon.");
    res.json({ success: true, message: "Addon salvati con successo." });
  } catch (err) {
    res.status(err.message.includes("timeout") ? 504 : 500).json({ error: err.message });
  }
});

// Logout
app.post("/logout", (req, res) => {
  res.cookie("authKey", "", { ...cookieOptions, maxAge: 0 });
  res.json({ success: true, message: "Logout effettuato." });
});

// Catch-all 404
app.all("*", (req, res) => res.status(404).json({ error: "Endpoint non trovato" }));

// ============================================================
// ⚡ Export per Vercel Serverless
// ============================================================

module.exports = app;
module.exports.handler = serverless(app);
