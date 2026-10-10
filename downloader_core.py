"""
============================================================
 downloader_core.py - 세이펜 송북 메이커 핵심 다운로드 엔진
============================================================

▶ 역할:
  - 유튜브에서 노래 키워드로 영상을 검색하고
  - 선택한 영상을 MP3 음원으로 변환 & 썸네일 이미지로 저장합니다.
  - 세이펜 오디오렉 스티커 번호에 맞게 파일명을 자동 생성합니다.
  - 다운로드 기록을 CSV / JSON 파일로 영구 저장합니다.

▶ 사용하는 외부 도구:
  - yt-dlp : 유튜브 영상 정보 조회 및 음원 추출 (pip install yt-dlp)
  - ffmpeg  : 음원 파일 MP3 포맷 변환 (Windows: ffmpeg.exe / Linux: apt install ffmpeg)

▶ 파일 저장 위치:
  - 다운로드된 MP3, JPG 이미지   : downloads/ 폴더
  - 매핑 기록(한글 엑셀 호환 CSV) : downloads/mapping_history.csv
  - 매핑 기록(JSON)              : downloads/mapping_history.json

▶ 수작업으로 수정할 사항:
  - 검색 영상 길이 제한 변경     : search_candidates() 함수의 max_sec 값 변경 (기본 600초=10분)
  - 영상 후보 개수 변경          : search_candidates() 함수의 limit 기본값 변경 (기본 3개)
  - MP3 음질 변경                : download_item() 함수 내 --audio-quality 값 변경
                                   (0=최고음질, 5=중간음질, 9=최저음질)
============================================================
"""

import os
import sys
import json
import csv
import urllib.request
import urllib.error
import subprocess
from datetime import datetime
import shutil

# ============================================================
#  경로 설정
# ============================================================

# 이 파일(downloader_core.py)이 있는 폴더의 절대 경로
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 다운로드 파일들이 저장되는 폴더 (없으면 자동 생성)
DOWNLOADS_DIR = os.path.join(BASE_DIR, "downloads")
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

# 매핑 기록 파일 경로
CSV_FILE = os.path.join(DOWNLOADS_DIR, "mapping_history.csv")   # 엑셀에서 바로 열 수 있는 CSV
JSON_FILE = os.path.join(DOWNLOADS_DIR, "mapping_history.json") # 프로그램에서 읽는 JSON


# ============================================================
#  외부 도구(yt-dlp, ffmpeg) 실행 경로 자동 탐지 함수
#  - Windows: 폴더 안의 .exe 파일 우선 사용
#  - Linux/Mac(Render 클라우드): 시스템에 설치된 명령어 사용
# ============================================================

def get_ytdlp_cmd():
    """
    yt-dlp 실행 파일의 경로를 반환합니다.
    
    우선순위:
    1. 시스템 PATH에 설치된 yt-dlp (Linux/Mac 클라우드 환경)
    2. 현재 폴더의 yt-dlp.exe (Windows 로컬 환경)
    3. 그 외: 그냥 "yt-dlp" 문자열 반환 (PATH에 있다고 가정)
    """
    yt_bin = shutil.which("yt-dlp")       # 시스템 PATH에서 먼저 찾기
    if yt_bin:
        return yt_bin
    exe_path = os.path.join(BASE_DIR, "yt-dlp.exe")   # Windows 로컬용 .exe
    if os.path.exists(exe_path):
        return exe_path
    return "yt-dlp"                        # 마지막 폴백


def get_ffmpeg_cmd():
    """
    ffmpeg 실행 파일의 경로를 반환합니다.
    
    우선순위:
    1. 시스템 PATH에 설치된 ffmpeg (Linux/Mac 클라우드 환경)
    2. 현재 폴더의 ffmpeg.exe (Windows 로컬 환경)
    3. 그 외: 그냥 "ffmpeg" 문자열 반환
    """
    ffmpeg_bin = shutil.which("ffmpeg")   # 시스템 PATH에서 먼저 찾기
    if ffmpeg_bin:
        return ffmpeg_bin
    exe_path = os.path.join(BASE_DIR, "ffmpeg.exe")   # Windows 로컬용 .exe
    if os.path.exists(exe_path):
        return exe_path
    return "ffmpeg"


# ============================================================
#  유틸리티 함수
# ============================================================

def format_duration(seconds):
    """
    초(seconds) 단위의 숫자를 사람이 읽기 쉬운 시:분:초 문자열로 변환합니다.
    
    예시:
      90   →  "01:30"
      3661 →  "1:01:01"
      None →  "알 수 없음"
    """
    if seconds is None:
        return "알 수 없음"
    try:
        s = int(seconds)
        m, s = divmod(s, 60)   # 초를 분/초로 분리
        h, m = divmod(m, 60)   # 분을 시/분으로 분리
        if h > 0:
            return f"{h}:{m:02d}:{s:02d}"   # 1시간 이상: h:mm:ss
        return f"{m:02d}:{s:02d}"           # 1시간 미만: mm:ss
    except Exception:
        return str(seconds)


