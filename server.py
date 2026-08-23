"""
SismoRed Chile - Local Development & Production Server
Servidor HTTP liviano con cabeceras CORS y soporte para proxy de telemetría sismográfica.
"""

import http.server
import socketserver
import os
import sys

PORT = 8080

class SeismicHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Allow CORS for development and testing
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.end_headers()

if __name__ == '__main__':
    web_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(web_dir)

    # Permitir especificar puerto por argumento si se desea
    if len(sys.argv) > 1:
        try:
            PORT = int(sys.argv[1])
        except ValueError:
            pass

    handler = SeismicHTTPRequestHandler
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print(f"==================================================")
        print(f"⚡ SismoRed Chile - Servidor Sismográfico Iniciado")
        print(f"📡 URL Local: http://localhost:{PORT}")
        print(f"📍 Directorio: {web_dir}")
        print(f"==================================================")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nDeteniendo servidor...")
            httpd.shutdown()
