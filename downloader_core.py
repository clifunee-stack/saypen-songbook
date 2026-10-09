import os
import sys
import json
import csv
import urllib.request
import urllib.error
import subprocess
from datetime import datetime

import shutil

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOADS_DIR = os.path.join(BASE_DIR, "downloads")

os.makedirs(DOWNLOADS_DIR, exist_ok=True)

CSV_FILE = os.path.join(DOWNLOADS_DIR, "mapping_history.csv")
JSON_FILE = os.path.join(DOWNLOADS_DIR, "mapping_history.json")


def get_ytdlp_cmd():
    yt_bin = shutil.which("yt-dlp")
    if yt_bin:
        return yt_bin
    exe_path = os.path.join(BASE_DIR, "yt-dlp.exe")
    if os.path.exists(exe_path):
        return exe_path
    return "yt-dlp"


def get_ffmpeg_cmd():
    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        return ffmpeg_bin
    exe_path = os.path.join(BASE_DIR, "ffmpeg.exe")
    if os.path.exists(exe_path):
        return exe_path
    return "ffmpeg"



def format_duration(seconds):
    """초 단위 시간을 mm:ss 또는 hh:mm:ss 로 포맷"""
    if seconds is None:
        return "알 수 없음"
    try:
        s = int(seconds)
        m, s = divmod(s, 60)
        h, m = divmod(m, 60)
        if h > 0:
            return f"{h}:{m:02d}:{s:02d}"
        return f"{m:02d}:{s:02d}"
    except Exception:
        return str(seconds)


def search_candidates(keyword, limit=3, min_sec=15, max_sec=600):
    """
    주어진 키워드로 유튜브 상위 영상을 검색하여 후보 목록(기본 3개)을 반환합니다.
    """
    keyword = keyword.strip()
    if not keyword:
        return []

    # 키워드가 이미 유튜브 URL인 경우 단일 후보 반환
    if keyword.startswith("http://") or keyword.startswith("https://"):
        clean_url = keyword.split("&list=")[0]
        cmd = [
            get_ytdlp_cmd(),
            clean_url,
            "--dump-json",
            "--no-playlist",
            "--quiet",
            "--no-warnings"
        ]
        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
            if res.returncode == 0 and res.stdout.strip():
                info = json.loads(res.stdout.strip().splitlines()[0])
                vid = info.get("id")
                dur = info.get("duration", 0)
                thumb = info.get("thumbnail") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                return [{
                    "keyword": keyword,
                    "id": vid,
                    "title": info.get("title", "제목 없음"),
                    "duration": dur,
                    "duration_str": format_duration(dur),
                    "channel": info.get("uploader") or info.get("channel", "알 수 없음"),
                    "thumbnail": thumb,
                    "url": f"https://www.youtube.com/watch?v={vid}",
                    "is_recommended": True
                }]
        except Exception as e:
            print(f"[Error URL lookup] {e}", file=sys.stderr)
            return []

    # 키워드 검색 (ytsearch{fetch_count}:{keyword})
    # 적절한 길이(30~600초)의 영상을 찾기 위해 상위 5개를 탐색 후 3개 반환
    fetch_count = max(limit + 2, 5)
    cmd = [
        get_ytdlp_cmd(),
        f"ytsearch{fetch_count}:{keyword}",
        "--dump-json",
        "--flat-playlist",
        "--quiet",
        "--no-warnings"
    ]

    try:
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            startupinfo=startupinfo
        )
        
        lines = [line.strip() for line in proc.stdout.strip().splitlines() if line.strip()]
        candidates = []
        for line in lines:
            try:
                entry = json.loads(line)
                vid = entry.get("id")
                if not vid:
                    continue
                dur = entry.get("duration")
                # 최대 10분(600초) 초과 영상 제외
                if dur is not None and dur > max_sec:
                    continue
                thumb = entry.get("thumbnail") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                
                candidates.append({
                    "keyword": keyword,
                    "id": vid,
                    "title": entry.get("title", "제목 없음"),
                    "duration": dur,
                    "duration_str": format_duration(dur),
                    "channel": entry.get("uploader") or entry.get("channel", "알 수 없음"),
                    "thumbnail": thumb,
                    "url": f"https://www.youtube.com/watch?v={vid}",
                    "is_recommended": False
                })
            except Exception:
                continue

        if not candidates:
            return []

        # 추천 영상 선정: min_sec 이상 ~ max_sec 이하 중 가장 순위 높은 영상
        recommended_found = False
        for c in candidates:
            dur = c.get("duration")
            if dur is not None and min_sec <= dur <= max_sec:
                c["is_recommended"] = True
                recommended_found = True
                break
        if not recommended_found and candidates:
            candidates[0]["is_recommended"] = True

        # 요청한 개수(기본 3개)만큼 추리기
        final_candidates = candidates[:limit]
        
        # 만약 추천된 영상이 상위 limit개 밖이었다면 마지막 요소를 추천 영상으로 교체
        if recommended_found and not any(c["is_recommended"] for c in final_candidates):
            for c in candidates:
                if c["is_recommended"]:
                    final_candidates[-1] = c
                    break

        return final_candidates

    except Exception as e:
        print(f"[Error search_candidates] {e}", file=sys.stderr)
        return []


