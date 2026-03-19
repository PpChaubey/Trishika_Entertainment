# 🎬 The Weight of Silence | मौन का भार

> An AI-powered interactive cinematic thriller with voice narration, scene images, bilingual support, and full offline capability.

---

## 🏗 Architecture

```
Browser
  └── Nginx :80/:443
        ├── /            → Node.js :3000  (story AI)
        ├── /api/story   → Node.js :3000  (Groq race + Ollama fallback)
        ├── /internal/audio/ → Python :3001  (Kokoro TTS + music)
        └── /internal/image/ → Python :3002  (Stable Diffusion + CSS fallback)
                                    ↓
                             Ollama :11434  (llama3.1:8b local)
                             Redis  :6379   (shared rate limiting)
```

---

## 📁 Project Structure

```
├── server.js                   # Main Node.js story server
├── web/
│   └── index.html              # Frontend (modular JS, DOMPurify, bilingual)
├── services/
│   ├── shared.py               # Shared utilities (logger, rate limiter, LRU, base handler)
│   ├── audio/audio_server.py   # TTS + music server
│   └── image/image_server.py   # Stable Diffusion image server
├── infra/
│   ├── nginx.conf.template     # Nginx with envsubst (domain/token not hardcoded)
│   └── docker-compose.yml      # Full stack: nginx, app, audio, image, ollama, redis
├── scripts/
│   ├── start.sh                # Local dev startup (PID-based)
│   ├── stop.sh                 # Safe shutdown
│   └── setup-https.sh          # Let's Encrypt SSL setup
├── .env.example                # Copy to .env
└── README.md
```

---

## 🚀 Quick Start (Local)

```bash
# 1. Install dependencies
npm install
pip install kokoro-onnx soundfile numpy redis --break-system-packages

# 2. Configure
cp .env.example .env
# Fill in: GROQ_API_KEY, SERVICE_TOKEN

# 3. Start everything
bash scripts/start.sh

# 4. Open
http://localhost:3000
```

---

## 🐳 Docker Deploy

```bash
cp .env.example .env   # fill in your values
docker compose up --build
```

---

## 🔒 HTTPS Setup

```bash
export DOMAIN=yourdomain.com
export EMAIL=you@email.com
bash scripts/setup-https.sh
```

---

## 🌍 Features

| Feature | Engine | Fallback |
|---|---|---|
| Story AI | Groq (cloud) | Ollama local |
| Voice narration | Kokoro TTS (offline) | Browser Web Speech |
| Scene images | Stable Diffusion (offline) | CSS gradient |
| Background music | Pixabay CDN | Silent |
| Language | English + हिंदी | — |

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GROQ_API_KEY` | — | Groq API key (optional) |
| `SERVICE_TOKEN` | `thriller-secret-2026` | Internal service auth |
| `MODEL` | `llama3.1:8b` | Ollama model |
| `RATE_LIMIT` | `20` | Requests per minute |
| `CACHE_LIMIT` | `200` | LRU cache size |
| `REDIS_URL` | — | Redis for distributed rate limiting |
| `MAX_BODY_BYTES` | `50000` | Max request body size |
| `STRICT_TTS` | `0` | Exit if Kokoro unavailable |
| `STRICT_SD` | `0` | Exit if Stable Diffusion unavailable |

---

## 🏆 Tech Stack

- **Node.js 22** — story server (native fetch, no node-fetch)
- **Python 3.11** — audio + image services
- **Nginx 1.25** — reverse proxy, rate limiting, HTTPS, token injection
- **Redis 7** — distributed rate limiting
- **Ollama** — local LLM (llama3.1:8b)
- **Groq** — cloud LLM race mode
- **Kokoro ONNX** — offline TTS
- **Stable Diffusion** — offline image generation
- **DOMPurify** — XSS protection for AI narrative output
