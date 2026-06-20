FROM node:22-slim

WORKDIR /app

# Copier les dépendances
COPY package*.json ./
RUN npm install --omit=dev

# Copier tout le reste (code + données CSV/JSON)
COPY . .

# Port exposé
EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server.js"]
