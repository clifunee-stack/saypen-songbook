/* =========================================================
   세이펜 송북 메이커 & 유튜브 다운로더 프론트엔드 로직
   ========================================================= */

// 전역 상태
const state = {
  currentTab: 'tab-download',
  searchedResults: [], // [{ keyword, saypen_code, candidates: [...], selectedIndex: 0 }]
  songbookItems: [],   // 송북에 들어갈 카드 목록 [{ id, title, saypen_code, thumb_url }]
  songbookSettings: {
    title: '뽀로로 사운드 카드',
    icon: '🐧',
    font: 'font-nanum-round',
    cardsPerPage: 8,
    binderMargin: 12,
    paperType: 'a4-double-132', // 'a4-double-132', 'a4-single-132', 'a4-full-portrait', 'a5-direct'
    showCutLines: true,
    showPunchGuide: true,
    showSaypenCode: true,
    showPlayIcon: true
  }
};

// DOM 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initDownloadHandlers();
  initSongbookHandlers();
  initHistoryHandlers();
  initPwaAndBrowserDownload();

  // 기본 예시 데이터로 송북 미리보기 초기화
  loadDefaultSongbookDemo();
});

/* =========================================================
   1. 탭 네비게이션
   ========================================================= */
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });
}

function switchTab(tabId) {
  state.currentTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === tabId);
  });

  if (tabId === 'tab-songbook') {
    // 바인더 송북 탭으로 넘어갈 때, 검색된 결과가 있으면 검색 키워드와 이미지를 순차 자동 반영
    if (state.searchedResults && state.searchedResults.length > 0) {
      syncSongbookFromSearchedResults(false);
    }
    renderSongbookPages();
  } else if (tabId === 'tab-history') {
    loadHistory();
  }
}

/* =========================================================
   2. 음원 & 썸네일 다운로드 로직
   ========================================================= */