# ============================================================
#  유튜브 검색 함수
# ============================================================

def search_candidates(keyword, limit=3, min_sec=15, max_sec=600):
    """
    유튜브에서 키워드로 영상을 검색하여 후보 목록을 반환합니다.
    
    ▶ 매개변수:
      - keyword  : 검색할 노래 제목 또는 유튜브 URL
      - limit    : 반환할 최대 후보 영상 수 (기본 3개)
      - min_sec  : 후보로 포함할 최소 영상 길이 (기본 15초 이상)
      - max_sec  : 후보로 포함할 최대 영상 길이 (기본 600초=10분 이하)
                   ※ 10분보다 긴 영상은 자동으로 제외됩니다.
    
    ▶ 반환값:
      List[Dict] - 각 영상 후보 정보가 담긴 딕셔너리 리스트
      [
        {
          "id": "유튜브 영상ID",
          "title": "영상 제목",
          "duration": 초 단위 길이,
          "duration_str": "mm:ss 형식",
          "channel": "채널명",
          "thumbnail": "썸네일 URL",
          "url": "https://youtube.com/...",
          "is_recommended": True/False  # 가장 적합한 영상이면 True
        },
        ...
      ]
    
    ▶ 수작업 수정 포인트:
      - 최대 길이 변경: max_sec 기본값 수정 (예: 300 = 5분)
      - 검색 결과 개수 변경: limit 기본값 수정 (예: 5 = 5개 후보)
    """
    keyword = keyword.strip()
    if not keyword:
        return []

    # ── 유튜브 URL이 직접 입력된 경우 ──────────────────────────
    # 키워드가 http:// 또는 https://로 시작하면 URL로 판단
    if keyword.startswith("http://") or keyword.startswith("https://"):
        # 재생목록(&list=...) 파라미터 제거 → 단일 영상만 처리
        clean_url = keyword.split("&list=")[0]
        cmd = [
            get_ytdlp_cmd(),
            clean_url,
            "--dump-json",      # 영상 정보를 JSON으로 출력
            "--no-playlist",    # 재생목록 전체 다운로드 방지
            "--quiet",
            "--no-warnings"
        ]
        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, encoding="utf-8", errors="replace")
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
                    "is_recommended": True   # URL 직접 입력 시 항상 추천으로 표시
                }]
        except Exception as e:
            print(f"[Error URL lookup] {e}", file=sys.stderr)
            return []

    # ── 키워드로 유튜브 검색하는 경우 ──────────────────────────
    # limit보다 2개 더 검색해서 길이 필터 적용 후 limit개를 맞춤
    fetch_count = max(limit + 2, 5)
    cmd = [
        get_ytdlp_cmd(),
        f"ytsearch{fetch_count}:{keyword}",  # 예: ytsearch5:뽀로로 동요
        "--dump-json",      # 각 영상 정보를 JSON으로 출력 (한 줄씩)
        "--flat-playlist",  # 빠른 검색 (영상 전체 정보 대신 기본 정보만 가져옴)
        "--quiet",
        "--no-warnings"
    ]

    try:
        # Windows에서 팝업 검은창 방지 설정
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

        # 출력 결과를 줄 단위로 파싱 (각 줄 = 영상 1개의 JSON)
        lines = [line.strip() for line in proc.stdout.strip().splitlines() if line.strip()]
        candidates = []
        for line in lines:
            try:
                entry = json.loads(line)
                vid = entry.get("id")
                if not vid:
                    continue    # 영상 ID 없으면 건너뜀

                dur = entry.get("duration")
                # ※ 최대 길이(max_sec, 기본 10분) 초과 영상 제외
                # ▶ 수작업 수정: 이 값을 바꾸면 허용 최대 길이 변경 가능
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
                    "is_recommended": False   # 기본값: 추천 아님 (아래에서 선정)
                })
            except Exception:
                continue    # JSON 파싱 실패 시 건너뜀

        if not candidates:
            return []

        # ── 추천 영상 선정 ──────────────────────────────────────
        # min_sec(15초) 이상 ~ max_sec(600초) 이하인 첫 번째 영상을 추천으로 표시
        recommended_found = False
        for c in candidates:
            dur = c.get("duration")
            if dur is not None and min_sec <= dur <= max_sec:
                c["is_recommended"] = True
                recommended_found = True
                break   # 첫 번째 적합한 영상만 추천으로 설정

        # 적합한 길이의 영상이 없으면 첫 번째 영상을 추천으로 표시
        if not recommended_found and candidates:
            candidates[0]["is_recommended"] = True

        # 요청한 개수만큼만 반환 (기본 3개)
        final_candidates = candidates[:limit]

        # 추천 영상이 상위 limit개 밖에 있으면 맨 마지막 자리를 추천 영상으로 교체
        if recommended_found and not any(c["is_recommended"] for c in final_candidates):
            for c in candidates:
                if c["is_recommended"]:
                    final_candidates[-1] = c
                    break

        return final_candidates

    except Exception as e:
        print(f"[Error search_candidates] {e}", file=sys.stderr)
        return []


