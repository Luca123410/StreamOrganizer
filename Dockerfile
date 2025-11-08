# Usa un'immagine base Node.js
FROM node:20-slim

# Imposta la porta come variabile d'ambiente
ENV PORT 7860

# Imposta la directory di lavoro
WORKDIR /usr/src/app

# === MIGLIORAMENTO SICUREZZA ===
# Dà la proprietà della cartella all'utente 'node' (non-root)
RUN chown -R node:node /usr/src/app
# Passa all'utente 'node'
USER node

# === MODIFICA PER HUGGING FACE ===
# Copia solo package.json 
COPY --chown=node:node package.json ./

# Usa 'npm install' che funziona senza package-lock.json
RUN npm install --omit=dev

# === FINE MODIFICA ===

# Copia il resto del codice
# (ignorerà i file specificati in .dockerignore)
COPY --chown=node:node . .

# Espone la porta
EXPOSE ${PORT} 

# Comando di avvio
CMD ["node", "index.js"]