def download_thumbnail(video_id, target_jpg_path):
    """
    유튜브 썸네일을 고화질 순서(maxresdefault -> sddefault -> hqdefault)로 다운로드합니다.
    """
    urls_to_try = [
        f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
        f"https://i.ytimg.com/vi/{video_id}/sddefault.jpg",
        f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        f"https://img.youtube.com/vi/{video_id}/0.jpg"
    ]
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    for url in urls_to_try:
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=8) as response:
                if response.status == 200:
                    data = response.read()
                    # 404를 대신하는 1x1 또는 작은 빈 이미지(유튜브 플레이스홀더: 약 1097바이트 미만) 제외
                    if len(data) > 2000 or url == urls_to_try[-1]:
                        with open(target_jpg_path, "wb") as f:
                            f.write(data)
                        return True
        except Exception:
            continue

    return False


def download_item(item, output_dir=DOWNLOADS_DIR):
    """
    단일 영상(item)을 세이펜 코드명으로 MP3 및 썸네일 다운로드합니다.
    """
    saypen_code = item.get("saypen_code", "").strip()
    if not saypen_code:
        saypen_code = f"SONG_{datetime.now().strftime('%Y%m%d%H%M%S')}"

    # 파일명 안전 처리
    safe_code = "".join(c for c in saypen_code if c.isalnum() or c in ("-", "_")).strip()
    if not safe_code:
        safe_code = "SAY_AUDIO"

    video_id = item.get("video_id") or item.get("id")
    video_url = item.get("url") or f"https://www.youtube.com/watch?v={video_id}"
    keyword = item.get("keyword", "")
    title = item.get("title", "")

    mp3_filename = f"{safe_code}.mp3"
    jpg_filename = f"{safe_code}.jpg"
    mp3_filepath = os.path.join(output_dir, mp3_filename)
    jpg_filepath = os.path.join(output_dir, jpg_filename)

    result = {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "saypen_code": safe_code,
        "keyword": keyword,
        "youtube_title": title,
        "video_id": video_id,
        "video_url": video_url,
        "success": False,
        "mp3_file": mp3_filename,
        "jpg_file": jpg_filename,
        "error_message": "",
        "mp3_exists": False,
        "jpg_exists": False
    }

    # 1. 썸네일 다운로드
    try:
        thumb_ok = download_thumbnail(video_id, jpg_filepath)
        result["jpg_exists"] = thumb_ok and os.path.exists(jpg_filepath)
    except Exception as e:
        result["error_message"] += f"[썸네일 다운로드 실패: {e}] "

    # 2. MP3 다운로드 및 변환 (yt-dlp + ffmpeg)
    output_template = os.path.join(output_dir, f"{safe_code}.%(ext)s")
    
    ffmpeg_path = get_ffmpeg_cmd()
    cmd = [
        get_ytdlp_cmd(),
        video_url,
        "--no-playlist",
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "-o", output_template,
        "--no-warnings"
    ]

    if os.path.isabs(ffmpeg_path) and os.path.exists(ffmpeg_path):
        cmd.extend(["--ffmpeg-location", os.path.dirname(ffmpeg_path)])

    try:
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            startupinfo=startupinfo
        )

        if proc.returncode == 0 and os.path.exists(mp3_filepath):
            result["success"] = True
            result["mp3_exists"] = True
        else:
            err = proc.stderr.strip()
            if not err:
                err = proc.stdout.strip()
            result["success"] = False
            result["error_message"] += f"[MP3 변환 실패: {err[:300]}]"
    except Exception as e:
        result["success"] = False
        result["error_message"] += f"[실행 에러: {str(e)}]"

    # 매핑 로그에 영구 저장 (성공/실패 상관없이 기록)
    record_mapping(result)

    return result