function initDownloadHandlers() {
  const btnLoadSample = document.getElementById('btn-load-sample');
  const btnSearch = document.getElementById('btn-search');
  const btnStartDownload = document.getElementById('btn-start-download');
  const btnStartDownloadBottom = document.getElementById('btn-start-download-bottom');
  const btnGoSongbook = document.getElementById('btn-go-songbook');
  const btnOpenFolder = document.getElementById('btn-open-folder');
  const keywordsInput = document.getElementById('keywords-input');
  const lineNumbers = document.getElementById('line-numbers');
  const countBadge = document.getElementById('keyword-count-badge');

  // 실시간 라인 번호 및 곡 수 카운트 갱신 함수
  function updateLineNumbers() {
    if (!keywordsInput || !lineNumbers) return;
    const text = keywordsInput.value;
    const lines = text.split('\n');
    const validCount = lines.filter(l => l.trim().length > 0).length;

    let lineNumsStr = '';
    const lineCount = Math.max(lines.length, 1);
    for (let i = 1; i <= lineCount; i++) {
      lineNumsStr += i + '\n';
    }
    lineNumbers.textContent = lineNumsStr.trimEnd();

    if (countBadge) {
      countBadge.textContent = `${validCount}곡 입력됨`;
      countBadge.className = validCount > 0 ? 'badge badge-success' : 'badge badge-info';
    }
  }

  if (keywordsInput && lineNumbers) {
    keywordsInput.addEventListener('input', updateLineNumbers);
    keywordsInput.addEventListener('scroll', () => {
      lineNumbers.scrollTop = keywordsInput.scrollTop;
    });
    updateLineNumbers();
  }

  // 키워드별 검색 후보 캐시 맵 (변경된 키워드만 부분 재검색)
  const cachedKeywordMap = {};

  // 예시 불러오기 버튼
  btnLoadSample.addEventListener('click', () => {
    const sampleKeywords = [
      "뽀롱뽀롱 오프닝곡",
      "개굴개굴개구리",
      "거미가 줄을타고",
      "나비야 나비야",
      "곰 세마리",
      "달팽이 집을 지읍시다",
      "엄마 돼지 아기 돼지",
      "머리 어깨 무릎 발"
    ].join('\n');
    keywordsInput.value = sampleKeywords;
    // 캐릭터 이름 예시도 자동 입력
    const charInput = document.getElementById('character-name');
    if (charInput && !charInput.value.trim()) {
      charInput.value = '뽀로로';
      const defaultTitle = '뽀로로 사운드 카드';
      state.songbookSettings.title = defaultTitle;
      const bookTitleInput = document.getElementById('book-title');
      if (bookTitleInput) bookTitleInput.value = defaultTitle;
    }
    updateLineNumbers();
  });

  // 캐릭터/시리즈 이름 입력 시 송북 타이틀 초기값으로 자동 연동
  const charInput = document.getElementById('character-name');
  if (charInput) {
    charInput.addEventListener('input', () => {
      const val = charInput.value.trim();
      if (val) {
        const generatedTitle = `${val} 사운드 카드`;
        state.songbookSettings.title = generatedTitle;
        const bookTitleInput = document.getElementById('book-title');
        if (bookTitleInput) {
          bookTitleInput.value = generatedTitle;
        }
      }
    });
  }

  // 시리즈 보관함 (저장/불러오기) 초기화
  initSeriesStorageHandlers();

  // 상위 3개 영상 후보 검색 (스마트 부분 재검색 지원)
  btnSearch.addEventListener('click', async () => {
    const rawText = keywordsInput.value.trim();
    if (!rawText) {
      alert('검색할 키워드를 1개 이상 입력해주세요.');
      return;
    }

    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
      alert('검색할 키워드를 입력해주세요.');
      return;
    }

    // 캐릭터/시리즈 이름 가져오기 (있으면 키워드에 자동 붙임)
    const characterName = (document.getElementById('character-name')?.value || '').trim();

    // 접두사 고정 REC1_, 시작 번호 입력값 사용
    const prefix = 'REC1_';
    const rawNumStr = document.getElementById('saypen-start-num').value.trim() || '1000';
    let startNum = parseInt(rawNumStr, 10);
    if (isNaN(startNum)) startNum = 1000;
    const padLen = rawNumStr.length;

    // 검색에 사용할 실제 키워드 = 노래제목 + 캐릭터명 (캐릭터명이 있고, 키워드가 URL이 아닌 경우만)
    const buildSearchKey = (kw) => {
      if (kw.startsWith('http://') || kw.startsWith('https://')) return kw;
      if (characterName && !kw.includes(characterName)) return `${kw} ${characterName}`;
      return kw;
    };

    // 각 줄별 원본 키워드 → 실제 검색 키워드 매핑
    const searchKeys = lines.map(kw => buildSearchKey(kw));

    // 새로 검색이 필요한 검색키워드만 추출
    const keysToFetch = searchKeys.filter(sk => !cachedKeywordMap[sk] || !cachedKeywordMap[sk].candidates || cachedKeywordMap[sk].candidates.length === 0);

    if (keysToFetch.length > 0) {
      const searchLoadingBox = document.getElementById('search-loading');
      const searchStepText = document.getElementById('search-progress-step-text');
      const searchPercent = document.getElementById('search-progress-percent');
      const searchBarFill = document.getElementById('search-progress-bar-fill');
      const searchCurrent = document.getElementById('search-progress-current');
      const searchRemaining = document.getElementById('search-progress-remaining');

      searchLoadingBox.classList.remove('hidden');
      document.getElementById('candidates-container').classList.add('hidden');
      document.getElementById('download-complete-box').classList.add('hidden');
      btnSearch.disabled = true;

      const totalFetch = keysToFetch.length;
      try {
        for (let i = 0; i < totalFetch; i++) {
          const sk = keysToFetch[i];
          const currentStep = i + 1;
          const leftCount = totalFetch - currentStep;
          const percentVal = Math.round((i / totalFetch) * 100);

          if (searchStepText) searchStepText.textContent = `총 ${totalFetch}개 중 ${currentStep}번째 검색 작업 중...`;
          if (searchPercent) searchPercent.textContent = `${percentVal}%`;
          if (searchBarFill) searchBarFill.style.width = `${percentVal}%`;
          if (searchCurrent) searchCurrent.textContent = `🔎 "${sk}" 유튜브 후보 탐색 중...`;
          if (searchRemaining) searchRemaining.textContent = `${leftCount}개 남음`;

          const response = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords: [sk], limit: 3 })
          });

          const data = await response.json();
          if (data.status === 'ok' && data.results) {
            data.results.forEach(res => {
              const candidates = res.candidates || [];
              let defaultIdx = candidates.findIndex(c => c.is_recommended);
              if (defaultIdx === -1) defaultIdx = 0;
              cachedKeywordMap[res.keyword] = { candidates, selectedIndex: defaultIdx };
            });
          }
        }

        if (searchBarFill) searchBarFill.style.width = '100%';
        if (searchPercent) searchPercent.textContent = '100%';
        if (searchStepText) searchStepText.textContent = '모든 검색이 완료되었습니다!';
        if (searchRemaining) searchRemaining.textContent = '0개 남음';
      } catch (err) {
        alert('검색 중 오류가 발생했습니다: ' + err.message);
        return;
      } finally {
        searchLoadingBox.classList.add('hidden');
        btnSearch.disabled = false;
      }
    }

    // 최종 결과 구성 (원본 키워드 기준으로 표시, 세이펜 코드 순번 매핑)
    state.searchedResults = lines.map((kw, idx) => {
      const sk = searchKeys[idx];
      const codeNum = startNum + idx;
      const paddedNum = String(codeNum).padStart(padLen, '0');
      const saypenCode = `${prefix}${paddedNum}`;
      const cachedData = cachedKeywordMap[sk] || { candidates: [], selectedIndex: 0 };

      return {
        keyword: kw,           // 화면에 표시할 원본 키워드 (곡 이름)
        search_key: sk,        // 실제 검색에 사용한 키워드 (곡 이름 + 캐릭터명)
        saypen_code: saypenCode,
        candidates: cachedData.candidates,
        selectedIndex: cachedData.selectedIndex
      };
    });

    renderCandidateList();
    document.getElementById('candidates-container').classList.remove('hidden');

    // 검색 완료 즉시 바인더 송북 제작 탭에도 검색 키워드 & 이미지 자동 순차 동기화
    syncSongbookFromSearchedResults(false);
  });

  // 일괄 다운로드 시작
  const startDownload = async () => {
    if (!state.searchedResults || state.searchedResults.length === 0) {
      alert('선택할 영상 후보가 없습니다.');
      return;
    }

    // 파일명 저장 방식 (스티커 번호 or 검색 키워드 단어)
    const filenameType = document.querySelector('input[name="filename-type"]:checked')?.value || 'saypen_code';

    // 다운로드할 대상 추출
    const itemsToDownload = [];
    for (const item of state.searchedResults) {
      if (!item.candidates || item.candidates.length === 0) continue;
      const selectedCand = item.candidates[item.selectedIndex];
      if (!selectedCand) continue;

      itemsToDownload.push({
        saypen_code: item.saypen_code,
        keyword: item.keyword,
        video_id: selectedCand.id,
        title: selectedCand.title,
        url: selectedCand.url,
        thumbnail: selectedCand.thumbnail,
        filename_type: filenameType
      });
    }

    if (itemsToDownload.length === 0) {
      alert('다운로드할 영상이 없습니다.');
      return;
    }

    // UI 진행 상태 표시
    const progressBox = document.getElementById('download-progress-box');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressCurrentItem = document.getElementById('progress-current-item');
    const progressPercent = document.getElementById('progress-percent');
    
    progressBox.classList.remove('hidden');
    btnStartDownload.disabled = true;
    if (btnStartDownloadBottom) btnStartDownloadBottom.disabled = true;

    progressBarFill.style.width = '10%';
    progressPercent.textContent = '10%';
    progressCurrentItem.textContent = `총 ${itemsToDownload.length}곡 다운로드 준비 중...`;

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsToDownload })
      });

      const data = await response.json();
      if (data.status !== 'ok') {
        throw new Error(data.message || '다운로드 실패');
      }

      progressBarFill.style.width = '100%';
      progressPercent.textContent = '100%';
      progressCurrentItem.textContent = '완료되었습니다!';

      // 다운로드 완료 결과 처리
      const results = data.results || [];
      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;

      document.getElementById('download-summary-text').textContent = 
        `총 ${results.length}곡 중 ${successCount}곡 성공` + (failCount > 0 ? ` (${failCount}곡 실패 - 기록 탭에서 확인 가능)` : '');
      
      document.getElementById('download-complete-box').classList.remove('hidden');

      // 성공한 곡들을 A5 송북 리스트에 추가 (검색 키워드 우선 사용 및 실제 저장된 썸네일 경로 매핑)
      const newSongbookCards = results.filter(r => r.success).map(r => ({
        id: r.saypen_code,
        title: r.keyword || r.youtube_title, // 사용자가 입력한 검색 키워드를 카드 타이틀로 지정
        youtube_title: r.youtube_title,
        saypen_code: r.saypen_code,
        thumb_url: `/downloads/${encodeURIComponent(r.jpg_file)}`,
        mp3_file: r.mp3_file,
        jpg_file: r.jpg_file
      }));

      if (newSongbookCards.length > 0) {
        state.songbookItems = newSongbookCards;
        renderSongbookPages();
      }

    } catch (err) {
      alert('다운로드 도중 에러가 발생했습니다: ' + err.message);
    } finally {
      progressBox.classList.add('hidden');
      btnStartDownload.disabled = false;
      if (btnStartDownloadBottom) btnStartDownloadBottom.disabled = false;
    }
  };

  btnStartDownload.addEventListener('click', startDownload);
  if (btnStartDownloadBottom) {
    btnStartDownloadBottom.addEventListener('click', startDownload);
  }

  // 완료 후 송북 바로가기
  btnGoSongbook.addEventListener('click', () => {
    switchTab('tab-songbook');
  });

  // 폴더 열기
  btnOpenFolder.addEventListener('click', async () => {
    await fetch('/api/open-downloads', { method: 'POST' });
  });
}

