#!/usr/bin/env python3
"""Tiny static server for the template: python3 serve.py [port]"""
import os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript',
                      '.json': 'application/json', '.html': 'text/html'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *args):
        pass

ThreadingHTTPServer.allow_reuse_address = True
with ThreadingHTTPServer(('', PORT), Handler) as srv:
    print(f'serving on http://localhost:{PORT}', flush=True)
    srv.serve_forever()
