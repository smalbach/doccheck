#!/usr/bin/env python3
"""
Local OCR server for OCR_ENGINE=unlimited: Baidu Unlimited-OCR on Apple Silicon through MLX.

POST /ocr with a PNG page image as the body; the answer is JSON {"text", "seconds", "tokens"}, where
text is the model's output: one "<|det|>type [x1, y1, x2, y2]<|/det|>content" block per region,
coordinates 0-1000 of the page, tables as HTML. GET /health answers {"model"}.

Setup (once, outside the repository):
    uv venv --python 3.12 ~/.cache/doccheck/mlx-ocr
    VIRTUAL_ENV=~/.cache/doccheck/mlx-ocr uv pip install "mlx-vlm>=0.6.8"
Run:
    ~/.cache/doccheck/mlx-ocr/bin/python scripts/ocr-server.py      # http://127.0.0.1:8765

OCR_MLX_MODEL picks the weights (default mlx-community/Unlimited-OCR-8bit, ~3.7 GB, downloaded on
first use) and OCR_SERVER_PORT the port. It listens on 127.0.0.1 only and handles one page at a time.
"""
import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from mlx_vlm import generate, load
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config

MODEL = os.environ.get("OCR_MLX_MODEL", "mlx-community/Unlimited-OCR-8bit")
PORT = int(os.environ.get("OCR_SERVER_PORT", "8765"))
# A page of a dense invoice is ~500-1500 tokens; the cap stops the rare page that loops.
MAX_TOKENS = int(os.environ.get("OCR_MAX_TOKENS", "6000"))
MAX_BODY = 40 * 1024 * 1024

model, processor = load(MODEL)
# Without the chat template the model ignores the image and produces unrelated text.
PROMPT = apply_chat_template(processor, load_config(MODEL), "document parsing.", num_images=1)
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"model": MODEL})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/ocr":
            return self._send(404, {"error": "not found"})
        length = int(self.headers.get("content-length", "0"))
        if not 0 < length <= MAX_BODY:
            return self._send(400, {"error": "send a PNG image of up to 40 MB as the body"})
        image = self.rfile.read(length)
        if not image.startswith(b"\x89PNG"):
            return self._send(400, {"error": "the body must be a PNG image"})
        with tempfile.NamedTemporaryFile(suffix=".png") as f:
            f.write(image)
            f.flush()
            with lock:
                started = time.time()
                try:
                    result = generate(model, processor, PROMPT, [f.name], max_tokens=MAX_TOKENS, temperature=0.0, verbose=False)
                except Exception as err:  # report to the caller instead of dropping the connection
                    return self._send(500, {"error": str(err)})
        self._send(200, {"text": result.text, "seconds": round(time.time() - started, 2), "tokens": result.generation_tokens})

    def log_message(self, fmt, *args):
        sys.stderr.write("ocr-server: " + (fmt % args) + "\n")


if __name__ == "__main__":
    print(f"ocr-server: {MODEL} on http://127.0.0.1:{PORT}", file=sys.stderr)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
