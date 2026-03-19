import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CONFIG ───────────────────────────────────────────────
const CONFIG = {
  port:       process.env.PORT         || 3000,
  groqKey:    process.env.GROQ_API_KEY || null,
  ollamaUrl:  process.env.OLLAMA_URL   || "http://localhost:11434/api/chat",
  model:      process.env.MODEL        || "llama3.1:8b",
  rateLimit:  parseInt(process.env.RATE_LIMIT  || "20"),
  reqTimeout: 130000,
  total:      6,
  archetypeThresholds: { guilt: 60, trust: 55 },
};

// ─── LOGGER ───────────────────────────────────────────────
const log = {
  info:  (...a) => console.log( `[${new Date().toISOString()}] INFO `, ...a),
  warn:  (...a) => console.warn( `[${new Date().toISOString()}] WARN `, ...a),
  error: (...a) => console.error(`[${new Date().toISOString()}] ERROR`, ...a),
  debug: (...a) => console.log( `[${new Date().toISOString()}] DEBUG`, ...a),
};

// ─── MUTEX ────────────────────────────────────────────────
class Mutex {
  constructor() { this._queue = []; this._locked = false; }
  lock()        { return new Promise(r => { if (!this._locked) { this._locked = true; r(); } else { this._queue.push(r); } }); }
  unlock()      { if (this._queue.length > 0) { this._queue.shift()(); } else { this._locked = false; } }
  isLocked()    { return this._locked; }
  queueDepth()  { return this._queue.length; }
}
const ollamaMutex = new Mutex();

// ─── RATE LIMITER ─────────────────────────────────────────
const rateLimitMap = new Map();
setInterval(() => rateLimitMap.clear(), 60 * 60 * 1000);
function rateLimit(ip, max = CONFIG.rateLimit) {
  const now = Date.now(), win = 60000;
  const e   = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - e.start > win) { e.count = 1; e.start = now; } else { e.count++; }
  rateLimitMap.set(ip, e);
  return e.count > max;
}

// ─── LRU CACHE ────────────────────────────────────────────

// ─── HELPERS ──────────────────────────────────────────────
function extractJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text.trim()); } catch {}
  const f = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (f) { try { return JSON.parse(f[1].trim()); } catch {} }
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s !== -1 && e !== -1) { try { return JSON.parse(text.slice(s, e+1)); } catch {} }
  return null;
}

async function tryCatch(fn, fallback = null) {
  try { return await fn(); } catch (err) { log.error(err.message); return fallback; }
}

