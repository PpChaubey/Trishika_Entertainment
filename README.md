# 🎬 Trishika Entertainment — AI Cinematic Thriller

> An AI-powered interactive psychological thriller with voice narration, AI scene images, Hindi/English bilingual support, and full offline capability.

🔗 **Live Demo:** *(coming soon)*

---

## 🎮 What Is This?

An interactive story game where every choice you make changes the narrative. Powered entirely by AI — the story generates fresh every single playthrough.

- 🕵️ Play as Detective Mara Voss / जासूस माया वर्मा
- 🌧️ Set in the mysterious town of Millhaven
- 🎭 3 possible endings: Redemption, Corruption, or Sacrifice
- 🇮🇳 Full Hindi + English language support
- 🔊 AI voice narration
- 🖼️ AI generated scene images

---

## 🏗️ Architecture

```
Browser (EN + हिंदी)
    ↓
Nginx (HTTPS, rate limiting, token injection)
    ↓
Node.js :3000  — Story AI (Groq race + Ollama fallback)
Python  :3001  — TTS Voice (Kokoro offline)
Python  :3002  — Scene Images (Stable Diffusion)
    ↓
Redis   :6379  — Distributed rate limiting
Ollama  :11434 — Local LLaMA 3.1 (offline AI)
```

---

## ⚡ Tech Stack

| Layer | Technology |
|---|---|
| Story AI | Groq LLaMA 70B + Ollama llama3.1:8b |
| Voice | Kokoro ONNX (offline TTS) |
| Images | Stable Diffusion v1.5 (offline) |
| Backend | Node.js 22, Express |
| Services | Python 3.11 |
| Proxy | Nginx 1.25 |
| Cache | Redis 7 |
| Deploy | Docker Compose |

---

## 🚀 Quick Start (Local)

```bash
# 1. Clone
git clone https://github.com/PpChaubey/Trishika_Entertainment.git
cd Trishika_Entertainment

# 2. Install
npm install
pip install kokoro-onnx soundfile numpy redis --break-system-packages

# 3. Configure
cp .env.example .env
# Add your GROQ_API_KEY (free at console.groq.com)

# 4. Start Ollama
ollama pull llama3.1:8b

# 5. Run
bash start.sh

# 6. Open
http://localhost:3000
```

---

## 🐳 Docker Deploy

```bash
cp .env.example .env
docker compose up --build
```

---

## 🌍 Features

| Feature | Engine | Fallback |
|---|---|---|
| Story AI | Groq cloud (~1s) | Ollama local |
| Voice | Kokoro TTS offline | Browser Speech API |
| Images | Stable Diffusion | CSS gradient |
| Music | Pixabay CDN | Silent |
| Language | English + हिंदी | — |

---

## 🔒 Security

- Nginx reverse proxy — services never exposed directly
- Service token injected server-side by Nginx
- Per-IP rate limiting (Redis + in-memory fallback)
- Request timeout guards
- DOMPurify sanitization on AI output
- Input validation + JSON size limits

---

## 📁 Project Structure

```
├── server.js              # Main story server
├── index.html             # Frontend (bilingual, modular JS)
├── audio_server.py        # TTS + music
├── image_server.py        # Stable Diffusion images
├── services/shared.py     # Shared Python utilities
├── infra/
│   ├── nginx.conf.template
│   └── docker-compose.yml
├── scripts/
│   ├── start.sh
│   └── stop.sh
└── .env.example
```

---

## 👨‍💻 Built By

**Himanshu Chaubey** — [@PpChaubey](https://github.com/PpChaubey)

*Built from scratch — from a broken Gemini API key to a full production AI system.*

---

## ⭐ If you like this project, give it a star!
