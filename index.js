const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

// AbortController per Node <18
if (!global.AbortController) {
  const { AbortController } = require('abort-controller');
  global.AbortController = AbortController;
}

const app = express();
const PORT = process.env.PORT || 7860;

// --- TRUST PROXY (Hugging Face/Docker) ---
app.set('trust proxy', 1);

// --- Sicurezza: Helmet con CSP ---
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "'unsafe-eval'", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "connect-src": [
          "'self'",
          "https://api.strem.io",
          "https://api.github.com",
          "https://fonts.googleapis.com",
          "https://fonts.gstatic.com",
          "https://unpkg.com",
          "https://cdnjs.cloudflare.com",
          "https://huggingface.co",
          "https://luca12234345-stremorganizer.hf.space"
        ],
        "img-src": ["'self'", "data:", "https:"]
      },
    },
  })
);

// --- Rate limit ---
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 100,
  message: { error: { message: 'Troppo richieste. Riprova tra 15 minuti.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.LOGIN_RATE_LIMIT_MAX || 20,
  message: { error: { message: 'Troppi tentativi di login. Riprova tra 15 minuti.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- CORS ---
const allowedOrigins = [
  'https://luca12234345-stremorganizer.hf.space',
  'http://localhost:7860'
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) return callback(new Error('La policy CORS non permette l\'accesso da questa origine.'), false);
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.static('public'));
app.use(express.json());
app.use(cookieParser());
app.use('/api/', limiter);
app.use('/api/login', loginLimiter);

// --- Helper ---
function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const privateIPs = [/^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./];
    if (privateIPs.some(regex => regex.test(parsed.hostname))) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, options, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') throw new Error('Richiesta al server scaduta (timeout).');
    throw err;
  }
}

// --- Cookie ---
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000
};

// --- Schemi Joi ---
const authKeySchema = Joi.object({ authKey: Joi.string().min(1).required() });
const loginSchema = Joi.object({ email: Joi.string().email().required(), password: Joi.string().min(6).required() });
const manifestUrlSchema = Joi.object({ manifestUrl: Joi.string().uri().required() });
const addonUrlSchema = Joi.object({ addonUrl: Joi.string().uri().required() });
const githubUrlSchema = Joi.object({ repoUrl: Joi.string().uri({ scheme: 'https' }).required() });
const setAddonsSchema = Joi.object({ addons: Joi.array().min(1).required(), email: Joi.string().email().allow(null) });

// --- Funzioni principali ---
async function getAddonsByAuthKey(authKey) {
  const { error } = authKeySchema.validate({ authKey });
  if (error) throw new Error("AuthKey non valido.");
  const res = await fetchWithTimeout('https://api.strem.io/api/addonCollectionGet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: authKey.trim() })
  });
  const data = await res.json().catch(() => null);
  if (!data || data.error || !data.result) throw new Error(data?.error?.message || 'Impossibile recuperare gli addon.');
  return data.result.addons || [];
}

// --- LOGIN ---
app.post('/api/login', async (req, res) => {
  try {
    const { email, password, authKey: providedAuthKey } = req.body;

    let authKey, addons;

    if (email && password) {
      // Login Stremio
      const response = await fetch('https://api.strem.io/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'StremioAddonManager/1.0' },
        body: JSON.stringify({ email: email.trim(), password })
      });

      const data = await response.json().catch(() => null);
      if (!data || !data.result || !data.result.authKey) {
        const msg = data?.error?.message || `Errore login Stremio: ${response.status}`;
        return res.status(401).json({ error: { message: msg } });
      }
      authKey = data.result.authKey;
      addons = await getAddonsByAuthKey(authKey);

    } else if (providedAuthKey) {
      // Login con AuthKey
      const { error } = authKeySchema.validate({ authKey: providedAuthKey });
      if (error) throw new Error("AuthKey fornita non valida.");
      authKey = providedAuthKey;
      addons = await getAddonsByAuthKey(authKey);

    } else {
      return res.status(400).json({ error: { message: "Email/password o authKey obbligatori." } });
    }

    // Salva cookie
    res.cookie('authKey', authKey, cookieOptions);

    return res.json({ addons });

  } catch (err) {
    const status = err.message.includes('timeout') ? 504 : 500;
    return res.status(status).json({ error: { message: err.message } });
  }
});