// ─── PROMPTS (archetype + history injected for max variation) ─
const PROMPTS = {
  scene: (sceneN, choice, stats, isFinal, arch, lang, priorChoices = []) => {
    const isHindi = lang === "hi";

    // Archetype direction injected so each playthrough feels different
    const archetypeHint = {
      redemption: isHindi
        ? "माया सच्चाई की तलाश में है — माफी और शांति की ओर।"
        : "Mara seeks truth — she moves toward forgiveness and peace.",
      corruption: isHindi
        ? "माया खतरनाक रास्ते पर है — वह अंधेरे में खो सकती है।"
        : "Mara is on a dangerous path — she risks becoming what she hunts.",
      sacrifice: isHindi
        ? "माया सब कुछ दांव पर लगाने को तैयार है।"
        : "Mara is willing to sacrifice everything — her guilt is consuming her.",
    }[arch] || "";

    // Prior choices injected for story continuity
    const historyHint = priorChoices.length > 0
      ? (isHindi
          ? "अब तक के निर्णय: " + priorChoices.map((c,i) => (i+1)+". "+c).join(" → ")
          : "Prior choices: " + priorChoices.map((c,i) => (i+1)+". "+c).join(" → "))
      : "";

    const instruction = isHindi
      ? ["आप 'मौन का भार' मनोवैज्ञानिक थ्रिलर गेम के लिए दृश्य लिख रहे हैं।",
         "जासूस माया वर्मा 15 साल बाद मिलहेवन लौटती है।",
         archetypeHint,
         "सभी टेक्स्ट पूरी तरह हिंदी में। केवल JSON में उत्तर दें।"].filter(Boolean).join("\n")
      : ["You write scenes for 'The Weight of Silence' psychological thriller.",
         "Detective Mara Voss returns to Millhaven after 15 years. A murder mirrors an old unsolved case.",
         archetypeHint,
         "English only. Reply ONLY with JSON. Make each scene DIFFERENT — avoid clichés."].filter(Boolean).join("\n");

    const statsLine = isHindi
      ? "विश्वास="+stats.trust+"% अपराध="+stats.guilt+"% संदेह="+stats.suspicion+"%"
      : "trust="+stats.trust+"% guilt="+stats.guilt+"% suspicion="+stats.suspicion+"%";

    const finalLine = isFinal
      ? (isHindi
          ? "यह अंतिम दृश्य है। \""+arch+"\" समाप्ति लिखें — भावनात्मक और यादगार।"
          : "FINAL SCENE. Write a \""+arch+"\" ending — emotionally resonant and surprising.")
      : "";

    // Narrative hint varies by archetype for richer variation
    const narrativeHint = isHindi
      ? "तीन वाक्य हिंदी में। दूसरे व्यक्ति वर्तमान काल। सिनेमाई।"
      : ({
          redemption: "Three sentences. Second person. Focus on hope, connection, or a small moment of truth.",
          corruption:  "Three sentences. Second person. Focus on moral compromise or a line being crossed.",
          sacrifice:   "Three sentences. Second person. Focus on cost, loss, or something irreversible.",
        }[arch] || "Three cinematic sentences. Second person present. Subvert expectations.");

    const schema = isHindi
      ? `{"chapter":"3-5 शब्दों का शीर्षक","location":"मिलहेवन में विशिष्ट स्थान","icon":"इमोजी","atmosphere":"rain|interrogation|revelation|church|default","tension_increase":${8+sceneN},"stat_delta":{"trust":0,"guilt":5,"suspicion":5},"narrative":"${narrativeHint}","choices":["पहला विकल्प 8-12 शब्द","दूसरा विकल्प 8-12 शब्द"]${isFinal ? ',"ending_title":"अंत शीर्षक","ending_text":"तीन वाक्य उपसंहार"' : ""}}`
      : `{"chapter":"3-5 word title","location":"specific Millhaven location (vary: diner, docks, archive, motel, woods, library)","icon":"thematic emoji","atmosphere":"rain|interrogation|revelation|church|default","tension_increase":${8+sceneN},"stat_delta":{"trust":<-15 to 15>,"guilt":<-10 to 20>,"suspicion":<-10 to 20>},"narrative":"${narrativeHint}","choices":["Morally complex choice A 8-12 words","Emotionally opposite choice B 8-12 words"]${isFinal ? ',"ending_title":"Dramatic 4-6 word title","ending_text":"Three sentence third-person epilogue"' : ""}}`;

    const choiceText = isHindi
      ? "खिलाड़ी ने चुना: \"" + (choice || "माया मिलहेवन रात में पहुँचती है") + "\""
      : "Player chose: \"" + (choice || "Mara arrives in Millhaven at night in heavy rain") + "\"";

    return [instruction, "Scene: "+sceneN+"/"+CONFIG.total, choiceText, historyHint, statsLine, finalLine, "\nReply ONLY with raw JSON:\n"+schema]
      .filter(Boolean).join("\n");
  }
};

// ─── EXPRESS APP ──────────────────────────────────────────
const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());
app.use(express.static("."));
app.use(express.static(path.join(__dirname, "public")));

// ─── GROQ ─────────────────────────────────────────────────
async function callGroq(prompt, signal) {
  if (!CONFIG.groqKey) return null;
  return tryCatch(async () => {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CONFIG.groqKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 600, temperature: 0.85,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d?.choices?.[0]?.message?.content || null;
  });
}

// ─── OLLAMA ───────────────────────────────────────────────
async function callOllama(prompt, signal = null) {
  await ollamaMutex.lock();
  log.debug(`Mutex acquired | queue=${ollamaMutex.queueDepth()}`);
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  signal?.addEventListener("abort", () => ctrl.abort());
  try {
    const res = await fetch(CONFIG.ollamaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: CONFIG.model, stream: false,
        options: { temperature: 0.8, num_predict: 600, num_ctx: 1024 },
        messages: [{ role: "user", content: prompt }]
      })
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    return d?.message?.content || "";
  } finally { clearTimeout(timer); ollamaMutex.unlock(); log.debug("Mutex released"); }
}

