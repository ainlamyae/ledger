#!/usr/bin/env python3
"""Local dev server that mimics GitHub Pages' 404.html fallback, so client-side
router deep links (e.g. /health/physique/2026-10-08/) work like they do in prod."""
import http.server
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_head(self):
        path = self.translate_path(self.path)
        if not os.path.exists(path) or os.path.isdir(path) and not os.path.exists(
            os.path.join(path, "index.html")
        ):
            self.path = "/404.html"
        return super().send_head()


if __name__ == "__main__":
    port = 8000
    server = http.server.HTTPServer(("", port), Handler)
    print(f"Serving {ROOT} at http://localhost:{port} (with 404.html fallback)")
    server.serve_forever()
