"""Local server: python -m http.server, plus GitHub Pages' 404.html fallback.

A row's Edit address (health/nutrition/<name>/) has no file of its own; Pages
answers it with 404.html, and so does this. Usage: python scripts/serve.py [port]
"""
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # Always revalidate, so an edited file shows on the next reload.
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        if code != 404 or self.command != 'GET':
            return super().send_error(code, message, explain)
        with open(os.path.join(ROOT, '404.html'), 'rb') as f:
            body = f.read()
        self.send_response(404)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    http.server.ThreadingHTTPServer(('', port), Handler).serve_forever()
