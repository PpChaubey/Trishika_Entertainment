"""
shared.py — Common utilities imported by audio_server.py and image_server.py
Eliminates duplication across services
"""
import json, os, time, threading, logging, uuid
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler

# ─── JSON STRUCTURED LOGGER ───────────────────────────────
class JSONFormatter(logging.Formatter):
    def format(self, record):
        entry = {
            "time":    self.formatTime(record),
            "level":   record.levelname,
            "service": getattr(record, "service", "unknown"),
            "msg":     record.getMessage(),
        }
        if hasattr(record, "request_id"):
            entry["request_id"] = record.request_id
        return json.dumps(entry)

def make_logger(service_name: str) -> logging.LoggerAdapter:
    log = logging.getLogger(service_name)
    log.setLevel(logging.INFO)
    if not log.handlers:
        h = logging.StreamHandler()
        h.setFormatter(JSONFormatter())
        log.addHandler(h)
    return logging.LoggerAdapter(log, {"service": service_name})

# ─── RATE LIMITER (Redis + in-memory fallback) ────────────
class RateLimiter:
    def __init__(self, service: str, redis_url: str = None, log=None):
        self._service    = service
        self._log        = log
        self._map        = {}
        self._lock       = threading.Lock()
        self._redis      = None
        self.using_redis = False

        threading.Thread(target=self._auto_clear, daemon=True).start()

        if redis_url:
            try:
                import redis as _redis
                r = _redis.from_url(redis_url, decode_responses=True)
                r.ping()
                self._redis      = r
                self.using_redis = True
                if log: log.info("Redis rate limiter connected")
            except Exception as e:
                if log: log.warning(f"Redis unavailable ({e}) — in-memory fallback")

    def _auto_clear(self):
        """Clear in-memory map every hour — simple and readable"""
        while True:
            time.sleep(3600)
            with self._lock:
                self._map.clear()
            if self._log: self._log.info("In-memory rate map cleared")

    def check(self, ip: str, max_per_min: int = 20) -> bool:
        if self._redis:
            try:
                key  = f"rate:{self._service}:{ip}"
                pipe = self._redis.pipeline()
                pipe.incr(key)
                pipe.expire(key, 60)
                count, _ = pipe.execute()
                return count > max_per_min
            except Exception:
                pass
        now = time.time()
        with self._lock:
            e = self._map.get(ip, {"count": 0, "start": now})
            if now - e["start"] > 60: e = {"count": 1, "start": now}
            else: e["count"] += 1
            self._map[ip] = e
            return e["count"] > max_per_min

# ─── LRU CACHE ────────────────────────────────────────────
class LRUCache:
    def __init__(self, limit: int = 50, log=None):
        self._store = OrderedDict()
        self._limit = limit
        self._lock  = threading.Lock()
        self._log   = log

    def get(self, key: str):
        with self._lock:
            if key not in self._store: return None
            self._store.move_to_end(key)
            return self._store[key]

    def set(self, key: str, value):
        with self._lock:
            if key in self._store: self._store.move_to_end(key)
            self._store[key] = value
            if len(self._store) > self._limit:
                evicted = next(iter(self._store))
                del self._store[evicted]
                if self._log: self._log.info(f"LRU evicted: {evicted}")

    def count(self) -> int: return len(self._store)
    def limit(self) -> int: return self._limit

# ─── BASE HANDLER (auth, CORS, request-ID, body parse) ────
class BaseServiceHandler(BaseHTTPRequestHandler):
    SERVICE_TOKEN = os.environ.get("SERVICE_TOKEN", "thriller-secret-2026")
    MAX_BODY      = int(os.environ.get("MAX_BODY_BYTES", "50000"))  # configurable via env

    def log_message(self, fmt, *args): pass  # use structured logger only

    def get_request_id(self) -> str:
        return self.headers.get("X-Request-ID", str(uuid.uuid4())[:8])

    def get_ip(self) -> str:
        return self.headers.get("X-Forwarded-For", self.client_address[0])

    def check_auth(self) -> bool:
        return self.headers.get("X-Service-Token", "") == self.SERVICE_TOKEN

    def send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Service-Token, X-Request-ID")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors()
        self.end_headers()

    def send_json(self, data: dict, code: int = 200, request_id: str = None):
        payload = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_cors()
        self.send_header("Content-Length", len(payload))
        if request_id:
            self.send_header("X-Request-ID", request_id)
        self.end_headers()
        self.wfile.write(payload)

    def parse_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length > self.MAX_BODY:
                return None, f"Request too large (max {self.MAX_BODY} bytes)"
            return json.loads(self.rfile.read(length)), None
        except (json.JSONDecodeError, ValueError) as e:
            return None, f"Invalid JSON: {e}"

    def guard(self, rate_limiter: RateLimiter, max_per_min: int = 20):
        """Auth + rate limit in one call. Returns (request_id, blocked)"""
        rid = self.get_request_id()
        if not self.check_auth():
            self.send_json({"error": "Unauthorized", "request_id": rid}, 401, rid)
            return rid, True
        if rate_limiter.check(self.get_ip(), max_per_min):
            self.send_json({"error": "Rate limit exceeded", "request_id": rid}, 429, rid)
            return rid, True
        return rid, False