// 영상 후보 카드 렌더링
function renderCandidateList() {
  const container = document.getElementById('candidates-list');
  container.innerHTML = '';

  state.searchedResults.forEach((group, groupIdx) => {
    const groupCard = document.createElement('div');
    groupCard.className = 'candidate-keyword-group';

    const header = document.createElement('div');
    header.className = 'keyword-header';
    header.innerHTML = `
      <div class="keyword-title-wrap">
        <span class="keyword-badge">#${groupIdx + 1}</span>
        <strong>${escapeHtml(group.keyword)}</strong>
      </div>
      <span class="saypen-code-badge">세이펜 코드: <strong>${escapeHtml(group.saypen_code)}</strong></span>
    `;
    groupCard.appendChild(header);

    if (!group.candidates || group.candidates.length === 0) {
      const emptyNotice = document.createElement('p');
      emptyNotice.style.color = 'var(--danger)';
      emptyNotice.textContent = '❌ 검색 결과를 찾을 수 없습니다. 키워드를 확인해주세요.';
      groupCard.appendChild(emptyNotice);
      container.appendChild(groupCard);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'candidate-cards-grid';

    group.candidates.forEach((cand, candIdx) => {
      const card = document.createElement('div');
      const isSelected = group.selectedIndex === candIdx;
      card.className = `candidate-card ${isSelected ? 'selected' : ''}`;
      
      card.innerHTML = `
        <div class="candidate-thumb-wrap">
          <img src="${cand.thumbnail}" alt="${escapeHtml(cand.title)}" loading="lazy" onerror="this.src='https://img.youtube.com/vi/${cand.id}/hqdefault.jpg'">
          <span class="thumb-duration">${cand.duration_str}</span>
          ${cand.is_recommended ? '<span class="recommend-tag">⭐ 추천 영상</span>' : ''}
        </div>
        <div class="candidate-info">
          <div class="candidate-title" title="${escapeHtml(cand.title)}">${escapeHtml(cand.title)}</div>
          <div class="candidate-meta">
            <span>${escapeHtml(cand.channel)}</span>
            <a href="${cand.url}" target="_blank" onclick="event.stopPropagation()" style="color: var(--primary); text-decoration: none; font-size: 0.75rem;">유튜브 열기 ↗</a>
          </div>
          <div class="candidate-select-indicator">
            <input type="radio" name="cand-radio-${groupIdx}" ${isSelected ? 'checked' : ''}>
            <span>${isSelected ? '선택됨' : '선택하기'}</span>
          </div>
        </div>
      `;

      // 카드 클릭 시 선택 변경
      card.addEventListener('click', () => {
        group.selectedIndex = candIdx;
        const allCards = grid.querySelectorAll('.candidate-card');
        allCards.forEach((c, idx) => {
          c.classList.toggle('selected', idx === candIdx);
          const radio = c.querySelector('input[type="radio"]');
          if (radio) radio.checked = (idx === candIdx);
          const txt = c.querySelector('.candidate-select-indicator span');
          if (txt) txt.textContent = (idx === candIdx) ? '선택됨' : '선택하기';
        });
        // 후보 영상 선택 변경 시 바인더 송북에도 실시간 썸네일 동기화
        syncSongbookFromSearchedResults(false);
      });

      grid.appendChild(card);
    });

    groupCard.appendChild(grid);
    container.appendChild(groupCard);
  });
}

// 1번 탭에서 검색한 키워드 목록 및 영상 썸네일을 바인더 송북 카드 목록으로 순차 동기화
function syncSongbookFromSearchedResults(showToast = false) {
  if (!state.searchedResults || state.searchedResults.length === 0) {
    if (showToast) alert('먼저 1번 탭에서 노래 키워드를 검색해주세요.');
    return;
  }

  // 검색된 결과에서 키워드 글자와 선택된 후보 영상의 썸네일/세이펜 코드를 순서대로 추출
  const syncedItems = [];
  state.searchedResults.forEach(item => {
    let thumb = 'https://placehold.co/320x180/e2e8f0/475569?text=' + encodeURIComponent(item.keyword);
    if (item.candidates && item.candidates.length > 0) {
      const selected = item.candidates[item.selectedIndex] || item.candidates[0];
      if (selected && selected.thumbnail) {
        thumb = selected.thumbnail;
      }
    }

    syncedItems.push({
      id: item.saypen_code,
      title: item.keyword, // 사용자가 입력한 검색 키워드 글자를 카드 제목으로 그대로 매핑
      saypen_code: item.saypen_code,
      thumb_url: thumb
    });
  });

  if (syncedItems.length > 0) {
    state.songbookItems = syncedItems;
    renderSongbookPages();
    if (showToast) {
      alert(`검색 키워드 목록의 ${syncedItems.length}개 곡이 이미지와 함께 바인더 송북에 순서대로 반영되었습니다!`);
    }
  }
}

/* =========================================================
   3. A5 바인더 송북 제작 & 인쇄 로직
   ========================================================= */
function initSongbookHandlers() {
  const bookTitleInput = document.getElementById('book-title');
  const bookIconSelect = document.getElementById('book-icon-type');
  const cardsPerPageSelect = document.getElementById('cards-per-page');
  const binderMarginInput = document.getElementById('binder-margin');
  const binderMarginVal = document.getElementById('binder-margin-val');
  const showSaypenCodeCheckbox = document.getElementById('show-saypen-code');
  const showPlayIconCheckbox = document.getElementById('show-play-icon');
  const btnPrintSongbook = document.getElementById('btn-print-songbook');
  const btnExportHtml = document.getElementById('btn-export-html');

  // 컨트롤 변경 리스너
  bookTitleInput.addEventListener('input', (e) => {
    state.songbookSettings.title = e.target.value.trim() || '사운드 카드';
    renderSongbookPages();
  });

  bookIconSelect.addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
      const customEmoji = prompt('원하시는 이모지나 아이콘을 입력하세요 (예: 🎈, 🦁, 🌸):', '🐧');
      state.songbookSettings.icon = customEmoji || '🎵';
    } else {
      state.songbookSettings.icon = e.target.value;
    }
    renderSongbookPages();
  });

  cardsPerPageSelect.addEventListener('change', (e) => {
    state.songbookSettings.cardsPerPage = parseInt(e.target.value, 10) || 8;
    renderSongbookPages();
  });

  binderMarginInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10) || 0;
    state.songbookSettings.binderMargin = val;
    binderMarginVal.textContent = `${val}mm`;
    renderSongbookPages();
  });

  const bookFontSelect = document.getElementById('book-font');
  if (bookFontSelect) {
    bookFontSelect.addEventListener('change', (e) => {
      state.songbookSettings.font = e.target.value;
      renderSongbookPages();
    });
  }

  const paperTypeSelect = document.getElementById('print-paper-type');
  const showCutLinesCheckbox = document.getElementById('show-cut-lines');
  const showPunchGuideCheckbox = document.getElementById('show-punch-guide');

  if (paperTypeSelect) {
    paperTypeSelect.addEventListener('change', (e) => {
      state.songbookSettings.paperType = e.target.value;
      updateDynamicPrintStyle();
      renderSongbookPages();
    });
  }

  if (showCutLinesCheckbox) {
    showCutLinesCheckbox.addEventListener('change', (e) => {
      state.songbookSettings.showCutLines = e.target.checked;
      renderSongbookPages();
    });
  }

  if (showPunchGuideCheckbox) {
    showPunchGuideCheckbox.addEventListener('change', (e) => {
      state.songbookSettings.showPunchGuide = e.target.checked;
      renderSongbookPages();
    });
  }

  showSaypenCodeCheckbox.addEventListener('change', (e) => {
    state.songbookSettings.showSaypenCode = e.target.checked;
    renderSongbookPages();
  });

  showPlayIconCheckbox.addEventListener('change', (e) => {
    state.songbookSettings.showPlayIcon = e.target.checked;
    renderSongbookPages();
  });

  // 인쇄하기 버튼
  btnPrintSongbook.addEventListener('click', () => {
    updateDynamicPrintStyle();
    window.print();
  });

  // 독립형 HTML 저장
  btnExportHtml.addEventListener('click', exportStandaloneSongbookHtml);

  // 검색 키워드 및 이미지로 송북 채우기 버튼
  const btnSyncFromSearch = document.getElementById('btn-sync-from-search');
  if (btnSyncFromSearch) {
    btnSyncFromSearch.addEventListener('click', () => {
      syncSongbookFromSearchedResults(true);
    });
  }

  // 초기 인쇄 스타일 세팅
  updateDynamicPrintStyle();
}

