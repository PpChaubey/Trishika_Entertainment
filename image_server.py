#!/usr/bin/env python3
"""
Image Service — uses shared.py for auth, rate limiting, logging
Port 3002
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared import make_logger, RateLimiter, LRUCache, BaseServiceHandler
from http.server import ThreadingHTTPServer
import json, base64, io, threading

log         = make_logger("image")
REDIS_URL   = os.environ.get("REDIS_URL")
STRICT_MODE = os.environ.get("STRICT_SD", "0") == "1"
rate        = RateLimiter("image", REDIS_URL, log)
image_cache = LRUCache(limit=int(os.environ.get("IMAGE_CACHE_LIMIT", "50")), log=log)
sd_semaphore = threading.Semaphore(1)

# ─── STABLE DIFFUSION (fail-fast in strict mode) ──────────
SD_AVAILABLE = False
pipe         = None
pipe_lock    = threading.Lock()

try:
    from diffusers import StableDiffusionPipeline
    import torch
    SD_AVAILABLE = True
    log.info("Stable Diffusion available")
except ImportError:
    log.warning("diffusers not installed — CSS gradient fallback")
    if STRICT_MODE:
        log.error("STRICT_SD=1 but diffusers not installed — exiting")
        sys.exit(1)

SCENE_PROMPTS = {
    "rain":          "cinematic noir detective scene, rain-soaked street, dark atmosphere, film noir, dramatic lighting",
    "interrogation": "dark interrogation room, single lamp, shadows, tense atmosphere, neo noir, cinematic",
    "revelation":    "dramatic revelation, dramatic lighting, shadows, noir thriller, cinematic wide shot",
    "church":        "abandoned gothic church interior, candles, shadows, dark mystery, cinematic",
    "default":       "dark mysterious town at night, noir atmosphere, rain, cinematic",
}
NEGATIVE = "blurry, cartoon, anime, bright, daytime, happy, low quality"

def load_sd():
    global pipe
    if pipe: return True
    if not SD_AVAILABLE: return False
    try:
        log.info("Loading Stable Diffusion model (~4GB)...")
        with pipe_lock:
            pipe = StableDiffusionPipeline.from_pretrained(
                "runwayml/stable-diffusion-v1-5", torch_dtype=torch.float32
            ).to("cpu")
            pipe.enable_attention_slicing()
        log.info("Stable Diffusion loaded ✅")
        return True
    except Exception as e:
        log.error(f"SD load failed: {e}")
        if STRICT_MODE: sys.exit(1)
        return False

def generate_image(atmosphere: str, chapter: str, location: str):
    key    = f"{atmosphere}:{chapter[:30]}"
    cached = image_cache.get(key)
    if cached: return cached, "cached"

    if pipe is None and not load_sd():
        return None, "sd_unavailable"

    if not sd_semaphore.acquire(blocking=False):
        log.info("SD busy — CSS fallback served")
        return None, "busy"

    try:
        prompt = f"{SCENE_PROMPTS.get(atmosphere, SCENE_PROMPTS['default'])}, {location}, {chapter}"
        log.info(f"Generating: {prompt[:80]}")
        with pipe_lock:
            result = pipe(prompt, negative_prompt=NEGATIVE,
                         num_inference_steps=20, width=512, height=288, guidance_scale=7.5)
        buf = io.BytesIO()
        result.images[0].save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        image_cache.set(key, b64)
        return b64, "stable_diffusion"
    except Exception as e:
        log.error(f"Image gen error: {e}")
        return None, "error"
    finally:
        sd_semaphore.release()

# ─── HANDLER ──────────────────────────────────────────────
class ImageHandler(BaseServiceHandler):

    def do_GET(self):
        if self.path == "/image/health":
            self.send_json({
                "status":       "ok",
                "service":      "image",
                "sd":           SD_AVAILABLE,
                "model_loaded": pipe is not None,
                "cached":       image_cache.count(),
                "cache_limit":  image_cache.limit(),
                "threading":    True,
                "redis":        rate.using_redis,
                "semaphore":    sd_semaphore._value > 0,
                "strict_mode":  STRICT_MODE,
                "max_body":     self.MAX_BODY,
            })
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        rid, blocked = self.guard(rate, max_per_min=10)
        if blocked: return

        body, err = self.parse_body()
        if err:
            return self.send_json({"error": err, "request_id": rid}, 400, rid)

        if self.path == "/image/generate":
            atmosphere = body.get("atmosphere", "default")
            chapter    = str(body.get("chapter",  ""))[:50]
            location   = str(body.get("location", "Millhaven"))[:50]
            if atmosphere not in {"rain","interrogation","revelation","church","default"}:
                atmosphere = "default"

            log.info(f"Image request [{rid}] atm={atmosphere} chapter={chapter[:20]}")
            b64, engine = generate_image(atmosphere, chapter, location)
            if b64:
                self.send_json({"image": b64, "engine": engine, "request_id": rid}, request_id=rid)
            else:
                self.send_json({"image": None, "engine": "css_gradient", "atmosphere": atmosphere, "request_id": rid}, request_id=rid)
        else:
            self.send_response(404); self.end_headers()

if __name__ == "__main__":
    PORT = int(os.environ.get("IMAGE_PORT", 3002))
    log.info(f"Image Server → port {PORT}")
    log.info(f"SD: {'available' if SD_AVAILABLE else 'CSS fallback'} | Redis: {rate.using_redis} | Cache: {image_cache.limit()}")
    ThreadingHTTPServer(("0.0.0.0", PORT), ImageHandler).serve_forever()
