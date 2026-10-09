import os
import sys
import json
import urllib.parse
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
import socket
from datetime import datetime

import downloader_core

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
DOWNLOADS_DIR = os.path.join(BASE_DIR, "downloads")

os.makedirs(WEB_DIR, exist_ok=True)
os.makedirs(DOWNLOADS_DIR, exist_ok=True)


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


class SongbookHTTPRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def log_message(self, format, *args):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {format % args}")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 0. API: 서버 상태 및 IP 정보
        if path == "/api/info":
            local_ip = get_local_ip()
            self.send_json_response({
                "status": "ok",
                "local_ip": local_ip,
                "version": "2.0.0 (PWA & Cloud Ready)"
            })
            return

        # 1. API: 다운로드 내역 조회
        if path == "/api/history":
            history = downloader_core.get_all_history()
            self.send_json_response({"status": "ok", "history": history})
            return

        # 2. 파비콘 요청 무시
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        # 3. 루트 접속 시 web/index.html 서빙
        if path in ("/", "/index.html"):
            self.serve_file(os.path.join(WEB_DIR, "index.html"), "text/html; charset=utf-8")
            return

        # 4. PWA 매니페스트 및 서비스 워커
        if path == "/manifest.json":
            self.serve_file(os.path.join(WEB_DIR, "manifest.json"), "application/manifest+json; charset=utf-8")
            return
        if path == "/sw.js":
            self.serve_file(os.path.join(WEB_DIR, "sw.js"), "application/javascript; charset=utf-8")
            return

        # 5. /web/ 경로 또는 루트 정적 파일 서빙
        rel_web_path = path[5:] if path.startswith("/web/") else path.lstrip("/")
        local_web_file = os.path.join(WEB_DIR, rel_web_path)
        if rel_web_path and os.path.exists(local_web_file) and os.path.isfile(local_web_file):
            self.serve_file(local_web_file)
            return

        # 6. /downloads/ 파일 서빙 (다운로드 헤더 선택적 적용)
        if path.startswith("/downloads/"):
            filename = urllib.parse.unquote(path[11:])
            local_path = os.path.join(DOWNLOADS_DIR, filename)
            if os.path.exists(local_path) and os.path.isfile(local_path):
                is_download = query.get("download", ["0"])[0] == "1"
                self.serve_file(local_path, force_download=is_download, download_filename=filename)
                return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            data = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            data = {}

        if path == "/api/search":
            keywords = data.get("keywords", [])
            limit = int(data.get("limit", 3))
            results = []
            for kw in keywords:
                kw = kw.strip()
                if not kw:
                    continue
                candidates = downloader_core.search_candidates(kw, limit=limit)
                results.append({
                    "keyword": kw,
                    "candidates": candidates
                })
            self.send_json_response({"status": "ok", "results": results})
            return

        if path == "/api/download":
            items = data.get("items", [])
            results = []
            for item in items:
                res = downloader_core.download_item(item, output_dir=DOWNLOADS_DIR)
                results.append(res)
            self.send_json_response({"status": "ok", "results": results})
            return

        if path == "/api/open-downloads":
            try:
                os.startfile(DOWNLOADS_DIR)
                self.send_json_response({"status": "ok", "message": "폴더를 열었습니다."})
            except Exception as e:
                self.send_json_response({"status": "error", "message": str(e)}, code=500)
            return

        if path == "/api/save-songbook-html":
            html_content = data.get("html", "")
            filename = data.get("filename", "songbook_A5.html")
            filepath = os.path.join(DOWNLOADS_DIR, filename)
            try:
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(html_content)
                self.send_json_response({
                    "status": "ok",
                    "filename": filename,
                    "filepath": filepath,
                    "message": f"{filename} 파일로 저장되었습니다."
                })
            except Exception as e:
                self.send_json_response({"status": "error", "message": str(e)}, code=500)
            return

        if path == "/api/save-history":
            history_list = data.get("history", [])
            ok = downloader_core.save_all_history(history_list)
            if ok:
                self.send_json_response({"status": "ok", "message": "성공적으로 저장되었습니다."})
            else:
                self.send_json_response({"status": "error", "message": "CSV 저장 중 오류가 발생했습니다."}, code=500)
            return

        self.send_error(404, "API endpoint not found")

    def serve_file(self, filepath, content_type=None, force_download=False, download_filename=None):
        try:
            if not content_type:
                ext = os.path.splitext(filepath)[1].lower()
                types = {
                    ".html": "text/html; charset=utf-8",
                    ".css": "text/css; charset=utf-8",
                    ".js": "application/javascript; charset=utf-8",
                    ".json": "application/json; charset=utf-8",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".png": "image/png",
                    ".mp3": "audio/mpeg",
                    ".csv": "text/csv; charset=utf-8"
                }
                content_type = types.get(ext, "application/octet-stream")

            with open(filepath, "rb") as f:
                content = f.read()

            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            if force_download:
                fname = download_filename or os.path.basename(filepath)
                encoded_fname = urllib.parse.quote(fname)
                self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{encoded_fname}")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Error serving file: {str(e)}")

    def send_json_response(self, data, code=200):
        try:
            payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(payload)
        except Exception as e:
            print(f"[Error send_json_response] {e}", file=sys.stderr)


def find_free_port(default_port=8000):
    env_port = os.environ.get("PORT")
    if env_port:
        return int(env_port)
    for port in range(default_port, default_port + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('localhost', port)) != 0:
                return port
    return default_port


def run_server():
    port = find_free_port(8000)
    server_address = ('', port)
    httpd = HTTPServer(server_address, SongbookHTTPRequestHandler)
    local_ip = get_local_ip()
    local_url = f"http://localhost:{port}"
    network_url = f"http://{local_ip}:{port}"

    print("=" * 60)
    print("   🎵 세이펜 송북 메이커 & 유튜브 다운로더 서버 시작")
    print(f"   💻 PC 로컬 접속: {local_url}")
    print(f"   📱 스마트폰/모바일 접속 (동일 Wi-Fi): {network_url}")
    print("   ☁️  Hugging Face / Docker 24시간 배포 준비 완료")
    print("   종료하려면 이 창을 닫거나 Ctrl+C를 누르세요.")
    print("=" * 60)

    try:
        webbrowser.open(local_url)
    except Exception:
        pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
        httpd.server_close()


if __name__ == "__main__":
    run_server()

