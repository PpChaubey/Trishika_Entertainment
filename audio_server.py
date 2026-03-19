#!/usr/bin/env python3
"""
Audio Service — uses shared.py for auth, rate limiting, logging
Port 3001
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared import make_logger, RateLimiter, BaseServiceHandler
from http.server import ThreadingHTTPServer
import json, io, base64

log         = make_logger("audio")
REDIS_URL   = os.environ.get("REDIS_URL")
STRICT_MODE = os.environ.get("STRICT_TTS", "0") == "1"  # fail fast if TTS required
rate        = RateLimiter("audio", REDIS_URL, log)

# ─── TTS SETUP (fail-fast in strict mode) ─────────────────
TTS_AVAILABLE = False
kokoro        = None

try:
    from kokoro_onnx import Kokoro
    import numpy as np
    import soundfile as sf
    TTS_AVAILABLE = True
    log.info("Kokoro library available — loading model...")
    try:
        kokoro = Kokoro("kokoro-v0_19.onnx", "voices.bin")
        log.info("Kokoro model loaded ✅")
    except Exception as e:
        log.warning(f"Kokoro model not found: {e}")
        if STRICT_MODE:
            log.error("STRICT_TTS=1 but model unavailable — exiting")
            sys.exit(1)
        TTS_AVAILABLE = False
except ImportError:
    log.warning("kokoro_onnx not installed — browser TTS fallback active")
    if STRICT_MODE:
        log.error("STRICT_TTS=1 but kokoro_onnx not installed — exiting")
        sys.exit(1)

MUSIC_MAP = {
    "rain":          "music/rain_ambient.mp3",
    "interrogation": "music/tense_low.mp3",
    "revelation":    "music/revelation_swell.mp3",
    "church":        "music/church_organ.mp3",
    "default":       "music/dark_ambient.mp3",
}

def generate_tts(text: str, lang: str = "en"):
    if not (kokoro and TTS_AVAILABLE):
        return None, None
    try:
        samples, sr = kokoro.create(text[:500], voice="af_heart", speed=0.9, lang="en-us")
        buf = io.BytesIO()
        sf.write(buf, samples, sr, format="WAV")
        buf.seek(0)
        return base64.b64encode(buf.read()).decode(), "audio/wav"
    except Exception as e:
        log.error(f"TTS error: {e}")
        return None, None

# ─── HANDLER ──────────────────────────────────────────────
class AudioHandler(BaseServiceHandler):

    def do_GET(self):
        if self.path == "/audio/health":
            self.send_json({
                "status":      "ok",
                "service":     "audio",
                "tts":         TTS_AVAILABLE,
                "kokoro":      kokoro is not None,
                "threading":   True,
                "redis":       rate.using_redis,
                "strict_mode": STRICT_MODE,
                "max_body":    self.MAX_BODY,
            })
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        rid, blocked = self.guard(rate, max_per_min=30)
        if blocked: return

        body, err = self.parse_body()
        if err:
            return self.send_json({"error": err, "request_id": rid}, 400, rid)

        if self.path == "/audio/narrate":
            text = body.get("text", "").strip()
            lang = body.get("lang", "en")

            if not text:
                return self.send_json({"error": "text required", "request_id": rid}, 400, rid)
            if lang not in ("en", "hi"):
                return self.send_json({"error": "lang must be en or hi", "request_id": rid}, 400, rid)

            log.info(f"TTS request [{rid}] lang={lang} len={len(text)}")
            clean = text.replace("*","").replace("#","").replace("|","")[:500]
            audio_b64, mime = generate_tts(clean, lang)

            if audio_b64:
                self.send_json({"audio": audio_b64, "mime": mime, "engine": "kokoro", "request_id": rid}, request_id=rid)
            else:
                self.send_json({"audio": None, "engine": "browser", "text": clean, "lang": lang, "request_id": rid}, request_id=rid)

        elif self.path == "/audio/music":
            atmosphere = body.get("atmosphere", "default")
            if atmosphere not in MUSIC_MAP: atmosphere = "default"
            self.send_json({"file": MUSIC_MAP[atmosphere], "atmosphere": atmosphere, "request_id": rid}, request_id=rid)
        else:
            self.send_response(404); self.end_headers()

if __name__ == "__main__":
    PORT = int(os.environ.get("AUDIO_PORT", 3001))
    log.info(f"Audio Server → port {PORT}")
    log.info(f"TTS: {'Kokoro' if TTS_AVAILABLE else 'browser fallback'} | Redis: {rate.using_redis} | MaxBody: {AudioHandler.MAX_BODY}")
    ThreadingHTTPServer(("0.0.0.0", PORT), AudioHandler).serve_forever()
