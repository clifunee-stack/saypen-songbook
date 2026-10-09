# ☁️ 세이펜 송북 24시간 100% 무료 클라우드(Hugging Face) 배포 가이드

내 PC를 24시간 켜둘 필요 없이, **0원(완전 무료)**으로 불특정 다수의 모바일 및 PC 사용자가 언제나 접속할 수 있는 웹 주소를 만드는 단계별 안내서입니다.

---

## 🚀 3분 만에 무료 배포하기 (단계별)

### 1단계: Hugging Face 가입 (1분 소요)
1. [Hugging Face 웹사이트](https://huggingface.co/join)에 접속하여 무료 회원가입을 진행합니다. (신용카드 등록 필요 없음)

### 2단계: 새 Space 생성 (1분 소요)
1. 로그인 후 우측 상단 프로필 클릭 ➡️ **[+ New Space]** 선택.
2. **Space Name**: 원하는 이름을 영문으로 입력 (예: `saypen-songbook`).
3. **SDK**: **Docker** 선택 (가장 중요!).
4. **License**: `mit` 또는 기본 선택.
5. **Space Hardware**: **CPU basic (Free)** 선택 (100% 영구 무료).
6. 하단 **[Create Space]** 버튼 클릭!

### 3단계: 파일 업로드 (1분 소요)
1. 생성된 Space 화면 상단의 **[Files]** 탭 탭/클릭.
2. **[Add file]** ➡️ **[Upload files]** 선택.
3. 내 컴퓨터의 `songbook` 폴더 안의 모든 파일/폴더를 드래그 앤 드롭으로 올립니다:
   - `server.py`
   - `downloader_core.py`
   - `Dockerfile`
   - `requirements.txt`
   - `web/` (폴더 전체 - `index.html`, `app.js`, `style.css`, `manifest.json`, `sw.js`)
4. 하단 **[Commit changes to main]** 버튼 클릭!

---

## 🎉 배포 완료!

- 파일 업로드 후 약 1~2분 정도 자동으로 빌드가 진행되며 **Building ➡️ Running**으로 상태가 변경됩니다.
- 이제 **24시간 365일 어디서나 접속 가능한 공개 URL**(예: `https://your-name-saypen-songbook.hf.space`)이 생성됩니다!
- 이 주소를 카카오톡이나 블로그에 공유하면, 사용자는 스마트폰이나 PC에서 앱으로 설치(PWA), MP3/썸네일 저장, 그리고 인쇄까지 100% 이용할 수 있습니다.