// ─── RACE: GROQ vs OLLAMA ─────────────────────────────────
async function generate(prompt) {
  if (!CONFIG.groqKey) {
    log.info("Local only");
    return callOllama(prompt);
  }
  log.info("Racing Groq vs Ollama ⚡");
  const groqAbort   = new AbortController();
  const ollamaAbort = new AbortController();
  return new Promise((resolve) => {
    let settled = false, failures = 0;
    const finish = (src, result, kill) => {
      if (!settled && result) { settled = true; kill.abort(); log.info(`Winner: ${src}`); resolve(result); }
    };
    const onFail = () => { if (++failures === 2 && !settled) { settled = true; resolve(null); } };
    callGroq(prompt, groqAbort.signal).then(r => r ? finish("Groq", r, ollamaAbort) : onFail()).catch(onFail);
    callOllama(prompt, ollamaAbort.signal).then(r => r ? finish("Ollama", r, groqAbort) : onFail()).catch(onFail);
  });
}

// ─── FALLBACKS ────────────────────────────────────────────
const FALLBACKS = {
  en: [
    { chapter:"Shadows Lengthen", location:"Millhaven Church", icon:"⛪", atmosphere:"church", tension_increase:12, stat_delta:{trust:-5,guilt:5,suspicion:10}, narrative:"You push open the heavy church doors. A candle still flickers near the altar. Someone was here recently.", choices:["Examine the altar for hidden clues","Check the dark confession booth"] },
    { chapter:"The Rain Knows",   location:"Police Station",   icon:"🚔", atmosphere:"interrogation", tension_increase:14, stat_delta:{trust:5,guilt:-5,suspicion:15}, narrative:"The detective slides a photograph across the table. Your father's face stares back at you. Your hands stay steady.", choices:["Demand to see the full case file","Stay silent and study his reaction"] },
    { chapter:"Old Wounds",       location:"Voss Family Home", icon:"🏚️", atmosphere:"rain", tension_increase:10, stat_delta:{trust:0,guilt:15,suspicion:5}, narrative:"The old house smells of pine and regret. Your father's study is untouched, frozen in time. The answers are here.", choices:["Search the desk for hidden documents","Look behind the old painting"] },
  ],
  hi: [
    { chapter:"परछाइयाँ लंबी होती हैं", location:"मिलहेवन चर्च", icon:"⛪", atmosphere:"church", tension_increase:12, stat_delta:{trust:-5,guilt:5,suspicion:10}, narrative:"आप भारी चर्च के दरवाजे धकेलती हैं। वेदी के पास एक मोमबत्ती अभी भी टिमटिमाती है। कोई हाल ही में यहाँ था।", choices:["छिपे सुरागों के लिए वेदी की जाँच करें","अंधेरे कन्फेशन बूथ की जाँच करें"] },
    { chapter:"बारिश जानती है",   location:"पुलिस स्टेशन",   icon:"🚔", atmosphere:"interrogation", tension_increase:14, stat_delta:{trust:5,guilt:-5,suspicion:15}, narrative:"जासूस मेज पर एक तस्वीर सरकाता है। आपके पिता का चेहरा आपको वापस देखता है। आपके हाथ स्थिर रहते हैं।", choices:["पूरी केस फाइल देखने की माँग करें","चुप रहें और उसकी प्रतिक्रिया देखें"] },
    { chapter:"पुराने घाव",       location:"वर्मा परिवार का घर", icon:"🏚️", atmosphere:"rain", tension_increase:10, stat_delta:{trust:0,guilt:15,suspicion:5}, narrative:"पुराने घर में देवदार और पछतावे की खुशबू आती है। आपके पिता का अध्ययन कक्ष अछूता है। जवाब यहाँ हैं।", choices:["छिपे दस्तावेजों के लिए मेज की तलाशी लें","पुरानी पेंटिंग के पीछे देखें"] },
  ]
};
const fbIdx = { en: 0, hi: 0 };
function getFallback(lang) {
  const l = lang || 'en';
  return FALLBACKS[l][fbIdx[l]++ % FALLBACKS[l].length];
}