// 인쇄 용지 규격 동적 적용 (@page size)
function updateDynamicPrintStyle() {
  let styleEl = document.getElementById('dynamic-print-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'dynamic-print-style';
    document.head.appendChild(styleEl);
  }
  const pt = state.songbookSettings.paperType;
  if (pt === 'a4-double-132') {
    styleEl.textContent = '@page { size: A4 landscape; margin: 0; }';
  } else if (pt === 'a4-single-132' || pt === 'a4-full-portrait') {
    styleEl.textContent = '@page { size: A4 portrait; margin: 0; }';
  } else {
    styleEl.textContent = '@page { size: A5 portrait; margin: 0; }';
  }
}

// 데모 초기 데이터 (업로드된 사진과 동일한 8개 곡)
function loadDefaultSongbookDemo() {
  const defaultSongs = [
    { id: "REC1_010315", title: "뽀롱뽀롱 뽀로로", saypen_code: "REC1_010315", thumb_url: "https://i.ytimg.com/vi/qY_3m6iK918/hqdefault.jpg" },
    { id: "REC1_010316", title: "개구리", saypen_code: "REC1_010316", thumb_url: "https://i.ytimg.com/vi/J_wHnQv07vQ/hqdefault.jpg" },
    { id: "REC1_010317", title: "거미가 줄을 타고", saypen_code: "REC1_010317", thumb_url: "https://i.ytimg.com/vi/9j01f2M6b_s/hqdefault.jpg" },
    { id: "REC1_010318", title: "나비야", saypen_code: "REC1_010318", thumb_url: "https://i.ytimg.com/vi/jC16L1P1bXQ/hqdefault.jpg" },
    { id: "REC1_010319", title: "곰 세 마리", saypen_code: "REC1_010319", thumb_url: "https://i.ytimg.com/vi/aL3p8vQf1Q8/hqdefault.jpg" },
    { id: "REC1_010320", title: "달팽이 집을 지읍시다", saypen_code: "REC1_010320", thumb_url: "https://i.ytimg.com/vi/8sY_5Xm0P1Q/hqdefault.jpg" },
    { id: "REC1_010321", title: "엄마 돼지 아기 돼지", saypen_code: "REC1_010321", thumb_url: "https://i.ytimg.com/vi/7jR0vXm8W1A/hqdefault.jpg" },
    { id: "REC1_010322", title: "머리 어깨 무릎 발", saypen_code: "REC1_010322", thumb_url: "https://i.ytimg.com/vi/kL1X8n0P_9Q/hqdefault.jpg" }
  ];

  state.songbookItems = defaultSongs;
  renderSongbookPages();
}

