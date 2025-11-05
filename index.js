const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
// 'fs' e 'LOG_FILE' sono stati rimossi

const app = express();
const PORT = process.env.PORT || 7860;

// Chiave segreta caricata da Hugging Face Secrets
const MONITOR_KEY_SECRET = process.env.MONITOR_KEY;

// Configurazione server
app.use(express.static('public'));
app.use(cors());
app.use(express.json());

// --- Funzioni di Log su File RIMOSSE ---

// --- NUOVA FUNZIONE HELPER: RECUPERA ADDON DA AUTHKEY ---
// (Questa funzione è necessaria sia per il login con token che per /api/get-addons)
async function getAddonsByAuthKey(authKey) {
  if (!authKey) {
    throw new Error("AuthKey mancante.");
  }
  
  const STREMIO_API_BASE = 'https://api.strem.io/';
  const ADDONS_GET_URL = `${STREMIO_API_BASE}api/addonCollectionGet`;

  try {
    const addonsResponse = await fetch(ADDONS_GET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        "authKey": authKey
      })
    });

    const addonsData = await addonsResponse.json();

    if (addonsData.error || !addonsData.result) {
      let errorMsg = addonsData.error?.message || 'Impossibile recuperare gli addon con questo AuthKey.';
      // Errore specifico se l'authKey non è valido o scaduto
      if (errorMsg.includes('Invalid AuthKey') || (addonsData.error && addonsData.error.code === 1010)) {
          errorMsg = "AuthKey non valido o scaduto.";
      }
      throw new Error(errorMsg);
    }

    return addonsData.result.addons || [];

  } catch (err) {
    throw err;
  }
}

// --- FUNZIONE CENTRALE PER RECUPERARE DATI STREMIO (Login Email/Pass) ---
async function getStremioData(email, password) {
  if (!email || !password) {
    throw new Error("Email o Password mancanti.");
  }

  const STREMIO_API_BASE = 'https://api.strem.io/';
  const LOGIN_API_URL = `${STREMIO_API_BASE}api/login`;
  
  try {
    // 1. LOGIN (Formato body corretto)
    const loginResponse = await fetch(LOGIN_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        "email": email,
        "password": password
      })
    });

    const loginData = await loginResponse.json();
    if (loginData.error || !loginData.result || !loginData.result.authKey) {
      throw new Error(loginData.error ? loginData.error.message : 'Credenziali non valide o accesso negato da Stremio.');
    }

    const authKey = loginData.result.authKey;

    // 2. RECUPERO ADDONS (usando la nuova funzione helper)
    const finalAddons = await getAddonsByAuthKey(authKey);
    
    return { addons: finalAddons, authKey: authKey };

  } catch (err) {
    throw err;
  }
}

// ------------------------------------------
// 1. ENDPOINT STANDARD LOGIN (MODIFICATO per accettare AuthKey)
// ------------------------------------------
app.post('/api/login', async (req, res) => {
  // Accetta email/password OPPURE authKey
  const { email, password, authKey: providedAuthKey } = req.body;

  // CASO 1: Login con Email/Password
  if (email && password) {
    try {
      const data = await getStremioData(email, password); // Logga E recupera addon
      res.json(data);
    } catch (err) {
      res.status(401).json({ error: { message: err.message } });
    }
    return; // Fine
  }

  // CASO 2: Login con AuthKey (Token)
  if (providedAuthKey) {
    try {
      // Verifica l'authKey e recupera gli addon
      const addons = await getAddonsByAuthKey(providedAuthKey); 
      
      // Se ha successo, restituisce lo stesso formato del login normale
      // (l'email è usata solo dal frontend, qui restituiamo solo il necessario)
      res.json({ addons: addons, authKey: providedAuthKey });
    } catch (err) {
      // L'errore (es. AuthKey scaduto) viene gestito qui
      res.status(401).json({ error: { message: err.message } });
    }
    return; // Fine
  }

  // CASO 3: Dati mancanti (Questo è l'errore che ricevi ora)
  return res.status(400).json({ error: { message: "Email/password o authKey sono obbligatori." } });
});


// ------------------------------------------
// 2. ENDPOINT: RECUPERA ADDONS (AGGIORNATO con funzione helper)
// ------------------------------------------
app.post('/api/get-addons', async (req, res) => {
  const { authKey, email } = req.body;

  if (!authKey || !email) {
    return res.status(400).json({ error: { message: "authKey e email sono obbligatori." } });
  }

  try {
    // Usa la nuova funzione helper
    const finalAddons = await getAddonsByAuthKey(authKey);
    res.json({ addons: finalAddons });

  } catch (err) {
    // La funzione helper lancia un errore, lo catturiamo
    res.status(500).json({ error: { message: "Errore durante il recupero degli addon: " + err.message } });
  }
});