# ============================================================
#  썸네일 이미지 다운로드 함수
# ============================================================

def download_thumbnail(video_id, target_jpg_path):
    """
    유튜브 영상의 썸네일 이미지를 다운로드하여 JPG 파일로 저장합니다.
    
    ▶ 매개변수:
      - video_id        : 유튜브 영상 ID (예: "dQw4w9WgXcQ")
      - target_jpg_path : 저장할 JPG 파일의 전체 경로

    ▶ 반환값:
      - True  : 썸네일 다운로드 성공
      - False : 모든 URL에서 다운로드 실패
    
    ▶ 고화질 순서로 시도:
      1. maxresdefault.jpg (최고 화질, 1280x720)
      2. sddefault.jpg     (표준 화질, 640x480)
      3. hqdefault.jpg     (높은 화질, 480x360)
      4. 0.jpg             (기본 썸네일)
    """
    # 고화질 순서로 시도할 썸네일 URL 목록
    urls_to_try = [
        f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
        f"https://i.ytimg.com/vi/{video_id}/sddefault.jpg",
        f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        f"https://img.youtube.com/vi/{video_id}/0.jpg"
    ]

    # 브라우저처럼 보이는 User-Agent 헤더 (차단 방지)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    for url in urls_to_try:
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=8) as response:
                if response.status == 200:
                    data = response.read()
                    # 유튜브가 "없음" 처리로 보내는 작은 빈 이미지(2000바이트 미만) 제외
                    # (마지막 URL은 작아도 저장)
                    if len(data) > 2000 or url == urls_to_try[-1]:
                        with open(target_jpg_path, "wb") as f:
                            f.write(data)
                        return True  # 성공
        except Exception:
            continue    # 실패 시 다음 URL로 시도

    return False  # 모든 URL 실패


# ============================================================
#  MP3 + 썸네일 일괄 다운로드 함수
# ============================================================

def download_item(item, output_dir=DOWNLOADS_DIR):
    """
    단일 영상(item)에서 MP3 음원과 썸네일 이미지를 다운로드합니다.
    파일명은 세이펜 오디오렉 스티커 코드로 저장됩니다.
    
    ▶ 매개변수:
      - item       : 다운로드할 영상 정보 딕셔너리
                     필수 키: saypen_code, video_id 또는 url
                     선택 키: keyword, title
      - output_dir : 저장 폴더 경로 (기본: downloads/)
    
    ▶ 반환값:
      Dict - 다운로드 결과
      {
        "success": True/False,
        "saypen_code": "REC1_1000",
        "mp3_file": "REC1_1000.mp3",
        "jpg_file": "REC1_1000.jpg",
        "error_message": "실패 시 에러 내용"
        ...
      }
    
    ▶ 저장되는 파일 예시:
      downloads/REC1_1000.mp3  ← 세이펜 펜에 넣을 음원
      downloads/REC1_1000.jpg  ← 송북 이미지 카드용 썸네일
    
    ▶ MP3 음질 변경 방법:
      cmd 리스트 안의 "--audio-quality" 값을 수정하세요.
      0 = 최고 음질(320kbps), 5 = 중간, 9 = 최저(64kbps)
    """
    # 세이펜 코드 가져오기 (없으면 현재 시간으로 자동 생성)
    saypen_code = item.get("saypen_code", "").strip()
    if not saypen_code:
        saypen_code = f"SONG_{datetime.now().strftime('%Y%m%d%H%M%S')}"

    # 파일명에 사용할 수 없는 특수문자 제거 (영문자, 숫자, -, _ 만 허용)
    safe_code = "".join(c for c in saypen_code if c.isalnum() or c in ("-", "_")).strip()
    if not safe_code:
        safe_code = "SAY_AUDIO"

    # 영상 URL 구성
    video_id = item.get("video_id") or item.get("id")
    video_url = item.get("url") or f"https://www.youtube.com/watch?v={video_id}"
    keyword = item.get("keyword", "")
    title = item.get("title", "")

    # 저장될 파일 이름 및 경로 (예: REC1_1000.mp3, REC1_1000.jpg)
    mp3_filename = f"{safe_code}.mp3"
    jpg_filename = f"{safe_code}.jpg"
    mp3_filepath = os.path.join(output_dir, mp3_filename)
    jpg_filepath = os.path.join(output_dir, jpg_filename)

    # 결과 딕셔너리 초기화
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

    # ── 1단계: 썸네일(JPG) 다운로드 ──────────────────────────
    try:
        thumb_ok = download_thumbnail(video_id, jpg_filepath)
        result["jpg_exists"] = thumb_ok and os.path.exists(jpg_filepath)
    except Exception as e:
        result["error_message"] += f"[썸네일 다운로드 실패: {e}] "

    # ── 2단계: MP3 음원 다운로드 및 변환 ──────────────────────
    # yt-dlp로 유튜브 영상에서 음원만 추출 후 ffmpeg로 MP3 변환
    output_template = os.path.join(output_dir, f"{safe_code}.%(ext)s")

    ffmpeg_path = get_ffmpeg_cmd()
    cmd = [
        get_ytdlp_cmd(),
        video_url,
        "--no-playlist",               # 재생목록 전체 다운로드 방지
        "-x",                          # 음원만 추출 (영상 파일 제거)
        "--audio-format", "mp3",       # MP3 포맷으로 변환
        "--audio-quality", "0",        # 음질: 0=최고(320kbps) ~ 9=최저
                                       # ▶ 수작업 수정: 값을 바꿔서 음질 조절 가능
        "-o", output_template,         # 출력 파일명 템플릿
        "--no-warnings"
    ]

    # ffmpeg 경로가 절대 경로이고 실제 파일이 있으면 위치를 명시적으로 전달
    if os.path.isabs(ffmpeg_path) and os.path.exists(ffmpeg_path):
        cmd.extend(["--ffmpeg-location", os.path.dirname(ffmpeg_path)])

    try:
        # Windows에서 팝업 검은창 방지
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

        # 변환 성공 여부: 리턴코드가 0이고 mp3 파일이 실제로 생성되었는지 확인
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

    # ── 3단계: 결과를 CSV/JSON 기록에 저장 ────────────────────
    record_mapping(result)

    return result