// 단일 바인더 내지 카드 콘텐츠 구성 헬퍼 (글꼴 적용 및 우측 하단 원형 스티커 가이드)
function createA5Content(pageItems, pageIdx, isRightPage = false) {
  const wrapper = document.createElement('div');
  wrapper.className = state.songbookSettings.font;
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.position = 'relative';

  const items = state.songbookItems;
  const perPage = state.songbookSettings.cardsPerPage;

  // 속지 끼움형 바인더: 타공 위치 고려 없이 균일 여백 적용
  // (타공 가이드 표시 옵션은 유지하되 단순 장식용)
  if (state.songbookSettings.showPunchGuide) {
    const punchGuide = document.createElement('div');
    punchGuide.className = 'punch-guide-container';
    punchGuide.style.left = '3mm';
    for (let i = 0; i < 6; i++) {
      const dot = document.createElement('div');
      dot.className = 'punch-dot';
      punchGuide.appendChild(dot);
    }
    wrapper.appendChild(punchGuide);
  }

  // 1. 헤더 영역 (원형 뱃지 + 중앙 타이틀 + 우측 전체 재생 아이콘)
  const headerEl = document.createElement('div');
  headerEl.className = 'a5-header';
  headerEl.innerHTML = `
    <div class="a5-header-left">
      <div class="a5-character-badge">${state.songbookSettings.icon}</div>
      <div class="a5-title-text">${escapeHtml(state.songbookSettings.title)}</div>
    </div>
    ${state.songbookSettings.showPlayIcon ? '<div class="a5-header-play-btn" title="세이펜 전체 재생 스티커 위치">▶</div>' : ''}
  `;
  wrapper.appendChild(headerEl);

  // 2. 바둑판 그리드
  const gridEl = document.createElement('div');
  gridEl.className = `a5-grid-${perPage}`;

  pageItems.forEach((song, itemIdxInPage) => {
    const globalIdx = pageIdx * perPage + itemIdxInPage;
    const cardEl = document.createElement('div');
    cardEl.className = 'a5-card';
    cardEl.setAttribute('data-idx', globalIdx);

    cardEl.innerHTML = `
      <div class="card-hover-tools no-print">
        ${globalIdx > 0 ? `<button class="card-tool-btn btn-move-prev" title="앞으로 이동">▲</button>` : ''}
        ${globalIdx < items.length - 1 ? `<button class="card-tool-btn btn-move-next" title="뒤로 이동">▼</button>` : ''}
        <button class="card-tool-btn btn-remove-card" title="카드 삭제">✕</button>
      </div>

      <div class="a5-card-thumb-wrap">
        <img src="${song.thumb_url}" alt="${escapeHtml(song.title)}" onerror="this.src='https://placehold.co/320x180/e2e8f0/475569?text=${encodeURIComponent(song.title)}'">
        ${state.songbookSettings.showSaypenCode ? `
          <div class="circular-saypen-tag" title="스티커 부착 위치">
            <span>${escapeHtml(song.saypen_code || '')}</span>
          </div>
        ` : ''}
      </div>

      <div class="a5-card-title" contenteditable="true" spellcheck="false" title="클릭하여 제목 수정 가능">
        ${escapeHtml(song.title)}
      </div>
    `;

    // 텍스트 인라인 수정 이벤트
    const titleEl = cardEl.querySelector('.a5-card-title');
    titleEl.addEventListener('blur', () => {
      const newTitle = titleEl.textContent.trim();
      if (newTitle) {
        song.title = newTitle;
      }
    });

    // 앞으로 이동
    const btnPrev = cardEl.querySelector('.btn-move-prev');
    if (btnPrev) {
      btnPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        swapSongOrder(globalIdx, globalIdx - 1);
      });
    }

    // 뒤로 이동
    const btnNext = cardEl.querySelector('.btn-move-next');
    if (btnNext) {
      btnNext.addEventListener('click', (e) => {
        e.stopPropagation();
        swapSongOrder(globalIdx, globalIdx + 1);
      });
    }

    // 삭제
    const btnRemove = cardEl.querySelector('.btn-remove-card');
    if (btnRemove) {
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`'${song.title}' 카드를 삭제하시겠습니까?`)) {
          state.songbookItems.splice(globalIdx, 1);
          renderSongbookPages();
        }
      });
    }

    gridEl.appendChild(cardEl);
  });

  // 빈 카드 슬롯 유지
  const emptyCount = perPage - pageItems.length;
  for (let i = 0; i < emptyCount; i++) {
    const placeholder = document.createElement('div');
    placeholder.className = 'a5-card';
    placeholder.style.visibility = 'hidden';
    gridEl.appendChild(placeholder);
  }

  wrapper.appendChild(gridEl);
  return wrapper;
}

// 송북 페이지 렌더링 (132×208mm 바인더 내지 맞춤 및 A4 가로/세로 출력 지원)
function renderSongbookPages() {
  const container = document.getElementById('pages-container');
  if (!container) return;
  container.innerHTML = '';

  const items = state.songbookItems;
  const perPage = state.songbookSettings.cardsPerPage;
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const paperType = state.songbookSettings.paperType; // 'a4-double-132', 'a4-single-132', 'a4-full-portrait', 'a5-direct'
  const showCutLines = state.songbookSettings.showCutLines;

  // [모드 1] A4 가로 2Page 모드 (A4 1장에 좌/우 132x208mm 2장 배치 + 자르는 점선, 문구 없음)
  if (paperType === 'a4-double-132') {
    const totalSheets = Math.ceil(totalPages / 2);

    for (let sheetIdx = 0; sheetIdx < totalSheets; sheetIdx++) {
      const sheetEl = document.createElement('div');
      sheetEl.className = `a4-sheet-landscape ${state.songbookSettings.font}`;

      const leftPageIdx = sheetIdx * 2;
      const rightPageIdx = sheetIdx * 2 + 1;

      // 좌측 132x208mm 바인더 내지
      const leftItems = items.slice(leftPageIdx * perPage, (leftPageIdx + 1) * perPage);
      const leftBinder = document.createElement('div');
      leftBinder.className = 'binder-page-132x208';
      if (!showCutLines) leftBinder.style.border = 'none';
      leftBinder.appendChild(createA5Content(leftItems, leftPageIdx, false));
      sheetEl.appendChild(leftBinder);

      // 우측 132x208mm 바인더 내지
      const rightBinder = document.createElement('div');
      rightBinder.className = 'binder-page-132x208';
      if (!showCutLines) rightBinder.style.border = 'none';
      if (rightPageIdx < totalPages) {
        const rightItems = items.slice(rightPageIdx * perPage, (rightPageIdx + 1) * perPage);
        rightBinder.appendChild(createA5Content(rightItems, rightPageIdx, true));
      } else {
        rightBinder.style.visibility = 'hidden';
      }
      sheetEl.appendChild(rightBinder);

      container.appendChild(sheetEl);
    }
  }
  // [모드 2] A4 세로 1Page 모드 (A4 세로 중앙에 132x208mm 바인더 내지 1장 배치 + 자르는 점선)
  else if (paperType === 'a4-single-132') {
    for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
      const sheetEl = document.createElement('div');
      sheetEl.className = `a4-sheet-portrait ${state.songbookSettings.font}`;

      const pageItems = items.slice(pageIdx * perPage, (pageIdx + 1) * perPage);
      const binderWrap = document.createElement('div');
      binderWrap.className = 'binder-page-132x208';
      if (!showCutLines) binderWrap.style.border = 'none';

      binderWrap.appendChild(createA5Content(pageItems, pageIdx, false));
      sheetEl.appendChild(binderWrap);
      container.appendChild(sheetEl);
    }
  }
  // [모드 3] A4 세로 전면 페이지 (210x297mm 꽉 찬 인쇄)
  else if (paperType === 'a4-full-portrait') {
    for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
      const sheetEl = document.createElement('div');
      sheetEl.className = `a4-full-page-portrait ${state.songbookSettings.font}`;
      const pageItems = items.slice(pageIdx * perPage, (pageIdx + 1) * perPage);
      sheetEl.appendChild(createA5Content(pageItems, pageIdx, false));
      container.appendChild(sheetEl);
    }
  }
  // [모드 4] A5 전용 용지 직접 인쇄 (148x210mm)
  else {
    for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
      const pageEl = document.createElement('div');
      pageEl.className = `a5-page ${state.songbookSettings.font}`;
      const pageItems = items.slice(pageIdx * perPage, (pageIdx + 1) * perPage);
      pageEl.appendChild(createA5Content(pageItems, pageIdx, false));
      container.appendChild(pageEl);
    }
  }
}

// 노래 순서 변경
function swapSongOrder(idx1, idx2) {
  if (idx1 < 0 || idx1 >= state.songbookItems.length) return;
  if (idx2 < 0 || idx2 >= state.songbookItems.length) return;
  const temp = state.songbookItems[idx1];
  state.songbookItems[idx1] = state.songbookItems[idx2];
  state.songbookItems[idx2] = temp;
  renderSongbookPages();
}

