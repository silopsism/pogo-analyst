# --- build stage: compile the Vite app ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# --- serve stage: small Python backend serves the app + data + pvpoke refresh ---
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir flask gunicorn requests
COPY --from=build /app/dist ./dist
COPY data ./data
COPY scripts ./scripts
COPY server.py ./server.py
EXPOSE 80
# -w 2 workers, long timeout so the on-demand pvpoke fetch isn't killed mid-run
CMD ["gunicorn", "-b", "0.0.0.0:80", "-w", "2", "-t", "600", "server:app"]