# ============================================================
#  기록 저장 및 조회 함수
# ============================================================

def record_mapping(record):
    """
    다운로드 결과를 CSV 및 JSON 파일에 누적 저장합니다.
    
    ▶ 동작:
      - 동일한 세이펜 코드(saypen_code)가 이미 있으면 덮어씁니다.
      - 없으면 새 항목으로 추가합니다.
    
    ▶ 저장 파일:
      - downloads/mapping_history.json : 프로그램이 읽는 JSON 형식
      - downloads/mapping_history.csv  : 엑셀에서 바로 열 수 있는 CSV (UTF-8-SIG 한글 호환)
    """
    # 1. JSON 파일 업데이트 (기존 내용 읽기)
    history = []
    if os.path.exists(JSON_FILE):
        try:
            with open(JSON_FILE, "r", encoding="utf-8") as f:
                history = json.load(f)
        except Exception:
            history = []

    # 동일 saypen_code가 이미 있으면 해당 항목을 갱신, 없으면 새로 추가
    updated = False
    for i, item in enumerate(history):
        if item.get("saypen_code") == record.get("saypen_code"):
            history[i] = record
            updated = True
            break
    if not updated:
        history.append(record)

    # JSON 파일에 저장
    try:
        with open(JSON_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Error writing JSON history] {e}", file=sys.stderr)

    # 2. CSV 파일에 한 줄 추가 (엑셀 한글 호환: utf-8-sig)
    csv_headers = [
        "일시", "세이펜코드", "검색키워드", "유튜브제목", "비디오ID",
        "성공여부", "음원파일명", "썸네일파일명", "실패사유", "영상URL"
    ]

    file_exists = os.path.exists(CSV_FILE)
    try:
        with open(CSV_FILE, "a", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(csv_headers)   # 첫 실행 시 헤더 추가
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
    """
    저장된 전체 매핑 및 다운로드 내역을 반환합니다.
    
    ▶ 반환값: List[Dict] - 각 항목의 정보가 담긴 딕셔너리 리스트
    """
    if os.path.exists(JSON_FILE):
        try:
            with open(JSON_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []


def save_all_history(history_list):
    """
    수정된 전체 매핑 내역을 JSON 및 CSV 파일에 덮어쓰기 저장합니다.
    웹 화면의 '매핑 기록' 탭에서 편집 후 저장 시 호출됩니다.
    
    ▶ 매개변수:
      - history_list : 저장할 전체 기록 리스트
    
    ▶ 반환값:
      - True  : 저장 성공
      - False : 저장 실패
    """
    try:
        # 1. JSON 덮어쓰기 저장
        with open(JSON_FILE, "w", encoding="utf-8") as f:
            json.dump(history_list, f, ensure_ascii=False, indent=2)

        # 2. CSV 덮어쓰기 저장 (UTF-8-SIG: 엑셀에서 한글 깨짐 없이 열림)
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