def record_mapping(record):
    """
    CSV 및 JSON 파일에 매핑/다운로드 결과를 누적 저장합니다.
    """
    # 1. JSON 파일 업데이트
    history = []
    if os.path.exists(JSON_FILE):
        try:
            with open(JSON_FILE, "r", encoding="utf-8") as f:
                history = json.load(f)
        except Exception:
            history = []

    # 동일 saypen_code가 이미 있으면 갱신, 없으면 추가
    updated = False
    for i, item in enumerate(history):
        if item.get("saypen_code") == record.get("saypen_code"):
            history[i] = record
            updated = True
            break
    if not updated:
        history.append(record)

    try:
        with open(JSON_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Error writing JSON history] {e}", file=sys.stderr)

    # 2. CSV 파일 업데이트
    csv_headers = [
        "일시", "세이펜코드", "검색키워드", "유튜브제목", "비디오ID",
        "성공여부", "음원파일명", "썸네일파일명", "실패사유", "영상URL"
    ]
    
    file_exists = os.path.exists(CSV_FILE)
    try:
        with open(CSV_FILE, "a", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(csv_headers)
            writer.writerow([
                record.get("timestamp"),
                record.get("saypen_code"),
                record.get("keyword"),
                record.get("youtube_title"),
                record.get("video_id"),
                "성공" if record.get("success") else "실패",
                record.get("mp3_file"),
                record.get("jpg_file"),
                record.get("error_message"),
                record.get("video_url")
            ])
    except Exception as e:
        print(f"[Error writing CSV history] {e}", file=sys.stderr)


def get_all_history():
    """저장된 전체 매핑 및 다운로드 내역 반환"""
    if os.path.exists(JSON_FILE):
        try:
            with open(JSON_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []


def save_all_history(history_list):
    """
    수정된 전체 매핑 내역을 JSON 및 CSV에 덮어쓰기 저장합니다.
    """
    try:
        # 1. JSON 저장
        with open(JSON_FILE, "w", encoding="utf-8") as f:
            json.dump(history_list, f, ensure_ascii=False, indent=2)

        # 2. CSV 저장 (UTF-8-SIG 한글 엑셀 호환)
        csv_headers = [
            "일시", "세이펜코드", "검색키워드", "유튜브제목", "비디오ID",
            "성공여부", "음원파일명", "썸네일파일명", "실패사유", "영상URL"
        ]
        with open(CSV_FILE, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(csv_headers)
            for item in history_list:
                writer.writerow([
                    item.get("timestamp", ""),
                    item.get("saypen_code", ""),
                    item.get("keyword", ""),
                    item.get("youtube_title", ""),
                    item.get("video_id", ""),
                    "성공" if item.get("success") else "실패",
                    item.get("mp3_file", ""),
                    item.get("jpg_file", ""),
                    item.get("error_message", ""),
                    item.get("video_url", "")
                ])
        return True
    except Exception as e:
        print(f"[Error save_all_history] {e}", file=sys.stderr)
        return False