// ─── STORY ROUTE ──────────────────────────────────────────
app.post("/api/story", async (req, res) => {
  res.setTimeout(CONFIG.reqTimeout, () => {
    log.warn("Request timeout");
    if (!res.headersSent) res.status(504).json({ error: "AI timeout. Please try again." });
  });

  const ip = req.ip || "unknown";
  if (rateLimit(ip)) return res.status(429).json({ error: "Too many requests." });

  const { messages, lang } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: "Missing messages" });

  const language = lang || 'en';
  const last     = messages[messages.length-1]?.content || "";
  const sceneN   = parseInt(last.match(/Scene (\d+)/)?.[1]    || "1");
  const choice   = last.match(/chose: "([^"]+)"/)?.[1] || null;
  const isFinal  = last.includes("ending");
  const arch     = last.match(/"?(\w+)"? ending/)?.[1]        || "redemption";
  const stats    = {
    trust:     parseInt(last.match(/trust=(\d+)/)?.[1]     || "50"),
    guilt:     parseInt(last.match(/guilt=(\d+)/)?.[1]     || "20"),
    suspicion: parseInt(last.match(/suspicion=(\d+)/)?.[1] || "30"),
  };

  log.info(`Scene ${sceneN} | lang=${language} | arch=${arch} | "${choice?.slice(0,25)||'start'}" | ${ip}`);

  // ✅ Fix 1: No cache read — every call hits Groq/Ollama for fresh variation
  // Extract prior choices from message history for prompt injection
  const priorChoices = messages
    .filter(m => m.role === "user" && m.content.includes('chose:'))
    .map(m => { const match = m.content.match(/chose: "([^"]+)"/); return match?.[1]?.slice(0,40); })
    .filter(Boolean);

  // ✅ Fix 2: priorChoices + arch injected into prompt
  const prompt = PROMPTS.scene(sceneN, choice, stats, isFinal, arch, language, priorChoices);
  const raw    = await tryCatch(() => generate(prompt));
  const data   = extractJSON(raw);

  if (!data) {
    log.warn(`Parse failed [${language}] — fallback`);
    return res.json({ content: [{ text: JSON.stringify(getFallback(language)) }] });
  }

  // ✅ Fix 3: Clip stat_delta server-side so model can't return wild values
  if (data.stat_delta && typeof data.stat_delta === "object") {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
    data.stat_delta.trust     = clamp(data.stat_delta.trust,     -15, 15);
    data.stat_delta.guilt     = clamp(data.stat_delta.guilt,     -10, 20);
    data.stat_delta.suspicion = clamp(data.stat_delta.suspicion, -10, 20);
  }
  if (typeof data.tension_increase === "number") {
    data.tension_increase = Math.max(4, Math.min(20, data.tension_increase));
  }

  // No caching — every call generates fresh for zero repetition
  log.info(`Generated [${language}] arch=${arch}: "${data.chapter}" | delta=${JSON.stringify(data.stat_delta)}`);
  return res.json({ content: [{ text: JSON.stringify(data) }] });
});

// ─── CONFIG ROUTE (for frontend) ──────────────────────────
app.get("/api/config", (_req, res) => {
  res.json({
    total:               CONFIG.total,
    archetypeThresholds: CONFIG.archetypeThresholds,
  });
});

// ─── HEALTH & CACHE ───────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({
  status:"ok", groq: !!CONFIG.groqKey,
  raceMode: !!CONFIG.groqKey, model: CONFIG.model,
  mutexLocked: ollamaMutex.isLocked(), mutexQueue: ollamaMutex.queueDepth(),
  rateLimit: `${CONFIG.rateLimit} req/min`, languages: ["en", "hi"],
}));

// ─── AUDIO / IMAGE STUB ROUTES ────────────────────────────
// These are served by Python servers in production.
// In single-server mode they return graceful fallbacks.
app.get("/internal/audio/health", (_req, res) => res.json({ status: "ok", engine: "browser" }));
app.post("/internal/audio/narrate", (_req, res) => res.json({ audio: null, engine: "browser" }));
app.get("/internal/image/health",  (_req, res) => res.json({ status: "ok", engine: "css" }));
app.post("/internal/image/generate", (_req, res) => res.json({ image: null, engine: "css_gradient" }));

// ─── STARTUP ──────────────────────────────────────────────
async function checkOllama() {
  return tryCatch(async () => {
    await fetch("http://localhost:11434");
    const d = await (await fetch("http://localhost:11434/api/tags")).json();
    log.info(`Ollama ready | models: ${(d.models||[]).map(m=>m.name).join(", ")}`);
    return true;
  }, false);
}

app.listen(CONFIG.port, "0.0.0.0", async () => {
  log.info(`🎬 Thriller App → http://localhost:${CONFIG.port}`);
  log.info(`🌐 Groq         → ${CONFIG.groqKey ? "enabled ⚡" : "not set"}`);
  log.info(`🤖 Model        → ${CONFIG.model}`);
  log.info(`🌍 Languages    → English + हिंदी`);
  log.info(`🔒 Rate limit   → ${CONFIG.rateLimit} req/min`);
  const ok = await checkOllama();
  if (!CONFIG.groqKey && !ok) log.warn("No AI — fallback mode only");
});
