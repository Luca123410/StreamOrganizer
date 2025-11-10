const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
app.set('trust proxy', 1); // necessario per Vercel

const PORT = process.env.PORT || 7860;

// --- Chiavi segrete ---
const MONITOR_KEY_SECRET = process.env.MONITOR_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// --- Costanti API Stremio ---
const STREMIO_API_BASE = 'https://api.strem.io/api/';
const LOGIN_API_URL = `${STREMIO_API_BASE}login`;
const ADDONS_GET_URL = `${STREMIO_API_BASE}addonCollectionGet`;
const ADDONS_SET_URL = `${STREMIO_API_BASE}addonCollectionSet`;

const FETCH_TIMEOUT = 10000;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helper ---
async function fetchWithTimeout(url, options, timeout = FETCH_TIMEOUT) {
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

async function getAddonsByAuthKey(authKey) {
  if (!authKey) throw new Error("AuthKey mancante.");

  const response = await fetchWithTimeout(ADDONS_GET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey })
  });

  const data = await response.json();
  if (data.error || !data.result) {
    let msg = data.error?.message || 'Impossibile recuperare gli addon.';
    if (msg.includes('Invalid AuthKey') || (data.error && data.error.code === 1010)) {
      msg = "AuthKey non valido o scaduto.";
    }
    throw new Error(msg);
  }

  return data.result.addons || [];
}

async function getStremioData(email, password) {
  if (!email || !password) throw new Error("Email o Password mancanti.");

  const loginResponse = await fetchWithTimeout(LOGIN_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const loginData = await loginResponse.json();
  if (!loginData.result?.authKey) {
    throw new Error(loginData.error?.message || 'Credenziali non valide o accesso negato da Stremio.');
  }

  const authKey = loginData.result.authKey;
  const addons = await getAddonsByAuthKey(authKey);
  return { addons, authKey };
}

// --- Endpoint ---
app.post('/api/login', async (req, res) => {
  const { email, password, authKey: providedAuthKey } = req.body;

  try {
    if (email && password) {
      const data = await getStremioData(email, password);
      return res.json(data);
    }

    if (providedAuthKey) {
      const addons = await getAddonsByAuthKey(providedAuthKey);
      return res.json({ addons, authKey: providedAuthKey });
    }

    return res.status(400).json({ error: { message: "Email/password o authKey sono obbligatori." } });
  } catch (err) {
    const status = err.message.includes('timeout') ? 504 : 401;
    return res.status(status).json({ error: { message: err.message } });
  }
});

app.post('/api/get-addons', async (req, res) => {
  const { authKey, email } = req.body;
  if (!authKey || !email) return res.status(400).json({ error: { message: "authKey e email sono obbligatori." } });

  try {
    const addons = await getAddonsByAuthKey(authKey);
    res.json({ addons });
  } catch (err) {
    const status = err.message.includes('timeout') ? 504 : 500;
    res.status(status).json({ error: { message: "Errore durante il recupero degli addon: " + err.message } });
  }
});

app.post('/api/admin/monitor', async (req, res) => {
  const { adminKey, targetEmail } = req.body;

  if (!MONITOR_KEY_SECRET || adminKey !== MONITOR_KEY_SECRET) {
    return res.status(401).json({ error: { message: "Chiave di monitoraggio non corretta." } });
  }

  if (!targetEmail) {
    return res.status(400).json({ error: { message: "È necessaria l'email dell'utente da monitorare." } });
  }

  return res.status(403).json({ error: { message: `Impossibile accedere ai dati di ${targetEmail}. Per motivi di sicurezza Stremio richiede la password/AuthKey.` } });
});

app.post('/api/set-addons', async (req, res) => {
  try {
    const { authKey, addons } = req.body;
    if (!authKey || !addons) return res.status(400).json({ error: { message: "Chiave di autenticazione o lista addon mancante." } });

    const addonsToSave = addons.map(addon => {
      const clean = JSON.parse(JSON.stringify(addon));
      if (clean.isEditing) delete clean.isEditing;
      if (clean.newLocalName) delete clean.newLocalName;
      if (clean.manifest) {
        delete clean.manifest.newLocalName;
        delete clean.manifest.isEditing;
      }
      clean.manifest.name = addon.manifest.name;
      if (!clean.manifest.id) clean.manifest.id = `external-${Math.random().toString(36).substring(2, 9)}`;
      return clean;
    });

    const setResponse = await fetchWithTimeout(ADDONS_SET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authKey, addons: addonsToSave })
    });

    const setData = await setResponse.json();
    if (setData.error) throw new Error(setData.error.message || 'Errore Stremio durante il salvataggio.');

    res.json({ success: true, message: "Addon salvati con successo." });
  } catch (err) {
    const status = err.message.includes('timeout') ? 504 : 500;
    res.status(status).json({ error: { message: err.message } });
  }
});

app.post('/api/fetch-manifest', async (req, res) => {
  const { manifestUrl } = req.body;
  if (!manifestUrl || !manifestUrl.startsWith('http')) return res.status(400).json({ error: { message: "URL manifesto non valido." } });

  try {
    const headers = {};
    if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;
    const response = await fetchWithTimeout(manifestUrl, { headers });

    if (!response.ok) {
      const txt = await response.text();
      if (txt.trim().startsWith('<!DOCTYPE html>')) throw new Error("Blocco di sicurezza: Pagina HTML invece di JSON.");
      throw new Error(`Impossibile raggiungere il manifesto: Status ${response.status}`);
    }

    const manifest = await response.json();
    if (!manifest.id || !manifest.version) throw new Error("Manifesto non valido: mancano ID o Versione.");

    res.json(manifest);
  } catch (err) {
    const status = err.message.includes('timeout') ? 504 : 500;
    res.status(status).json({ error: { message: "Errore nel recupero del manifesto: " + err.message } });
  }
});

// --- Avvio solo su Docker/Node ---
if (process.env.NODE_ENV !== 'vercel') {
  app.listen(PORT, () => {
    console.log(`Server avviato sulla porta ${PORT}`);
  });
}

// --- Esportazione per Vercel ---
module.exports = app;