// --- GET ADDONS ---
app.post('/api/get-addons', async (req, res) => {
  const { authKey } = req.cookies;
  if (!authKey) return res.status(401).json({ error: { message: "AuthKey mancante nel cookie." } });

  try {
    const addons = await getAddonsByAuthKey(authKey);
    res.json({ addons });
  } catch (err) {
    res.status(err.message.includes('timeout') ? 504 : 500).json({ error: { message: err.message } });
  }
});

// --- SET ADDONS ---
app.post('/api/set-addons', async (req, res) => {
  const { authKey } = req.cookies;
  if (!authKey) return res.status(401).json({ error: { message: "AuthKey mancante nel cookie." } });

  const { error } = setAddonsSchema.validate(req.body);
  if (error) return res.status(400).json({ error: { message: error.details[0].message } });

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

    const resSet = await fetchWithTimeout('https://api.strem.io/api/addonCollectionSet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authKey: authKey.trim(), addons: addonsToSave })
    });

    const dataSet = await resSet.json().catch(() => null);
    if (!dataSet || dataSet.error) throw new Error(dataSet?.error?.message || 'Errore salvataggio addon.');

    res.json({ success: true, message: "Addon salvati con successo." });

  } catch (err) {
    res.status(err.message.includes('timeout') ? 504 : 500).json({ error: { message: err.message } });
  }
});

// --- FETCH MANIFEST ---
app.post('/api/fetch-manifest', async (req, res) => {
  const { error } = manifestUrlSchema.validate(req.body);
  if (error) return res.status(400).json({ error: { message: "URL manifesto non valido." } });

  const { manifestUrl } = req.body;
  if (!isSafeUrl(manifestUrl)) return res.status(400).json({ error: { message: 'URL non sicuro o non valido.' } });

  try {
    const resp = await fetchWithTimeout(manifestUrl);
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    const manifest = await resp.json().catch(() => null);
    if (!manifest || !manifest.id || !manifest.version) throw new Error("Manifesto non valido.");
    res.json(manifest);
  } catch (err) {
    res.status(err.message.includes('timeout') ? 504 : 500).json({ error: { message: err.message } });
  }
});

// --- CHECK HEALTH ---
app.post('/api/check-health', async (req, res) => {
  const { error } = addonUrlSchema.validate(req.body);
  if (error) return res.json({ status: 'error', details: 'URL non valido' });

  const { addonUrl } = req.body;
  if (!isSafeUrl(addonUrl)) return res.json({ status: 'error', details: 'URL non sicuro o non valido' });

  try { 
    await fetchWithTimeout(addonUrl); 
    res.json({ status: 'ok' }); 
  } catch (err) { 
    res.json({ status: 'error', details: err.message }); 
  }
});

// --- GITHUB INFO ---
app.post('/api/github-info', async (req, res) => {
  const { error } = githubUrlSchema.validate(req.body);
  if (error) return res.status(400).json({ error: 'URL repository mancante o non valido' });

  const { repoUrl } = req.body;
  try {
    const url = new URL(repoUrl);
    if (url.hostname !== 'github.com') throw new Error('URL non valido');

    const path = url.pathname.replace(/^\/|\/$/g, '');
    if (!path || path.split('/').length !== 2) throw new Error('Formato repository non valido');

    const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'StremioAddonManager/1.0' };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;

    const repoRes = await fetch(`https://api.github.com/repos/${path}`, { headers });
    if (!repoRes.ok) throw new Error(`Errore API GitHub: ${repoRes.status}`);

    const data = await repoRes.json().catch(() => null);
    res.json({ info: { stars: data.stargazers_count, forks: data.forks_count, issues: data.open_issues_count, url: data.html_url } });

  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- LOGOUT ---
app.post('/api/logout', (req, res) => {
  res.cookie('authKey', '', { ...cookieOptions, maxAge: 0 });
  res.json({ success: true, message: "Logout effettuato." });
});

// --- HTTPS FORZATO PRODUZIONE ---
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// --- 404 ---
app.use('/api/*', (req, res) => res.status(404).json({ error: { message: 'Endpoint non trovato.' } }));

// --- Avvio server ---
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
  if (process.env.NODE_ENV==='production') console.log('Modalità produzione: HTTPS forzato attivo.');
});
