import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CONFIG ───────────────────────────────────────────────
const CONFIG = {
  port:       process.env.PORT         || 3000,
  groqKey:    process.env.GROQ_API_KEY || null,
  ollamaUrl:  process.env.OLLAMA_URL   || "http://localhost:11434/api/chat",
  model:      process.env.MODEL        || "llama3.1:8b",
  rateLimit:  parseInt(process.env.RATE_LIMIT  || "20"),
  cacheLimit: parseInt(process.env.CACHE_LIMIT || "200"),
  reqTimeout: 130000,
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
class LRUCache {
  constructor(limit = 200) { this._limit = limit; this._store = new Map(); }
  _key(n, c, lang) { return `${lang}:${n}:${(c||"start").toLowerCase().slice(0,20).replace(/\s+/g,"_")}`; }
  set(n, c, lang, data) {
    const key = this._key(n, c, lang);
    if (this._store.has(key)) this._store.delete(key);
    if (this._store.size >= this._limit) this._store.delete(this._store.keys().next().value);
    this._store.set(key, data);
    return key;
  }
  get(n, c, lang) {
    const key = this._key(n, c, lang);
    if (this._store.has(key)) {
      const val = this._store.get(key);
      this._store.delete(key); this._store.set(key, val);
      return val;
    }
    for (const [k, v] of this._store) { if (k.startsWith(`${lang}:${n}:`)) return v; }
    return null;
  }
  count() { return this._store.size; }
  keys()  { return [...this._store.keys()]; }
}
const cache = new LRUCache(CONFIG.cacheLimit);
let cacheReady = false, cacheProgress = 0;

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

// ─── PROMPTS (language-aware) ─────────────────────────────
const PROMPTS = {
  scene: (sceneN, choice, stats, isFinal, arch, lang) => {
    const isHindi = lang === 'hi';

    const instruction = isHindi
      ? `आप "मौन का भार" नामक एक मनोवैज्ञानिक थ्रिलर गेम के लिए दृश्य लिख रहे हैं।
जासूस माया वर्मा 15 साल बाद मिलहेवन लौटती है। एक हत्या पुराने अनसुलझे मामले की नकल करती है।
सभी टेक्स्ट पूरी तरह हिंदी में लिखें। केवल JSON में उत्तर दें।`
      : `You are writing scenes for "The Weight of Silence" psychological thriller game.
Detective Mara Voss returns to Millhaven after 15 years. A murder mirrors an old unsolved case.
Write all text in English only. Reply ONLY with JSON.`;

    const statsLine = isHindi
      ? `विश्वास=${stats.trust}% अपराध=${stats.guilt}% संदेह=${stats.suspicion}%`
      : `trust=${stats.trust}% guilt=${stats.guilt}% suspicion=${stats.suspicion}%`;

    const finalLine = isFinal
      ? (isHindi ? `यह अंतिम दृश्य है। "${arch}" समाप्ति लिखें।` : `This is the FINAL scene. Write a "${arch}" ending.`)
      : '';

    const schema = isHindi ? `
{
  "chapter": "3-5 शब्दों का हिंदी शीर्षक",
  "location": "मिलहेवन में विशिष्ट स्थान हिंदी में",
  "icon": "एक इमोजी",
  "atmosphere": "rain|interrogation|revelation|church|default",
  "tension_increase": ${10 + sceneN},
  "stat_delta": {"trust": 0, "guilt": 5, "suspicion": 5},
  "narrative": "तीन वाक्य हिंदी में। दूसरे व्यक्ति वर्तमान काल। सिनेमाई और तनावपूर्ण।",
  "choices": ["पहला नैतिक रूप से जटिल विकल्प हिंदी में (8-12 शब्द)", "दूसरा भावनात्मक रूप से विपरीत विकल्प हिंदी में (8-12 शब्द)"]
  ${isFinal ? ',"ending_title": "नाटकीय हिंदी अंत शीर्षक","ending_text": "तीन वाक्य हिंदी उपसंहार तीसरे व्यक्ति में"' : ''}
}` : `
{
  "chapter": "3-5 word evocative English title",
  "location": "specific Millhaven location in English",
  "icon": "one emoji",
  "atmosphere": "rain|interrogation|revelation|church|default",
  "tension_increase": ${10 + sceneN},
  "stat_delta": {"trust": 0, "guilt": 5, "suspicion": 5},
  "narrative": "Three sentences English. Second person present tense. Cinematic and tense.",
  "choices": ["First morally complex English choice (8-12 words)", "Second emotionally opposite English choice (8-12 words)"]
  ${isFinal ? ',"ending_title": "Dramatic 4-6 word English title","ending_text": "Three sentence English epilogue in third person"' : ''}
}`;

    const choiceText = isHindi
      ? `खिलाड़ी ने चुना: "${choice || 'माया मिलहेवन रात में भारी बारिश में पहुँचती है'}"`
      : `Player chose: "${choice || 'Mara arrives in Millhaven at night in heavy rain'}"`;

    return `${instruction}

दृश्य / Scene: ${sceneN}/6
${choiceText}
${statsLine}
${finalLine}

केवल इस JSON फॉर्मेट में उत्तर दें / Reply ONLY with this JSON:
${schema}`;
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
  const groqAbort = new AbortController();
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

// ─── FALLBACKS (both languages) ───────────────────────────
const FALLBACKS = {
  en: [
    { chapter:"Shadows Lengthen", location:"Millhaven Church", icon:"⛪", atmosphere:"church", tension_increase:12, stat_delta:{trust:-5,guilt:5,suspicion:10}, narrative:"You push open the heavy church doors. A candle still flickers near the altar. Someone was here recently.", choices:["Examine the altar for hidden clues","Check the dark confession booth"] },
    { chapter:"The Rain Knows",   location:"Police Station",   icon:"🚔", atmosphere:"interrogation", tension_increase:14, stat_delta:{trust:5,guilt:-5,suspicion:15}, narrative:"The detective slides a photograph across the table. Your father's face stares back at you. Your hands stay steady.", choices:["Demand to see the full case file","Stay silent and study his reaction"] },
    { chapter:"Old Wounds",       location:"Voss Family Home", icon:"🏚️", atmosphere:"rain", tension_increase:10, stat_delta:{trust:0,guilt:15,suspicion:5}, narrative:"The old house smells of pine and regret. Your father's study is untouched, frozen in time. The answers are here.", choices:["Search the desk for hidden documents","Look behind the old painting"] },
  ],
  hi: [
    { chapter:"परछाइयाँ लंबी होती हैं", location:"मिलहेवन चर्च", icon:"⛪", atmosphere:"church", tension_increase:12, stat_delta:{trust:-5,guilt:5,suspicion:10}, narrative:"आप भारी चर्च के दरवाजे धकेलती हैं। वेदी के पास एक मोमबत्ती अभी भी टिमटिमाती है। कोई हाल ही में यहाँ था।", choices:["छिपे सुरागों के लिए वेदी की जाँच करें","अंधेरे कन्फेशन बूथ की जाँच करें"] },
    { chapter:"बारिश जानती है",        location:"पुलिस स्टेशन",   icon:"🚔", atmosphere:"interrogation", tension_increase:14, stat_delta:{trust:5,guilt:-5,suspicion:15}, narrative:"जासूस मेज पर एक तस्वीर सरकाता है। आपके पिता का चेहरा आपको वापस देखता है। आपके हाथ स्थिर रहते हैं।", choices:["पूरी केस फाइल देखने की माँग करें","चुप रहें और उसकी प्रतिक्रिया देखें"] },
    { chapter:"पुराने घाव",             location:"वर्मा परिवार का घर", icon:"🏚️", atmosphere:"rain", tension_increase:10, stat_delta:{trust:0,guilt:15,suspicion:5}, narrative:"पुराने घर में देवदार और पछतावे की खुशबू आती है। आपके पिता का अध्ययन कक्ष अछूता है, समय में जमा हुआ। जवाब यहाँ हैं।", choices:["छिपे दस्तावेजों के लिए मेज की तलाशी लें","पुरानी पेंटिंग के पीछे देखें"] },
  ]
};
const fbIdx = { en: 0, hi: 0 };
function getFallback(lang) {
  const l = lang || 'en';
  return FALLBACKS[l][fbIdx[l]++ % FALLBACKS[l].length];
}

// ─── PRE-GENERATE (both languages) ────────────────────────
async function pregenerateScenes() {
  log.info("Pre-generation started (EN + HI)");
  const scenes = [
    { n:1, choice:null,                                    stats:{trust:50,guilt:20,suspicion:30}, final:false },
    { n:2, choice:"Head to the church",                   stats:{trust:40,guilt:25,suspicion:40}, final:false },
    { n:3, choice:"Confront the detective",               stats:{trust:35,guilt:30,suspicion:55}, final:false },
    { n:4, choice:"Search the evidence room",             stats:{trust:30,guilt:40,suspicion:65}, final:false },
    { n:5, choice:"Expose the conspiracy",                stats:{trust:25,guilt:50,suspicion:75}, final:false },
    { n:6, choice:"Face the killer in the old church",    stats:{trust:20,guilt:60,suspicion:80}, final:true  },
  ];

  const total = scenes.length * 2;
  let done = 0;

  for (const lang of ['en', 'hi']) {
    for (const s of scenes) {
      await tryCatch(async () => {
        log.info(`Pre-gen [${lang.toUpperCase()}] Scene ${s.n}...`);
        const prompt = PROMPTS.scene(s.n, s.choice, s.stats, s.final, "redemption", lang);
        const raw    = await generate(prompt);
        const data   = extractJSON(raw);
        if (data) {
          const key = cache.set(s.n, s.choice, lang, data);
          cacheProgress = Math.round((++done / total) * 100);
          log.info(`✅ [${lang.toUpperCase()}] "${data.chapter}" → ${key} (${cacheProgress}%)`);
        } else {
          log.warn(`⚠ [${lang.toUpperCase()}] Scene ${s.n} parse failed`);
          log.debug("Raw:", raw?.slice(0, 200));
        }
      });
    }
  }

  cacheReady = true;
  log.info(`Pre-gen done! ${cache.count()}/${total} scenes cached`);
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

  const language = lang || 'en'; // 'en' or 'hi'
  const last     = messages[messages.length-1]?.content || "";
  const sceneN   = parseInt(last.match(/Scene (\d+)/)?.[1]    || "1");
  const choice   = last.match(/chose: "([^"]+)"/)?.[1]        || "start";
  const isFinal  = last.includes("ending");
  const arch     = last.match(/"(\w+)" ending/)?.[1]          || "redemption";
  const stats    = {
    trust:     parseInt(last.match(/trust=(\d+)/)?.[1]     || "50"),
    guilt:     parseInt(last.match(/guilt=(\d+)/)?.[1]     || "20"),
    suspicion: parseInt(last.match(/suspicion=(\d+)/)?.[1] || "30"),
  };

  log.info(`Scene ${sceneN} | lang=${language} | "${choice?.slice(0,25)}" | ${ip}`);

  // Cache hit
  const hit = cache.get(sceneN, choice, language);
  if (hit) {
    log.info(`⚡ Cache hit [${language}] → "${hit.chapter}"`);
    return res.json({ content: [{ text: JSON.stringify(hit) }] });
  }

  // Generate on demand
  log.info(`Cache miss [${language}] — generating...`);
  const prompt = PROMPTS.scene(sceneN, choice, stats, isFinal, arch, language);
  const raw    = await tryCatch(() => generate(prompt));
  const data   = extractJSON(raw);

  if (!data) {
    log.warn(`Parse failed [${language}] — fallback`);
    return res.json({ content: [{ text: JSON.stringify(getFallback(language)) }] });
  }

  cache.set(sceneN, choice, language, data);
  log.info(`Generated [${language}]: "${data.chapter}"`);
  return res.json({ content: [{ text: JSON.stringify(data) }] });
});

// ─── HEALTH ───────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({
  status:"ok", cacheReady, cacheProgress,
  cachedScenes: cache.count(), groq: !!CONFIG.groqKey,
  raceMode: !!CONFIG.groqKey, model: CONFIG.model,
  mutexLocked: ollamaMutex.isLocked(), mutexQueue: ollamaMutex.queueDepth(),
  rateLimit: `${CONFIG.rateLimit} req/min`,
  languages: ["en", "hi"],
}));

app.get("/api/cache-status", (_req, res) => res.json({
  ready: cacheReady, progress: cacheProgress,
  cached: cache.count(), scenes: cache.keys()
}));

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
  log.info(`💾 LRU cache    → max ${CONFIG.cacheLimit} entries (EN+HI)`);
  log.info(`🔒 Rate limit   → ${CONFIG.rateLimit} req/min`);

  const ok = await checkOllama();
  if (CONFIG.groqKey || ok) pregenerateScenes();
  else { cacheReady = true; log.warn("No AI — fallback mode"); }
});
