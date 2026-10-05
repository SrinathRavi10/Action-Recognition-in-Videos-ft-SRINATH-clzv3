#!/usr/bin/env python3
"""Tiny static server for Paisa Ledger (the app itself needs no server once installed).
Usage: python3 serve.py [port]   then open http://localhost:8080"""
import http.server, socketserver, sys, os

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', port), H) as s:
    print(f'Paisa Ledger running at http://localhost:{port}  (Ctrl+C to stop)')
    s.serve_forever()
