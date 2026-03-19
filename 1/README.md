# 🎬 The Weight of Silence — Interactive AI Thriller

An interactive psychological thriller powered by **Grok AI** (xAI).

---

## 🚀 Setup (3 steps)

### 1. Add your Grok API key
Open `.env` and replace the placeholder:
```
GROK_API_KEY=paste_your_new_key_here
```
> ⚠️ Never share this file or commit it to Git.

### 2. Install dependencies
```bash
npm install
```

### 3. Run the server
```bash
node server.js
```

Open your browser at: **http://localhost:3000**

---

## 📁 Project Structure
```
thriller-app/
├── public/
│   └── index.html       ← Frontend (the game)
├── server.js            ← Backend proxy (keeps API key secret)
├── .env                 ← Your secret API key (never share!)
├── .env.example         ← Template for sharing
├── .gitignore           ← Prevents .env from being committed
└── package.json
```

---

## 🔑 Security
- Your Grok API key lives **only in `.env`** on your machine
- The frontend calls `/api/story` on your local server
- The server calls Grok with your key — the browser never sees it
- `.gitignore` prevents `.env` from being pushed to GitHub

---

## 🎮 Features
- **6-scene story arc** with Act I / II / III structure
- **3 ending archetypes**: Redemption, Corruption, Sacrifice
- **Hidden stat tracking**: Trust, Guilt, Suspicion — updated by your choices
- **Live rain animation** and atmospheric gradient shifts
- **Tension meter** that rises as the story darkens
- **Full JSON validation** with graceful fallbacks
- Every playthrough is **uniquely AI-generated**

---

## ⚠️ Troubleshooting
| Error | Fix |
|---|---|
| `401 Unauthorized` | Check your Grok API key in `.env` |
| `Model not found` | Change `grok-2-latest` in server.js to `grok-2` or `grok-beta` |
| `Cannot reach server` | Make sure `node server.js` is running |
| Page won't load | Visit `http://localhost:3000/api/health` to check server status |
