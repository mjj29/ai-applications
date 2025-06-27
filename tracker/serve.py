#!/usr/bin/env python3
"""
Simple HTTP server for testing the Mana Tracker app.
Run this script and navigate to http://localhost:8000 in your browser.
"""
import http.server
import socketserver

PORT = 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        return super().end_headers()

handler = Handler
httpd = socketserver.TCPServer(("", PORT), handler)

print(f"Serving Mana Tracker at http://localhost:{PORT}")
print("Press Ctrl+C to stop the server")

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nServer stopped")
    httpd.server_close()