// ------------------------------------------
// 3. ENDPOINT ADMIN/MONITORAGGIO (INVARIATO)
// ------------------------------------------
app.post('/api/admin/monitor', async (req, res) => {
  const { adminKey, targetEmail } = req.body;

  if (!MONITOR_KEY_SECRET || adminKey !== MONITOR_KEY_SECRET) {
    return res.status(401).json({ error: { message: "Chiave di monitoraggio non corretta." } });
  }

  if (!targetEmail) {
    return res.status(400).json({ error: { message: "È necessaria l'email dell'utente da monitorare." } });
  }

  try {
    return res.status(403).json({ error: { message: `Impossibile accedere ai dati di ${targetEmail}. Per motivi di sicurezza Stremio richiede la password/AuthKey.` } });
  } catch (err) {
    res.status(500).json({ error: { message: "Errore interno durante il monitoraggio." } });
  }
});

// ------------------------------------------
// 4. ENDPOINT DI SALVATAGGIO (CORRETTO)
// ------------------------------------------
app.post('/api/set-addons', async (req, res) => {
  const STREMIO_API_BASE = 'https://api.strem.io/';
  const ADDONS_SET_URL = `${STREMIO_API_BASE}api/addonCollectionSet`;

  try {
    const { authKey, addons, email } = req.body;

    if (!authKey || !addons) {
      return res.status(400).json({ error: true, message: "Chiave di autenticazione o lista addon mancante." });
    }

    // La tua logica di pulizia è corretta e la mantengo
    const addonsToSave = addons.map(addon => {
        const cleanAddon = JSON.parse(JSON.stringify(addon));
        // ... (la tua logica di pulizia va qui ed è corretta) ...
        if (cleanAddon.isEditing) delete cleanAddon.isEditing;
        if (cleanAddon.newLocalName) delete cleanAddon.newLocalName;
        if (cleanAddon.manifest) {
            delete cleanAddon.manifest.newLocalName;
            delete cleanAddon.manifest.isEditing;
        }
        cleanAddon.manifest.name = addon.manifest.name;
        if (!cleanAddon.manifest.id) {
            cleanAddon.manifest.id = `external-${Math.random().toString(36).substring(2, 9)}`;
        }
        return cleanAddon;
    });
    // --- FINE LOGICA PULIZIA ---

    const setResponse = await fetch(ADDONS_SET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        "authKey": authKey,
        "addons": addonsToSave
      })
    });

    const setData = await setResponse.json();

    if (setData.error) {
      throw new Error(setData.error.message || 'Errore Stremio durante il salvataggio degli addon.');
    }

    res.json({ success: true, message: "Addon salvati con successo." });

  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

// --- ENDPOINT: RECUPERA MANIFESTO (INVARIATO, era corretto) ---
app.post('/api/fetch-manifest', async (req, res) => {
  const { manifestUrl } = req.body;

  if (!manifestUrl || !manifestUrl.startsWith('http')) {
    return res.status(400).json({ error: { message: "URL manifesto non valido." } });
  }

  try {
    const manifestResponse = await fetch(manifestUrl);

    if (!manifestResponse.ok) {
      const errorText = await manifestResponse.text();
      if (errorText.trim().startsWith('<!DOCTYPE html>')) {
        throw new Error("Blocco di sicurezza: Il server ha restituito una pagina HTML anziché JSON.");
      }
      throw new Error(`Impossibile raggiungere il manifesto: Status ${manifestResponse.status}.`);
    }

    const manifest = await manifestResponse.json();
    if (!manifest.id || !manifest.version) {
      throw new Error("Manifesto non valido: mancano ID o Versione.");
    }

    res.json(manifest);
  } catch (err) {
    console.error('Errore nel recupero manifesto:', err.message);
    res.status(500).json({ error: { message: "Errore nel recupero del manifesto: " + err.message } });
  }
});

// ------------------------------------------
// 5. ENDPOINT PER I LOG (RIMOSSO)
// ------------------------------------------

// --- AVVIO DEL SERVER ---
app.listen(PORT, () => {
  console.log(`Server avviato correttamente sulla porta ${PORT}`);
});