// 독립형 HTML 파일 내보내기
async function exportStandaloneSongbookHtml() {
  const pagesContainer = document.getElementById('pages-container');
  if (!pagesContainer) return;

  // 인쇄 전용 CSS 및 HTML 추출
  const pagesHtml = pagesContainer.innerHTML;

  const pt = state.songbookSettings.paperType;
  let pageStyle = '@page { size: A4 landscape; margin: 0; }';
  let printBarWidth = '297mm';
  if (pt === 'a4-single-132' || pt === 'a4-full-portrait') {
    pageStyle = '@page { size: A4 portrait; margin: 0; }';
    printBarWidth = '210mm';
  } else if (pt === 'a5-direct') {
    pageStyle = '@page { size: A5 portrait; margin: 0; }';
    printBarWidth = '148mm';
  }

  const standaloneHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(state.songbookSettings.title)} - 바인더 사운드 카드</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Gaegu:wght@400;700&family=Jua&family=Nanum+Myeongjo:wght@700;800&family=Nanum+Round+Gothic:wght@700;800&family=Pretendard:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Nanum Round Gothic', sans-serif;
      background-color: #f1f5f9;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      padding: 20px;
    }
    .print-bar {
      width: ${printBarWidth};
      max-width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #ffffff;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .print-btn {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 700;
      cursor: pointer;
      font-size: 14px;
    }
    .print-btn:hover { background: #2563eb; }

    /* 글꼴 클래스 */
    .font-nanum-round, .font-nanum-round * { font-family: 'Nanum Round Gothic', sans-serif !important; }
    .font-pretendard, .font-pretendard * { font-family: 'Pretendard', sans-serif !important; }
    .font-jua, .font-jua * { font-family: 'Jua', sans-serif !important; }
    .font-gaegu, .font-gaegu * { font-family: 'Gaegu', cursive, sans-serif !important; }
    .font-myeongjo, .font-myeongjo * { font-family: 'Nanum Myeongjo', serif !important; }
    
    /* A4 가로 2페이지 시트 */
    .a4-sheet-landscape {
      width: 297mm; height: 210mm; min-height: 210mm;
      background: #ffffff; box-shadow: 0 4px 20px rgba(0,0,0,0.12);
      border-radius: 4px; box-sizing: border-box;
      display: flex; justify-content: center; align-items: stretch;
      position: relative; overflow: hidden;
      page-break-after: always; break-after: page;
    }

    /* A4 절반 내지 (148.5mm × 210mm, 꽉 채움) */
    .binder-page-132x208 {
      width: 148.5mm; height: 210mm; min-height: 210mm; max-height: 210mm;
      box-sizing: border-box; padding: 7mm 8mm 8mm 8mm;
      display: flex; flex-direction: column; position: relative;
      background: #ffffff;
    }
    /* 중앙 절취 점선 (우측 내지 왼쪽 경계만) */
    .binder-page-132x208:last-child {
      border-left: 1.5px dashed #94a3b8;
    }

    /* A4 세로 1페이지 시트 (중앙 132x208mm) */
    .a4-sheet-portrait {
      width: 210mm; height: 297mm; min-height: 297mm;
      background: #ffffff; box-shadow: 0 4px 20px rgba(0,0,0,0.12);
      border-radius: 4px; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center; position: relative;
      page-break-after: always; break-after: page;
    }

    /* A4 세로 전면 시트 */
    .a4-full-page-portrait {
      width: 210mm; height: 297mm; min-height: 297mm; max-height: 297mm;
      box-sizing: border-box; padding: 12mm 10mm 12mm 16mm;
      display: flex; flex-direction: column; position: relative;
      background: #ffffff; box-shadow: 0 4px 20px rgba(0,0,0,0.12);
      border-radius: 4px; page-break-after: always; break-after: page;
    }

    /* A5 직접 인쇄 */
    .a5-page {
      width: 148mm; height: 210mm; min-height: 210mm;
      background: #ffffff; box-shadow: 0 4px 20px rgba(0,0,0,0.12);
      border-radius: 4px; padding: 8mm 6mm 8mm 14mm; box-sizing: border-box;
      display: flex; flex-direction: column; position: relative; overflow: hidden;
      page-break-after: always; break-after: page;
    }

    /* 6공 타공 가이드 */
*
    .punch-guide-container {
      position: absolute; left: 3mm; top: 0; bottom: 0; width: 5mm;
      display: flex; flex-direction: column; justify-content: space-evenly; align-items: center;
      pointer-events: none; z-index: 40;
    }
    .punch-dot {
      width: 3.5mm; height: 3.5mm; border: 1px dashed #cbd5e1; border-radius: 50%; background: rgba(241, 245, 249, 0.5);
    }


    .a5-header {
      display: flex; justify-content: space-between; align-items: center;
      padding-bottom: 2.5mm; border-bottom: 2px solid #e2e8f0; margin-bottom: 3mm;
    }
    .a5-header-left { display: flex; align-items: center; gap: 8px; }
    .a5-character-badge {
      width: 11mm; height: 11mm; background: #fef08a; border: 2px solid #38bdf8;
      border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px;
    }
    .a5-title-text { font-size: 18px; font-weight: 800; color: #1e293b; }
    .a5-header-play-btn {
      width: 9mm; height: 9mm; background: #ef4444; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;
    }
    .a5-grid-8 {
      display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(4, 1fr);
      gap: 3mm 4mm; flex: 1; height: calc(100% - 16mm);
    }
    .a5-grid-6 {
      display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr);
      gap: 4mm 5mm; flex: 1; height: calc(100% - 16mm);
    }
    .a5-grid-4 {
      display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(2, 1fr);
      gap: 6mm 6mm; flex: 1; height: calc(100% - 16mm);
    }
    .a5-card { display: flex; flex-direction: column; position: relative; }
    .a5-card-thumb-wrap {
      position: relative; width: 100%;
      flex: 1; min-height: 0;
      background: #e2e8f0; border-radius: 4px; overflow: hidden;
    }
    .a5-card-thumb-wrap img {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;
    }

    /* 우측 하단 원형 스티커 가이드라인 */
    .circular-saypen-tag {
      position: absolute; bottom: 3.5px; right: 3.5px; width: 42px; height: 42px;
      border-radius: 50%; background: rgba(255, 255, 255, 0.94); border: 1.5px dashed #f59e0b;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
      display: flex; align-items: center; justify-content: center; text-align: center;
      padding: 2px; box-sizing: border-box; z-index: 10; pointer-events: none;
    }
    .circular-saypen-tag span {
      font-size: 7px; font-weight: 800; color: #b45309; line-height: 1.05; word-break: break-all;
    }

    .a5-card-title {
      margin-top: 2mm; font-size: 12px; font-weight: 800; color: #334155;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .card-hover-tools { display: none !important; }

    ${pageStyle}
    @media print {
      body { background: white !important; padding: 0 !important; margin: 0 !important; }
      .print-bar { display: none !important; }
      .a4-sheet-landscape {
        width: 297mm !important; height: 210mm !important; border: none !important; box-shadow: none !important;
        page-break-after: always !important; break-after: page !important;
        -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
      }
      .binder-page-132x208 {
        width: 148.5mm !important; height: 210mm !important;
        min-height: 210mm !important; max-height: 210mm !important;
        box-shadow: none !important;
        -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
      }
      .circular-saypen-tag {
        width: 5mm !important; height: 5mm !important;
        bottom: 0 !important; right: 0 !important; padding: 6mm !important;
        -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
      }
      .circular-saypen-tag span { font-size: 9pt !important; max-height: none !important; }
      .a4-sheet-portrait {
        width: 210mm !important; height: 297mm !important; border: none !important; box-shadow: none !important;
        page-break-after: always !important; break-after: page !important;
        -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
      }
      .a4-full-page-portrait {
        width: 210mm !important; height: 297mm !important; border: none !important; box-shadow: none !important;
        page-break-after: always !important; break-after: page !important;
        -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
      }
      .a5-page {
        width: 148mm !important; height: 210mm !important; border: none !important; box-shadow: none !important;
        page-break-after: always !important; break-after: page !important;
        -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
      }
      .punch-dot, .circular-saypen-tag {
        -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
      }
    }
  </style>
</head>
<body>
  <div class="print-bar">
    <div><strong>${escapeHtml(state.songbookSettings.title)}</strong> (바인더 사운드 카드)</div>
    <button class="print-btn" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
  </div>
  ${pagesHtml}
</body>
</html>`;

  // 서버에 파일로 저장 요청
  try {
    const res = await fetch('/api/save-songbook-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'songbook_A5.html',
        html: standaloneHtml
      })
    });
    const resData = await res.json();
    if (resData.status === 'ok') {
      alert(`성공적으로 저장되었습니다!\n저장 경로: downloads/songbook_A5.html\n\n'downloads' 폴더에서 더블클릭하시면 언제든 브라우저로 열어 인쇄할 수 있습니다.`);
    }
  } catch (e) {
    // 다운로드 링크로 폴백
    const blob = new Blob([standaloneHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'songbook_A5.html';
    a.click();
    URL.revokeObjectURL(url);
  }
}

/* =========================================================
   4. 매핑 & 다운로드 기록 조회 로직
   ========================================================= */
function initHistoryHandlers() {
  const btnRefresh = document.getElementById('btn-refresh-history');
  const btnOpenFolder = document.getElementById('btn-open-folder-history');

  btnRefresh.addEventListener('click', loadHistory);
  btnOpenFolder.addEventListener('click', async () => {
    await fetch('/api/open-downloads', { method: 'POST' });
  });
}

async function loadHistory() {
  const tbody = document.getElementById('history-table-body');
  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">기록을 불러오는 중...</td></tr>';

  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    const history = data.history || [];

    if (history.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-gray-500">아직 다운로드 기록이 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    // 최신순 정렬
    history.slice().reverse().forEach(item => {
      const tr = document.createElement('tr');
      if (!item.success) {
        tr.className = 'row-failed';
      }

      tr.innerHTML = `
        <td>
          <span class="badge ${item.success ? 'badge-success' : 'badge-danger'}">
            ${item.success ? '성공' : '실패'}
          </span>
        </td>
        <td><strong>${escapeHtml(item.saypen_code || '-')}</strong></td>
        <td>${escapeHtml(item.keyword || '-')}</td>
        <td title="${escapeHtml(item.youtube_title || '')}">${escapeHtml(item.youtube_title || '-')}</td>
        <td>
          ${item.success ? `
            <div style="font-size: 0.8rem;">
              🎵 ${escapeHtml(item.mp3_file || '')}<br>
              🖼️ ${escapeHtml(item.jpg_file || '')}
            </div>
          ` : '<span style="color: var(--danger); font-size: 0.8rem;">파일 생성 실패</span>'}
        </td>
        <td>
          <div style="font-size: 0.775rem; color: var(--gray-500);">${escapeHtml(item.timestamp || '')}</div>
          ${!item.success ? `<div style="color: var(--danger); font-size: 0.75rem; font-weight: 600;">${escapeHtml(item.error_message || '')}</div>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">기록 조회 실패: ${err.message}</td></tr>`;
  }
}

/* =========================================================
   유틸 함수
   ========================================================= */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* =========================================================
   PWA & 모바일/PC 브라우저 일괄 저장 로직
   ========================================================= */
let deferredPrompt = null;

function initPwaAndBrowserDownload() {
  // 1. PWA 서비스 워커 등록
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.log('ServiceWorker registration failed: ', err);
    });
  }

  // 2. 모바일 PWA 설치 가능 시 프로모션 바 표시
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.classList.remove('hidden');
  });

  const btnPwaInstall = document.getElementById('btn-pwa-install');
  if (btnPwaInstall) {
    btnPwaInstall.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to install prompt: ${outcome}`);
      deferredPrompt = null;
      const banner = document.getElementById('pwa-install-banner');
      if (banner) banner.classList.add('hidden');
    });
  }

  // 3. 브라우저 일괄 다운로드 버튼
  const btnBrowserDownloadAll = document.getElementById('btn-browser-download-all');
  if (btnBrowserDownloadAll) {
    btnBrowserDownloadAll.addEventListener('click', () => {
      if (!state.songbookItems || state.songbookItems.length === 0) {
        alert('다운로드할 곡이 없습니다. 먼저 1번 탭에서 곡을 다운로드해주세요.');
        return;
      }
      triggerBatchBrowserDownload(state.songbookItems);
    });
  }
}

function triggerBatchBrowserDownload(items) {
  let delay = 0;
  let count = 0;
  items.forEach(item => {
    // 1. MP3 음원 다운로드
    const mp3Filename = item.mp3_file || (item.saypen_code ? `${item.saypen_code}.mp3` : null);
    if (mp3Filename) {
      setTimeout(() => {
        downloadSingleFile(`/downloads/${encodeURIComponent(mp3Filename)}?download=1`, mp3Filename);
      }, delay);
      delay += 350;
      count++;
    }

    // 2. 썸네일 이미지 다운로드
    let imgFilename = item.jpg_file;
    if (!imgFilename && item.thumb_url && item.thumb_url.includes('/downloads/')) {
      imgFilename = decodeURIComponent(item.thumb_url.split('/downloads/')[1]);
    }
    if (imgFilename) {
      setTimeout(() => {
        downloadSingleFile(`/downloads/${encodeURIComponent(imgFilename)}?download=1`, imgFilename);
      }, delay);
      delay += 350;
      count++;
    }
  });
  alert(`${items.length}개 곡의 MP3 음원 및 썸네일 이미지(${count}개 파일) 브라우저 저장 다운로드를 시작합니다.`);
}

function downloadSingleFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* =========================================================
   시리즈 보관함 (localStorage) 로직
   ========================================================= */
const SERIES_STORAGE_KEY = 'saypen_saved_series_list';

function getSavedSeriesList() {
  try {
    const raw = localStorage.getItem(SERIES_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [
    {
      id: 'default_pororo',
      name: '뽀로로 인기 동요',
      character: '뽀로로',
      keywords: [
        "뽀롱뽀롱 오프닝곡",
        "개굴개굴개구리",
        "거미가 줄을타고",
        "나비야 나비야",
        "곰 세마리",
        "달팽이 집을 지읍시다",
        "엄마 돼지 아기 돼지",
        "머리 어깨 무릎 발"
      ]
    }
  ];
}

function saveSeriesList(list) {
  try {
    localStorage.setItem(SERIES_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {}
  renderSavedSeriesUI();
}

function initSeriesStorageHandlers() {
  const btnSave = document.getElementById('btn-save-series');
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      const keywordsInput = document.getElementById('keywords-input');
      const charInput = document.getElementById('character-name');
      const lines = keywordsInput.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      if (lines.length === 0) {
        alert('저장할 키워드 목록을 먼저 입력해주세요.');
        return;
      }

      let seriesName = charInput ? charInput.value.trim() : '';
      if (!seriesName) {
        seriesName = prompt('저장할 시리즈/캐릭터 이름을 입력하세요 (예: 타요의 씽씽극장, 핑크퐁 상어가족):', '');
        if (!seriesName || !seriesName.trim()) return;
        seriesName = seriesName.trim();
        if (charInput) charInput.value = seriesName;
      }

      const list = getSavedSeriesList();
      const existingIdx = list.findIndex(s => s.name === seriesName);
      const newSeries = {
        id: 'series_' + Date.now(),
        name: seriesName,
        character: seriesName,
        keywords: lines,
        savedAt: new Date().toLocaleDateString()
      };

      if (existingIdx >= 0) {
        if (!confirm(`'${seriesName}' 시리즈가 이미 보관함에 있습니다. 최신 키워드로 덮어쓰시겠습니까?`)) {
          return;
        }
        list[existingIdx] = newSeries;
      } else {
        list.push(newSeries);
      }

      saveSeriesList(list);
      alert(`'${seriesName}' (총 ${lines.length}곡)이 내 시리즈 보관함에 성공적으로 저장되었습니다!`);
    });
  }

  // 송북 탭의 시리즈 선택 드롭다운 변경 리스너
  const songbookSeriesSelect = document.getElementById('songbook-series-select');
  if (songbookSeriesSelect) {
    songbookSeriesSelect.addEventListener('change', (e) => {
      const selectedId = e.target.value;
      if (!selectedId) return;
      const list = getSavedSeriesList();
      const series = list.find(s => s.id === selectedId);
      if (series) {
        applySeriesToSongbookAndEditor(series);
      }
    });
  }

  renderSavedSeriesUI();
}

function applySeriesToSongbookAndEditor(series) {
  // 1. 1번 탭의 키워드 및 캐릭터 입력창에 반영
  const keywordsInput = document.getElementById('keywords-input');
  const charInput = document.getElementById('character-name');
  if (keywordsInput) {
    keywordsInput.value = series.keywords.join('\n');
    // 라인 번호 및 카운트 갱신 트리거
    const lines = series.keywords;
    const lineNumbers = document.getElementById('line-numbers');
    const countBadge = document.getElementById('keyword-count-badge');
    if (countBadge) countBadge.textContent = `${lines.length}곡 입력됨`;
    if (lineNumbers) {
      let nums = '';
      for (let i = 1; i <= Math.max(lines.length, 1); i++) nums += i + '\n';
      lineNumbers.textContent = nums;
    }
  }
  if (charInput) {
    charInput.value = series.character || series.name;
  }

  // 2. 송북 타이틀 기본값 반영 (사용자가 언제든 수정 가능)
  const bookTitleInput = document.getElementById('book-title');
  const newTitle = `${series.name} 사운드 카드`;
  state.songbookSettings.title = newTitle;
  if (bookTitleInput) bookTitleInput.value = newTitle;

  // 3. 송북 카드 생성 (키워드 순차 매핑)
  const prefix = 'REC1_';
  state.songbookItems = series.keywords.map((kw, idx) => {
    const codeNum = 1000 + idx;
    const paddedNum = String(codeNum).padStart(4, '0');
    return {
      id: `${prefix}${paddedNum}`,
      title: kw,
      saypen_code: `${prefix}${paddedNum}`,
      thumb_url: `https://placehold.co/320x180/e2e8f0/475569?text=${encodeURIComponent(kw)}`
    };
  });

  renderSongbookPages();
}

function renderSavedSeriesUI() {
  const container = document.getElementById('saved-series-container');
  const chipsWrap = document.getElementById('saved-series-chips');
  const songbookSelect = document.getElementById('songbook-series-select');
  const list = getSavedSeriesList();

  if (!chipsWrap) return;

  if (list.length === 0) {
    if (container) container.classList.add('hidden');
  } else {
    if (container) container.classList.remove('hidden');
    chipsWrap.innerHTML = '';
    list.forEach(series => {
      const chip = document.createElement('div');
      chip.style.cssText = 'display: inline-flex; align-items: center; background: var(--bg-main); border: 1px solid var(--border); border-radius: 20px; padding: 2px 8px 2px 10px; font-size: 0.82rem; gap: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);';
      
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `📂 ${series.name} (${series.keywords.length}곡)`;
      btn.style.cssText = 'background: none; border: none; font-size: 0.82rem; font-weight: 600; color: var(--primary); cursor: pointer; padding: 0;';
      btn.title = `클릭하면 '${series.name}' 키워드 목록을 불러옵니다.`;
      btn.addEventListener('click', () => {
        applySeriesToSongbookAndEditor(series);
        alert(`'${series.name}' (총 ${series.keywords.length}곡)을 불러왔습니다! 이제 [상위 3개 영상 후보 검색하기]를 누르시면 됩니다.`);
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.innerHTML = '&times;';
      delBtn.style.cssText = 'background: none; border: none; font-size: 0.95rem; line-height: 1; color: var(--text-muted); cursor: pointer; padding: 0 2px;';
      delBtn.title = '이 시리즈 보관함에서 삭제';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`'${series.name}' 시리즈를 보관함에서 삭제하시겠습니까?`)) {
          const updated = list.filter(s => s.id !== series.id);
          saveSeriesList(updated);
        }
      });

      chip.appendChild(btn);
      chip.appendChild(delBtn);
      chipsWrap.appendChild(chip);
    });
  }

  // 송북 탭 셀렉트박스 갱신
  if (songbookSelect) {
    const currentVal = songbookSelect.value;
    songbookSelect.innerHTML = '<option value="">-- 내 보관함 시리즈 선택 --</option>';
    list.forEach(series => {
      const opt = document.createElement('option');
      opt.value = series.id;
      opt.textContent = `📁 ${series.name} (${series.keywords.length}곡)`;
      songbookSelect.appendChild(opt);
    });
    songbookSelect.value = currentVal;
  }
}


