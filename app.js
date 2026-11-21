// ============================================================
// 1. YouTube Data API v3 키 고정 설정 (필요 시 직접 기입 가능)
// ============================================================
const FIXED_YOUTUBE_API_KEY = ""; 

const $ = id => document.getElementById(id);
let tracks = [], data = {};
let backendAvailable = null; // null: 미확인, true: /api/search 사용 가능, false: 미지원

// 수록곡 텍스트 파싱
function parseSongs() {
  return $('songs').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

// 수록곡 입력창 라인 번호 및 카운트 실시간 갱신 (우리 방식)
function updateLineNumbers() {
  const textarea = $('songs');
  const gutter = $('lineNumbers');
  const badge = $('songsCountBadge');
  if (!textarea || !gutter) return;

  const lines = textarea.value.split('\n');
  const validCount = lines.filter(l => l.trim().length > 0).length;

  let nums = '';
  const totalLines = Math.max(lines.length, 1);
  for (let i = 1; i <= totalLines; i++) {
    nums += i + '\n';
  }
  gutter.textContent = nums.trimEnd();

  if (badge) {
    badge.textContent = `${validCount}곡 입력됨`;
  }
}

// 수록곡 목록 적용
function applySongs() {
  const oldByName = {};
  tracks.forEach((t, i) => { oldByName[t.name] = data[i]; });
  
  tracks = parseSongs().map((name, i) => ({ name, order: i }));
  data = {};

  tracks.forEach((t, i) => {
    const existing = oldByName[t.name];
    data[i] = {
      selected: existing ? existing.selected : true,
      visibleCount: existing?.visibleCount || 3,
      allResults: existing?.allResults || [],
      candidates: existing?.candidates || []
    };
  });

  renderTracks();
  renderEditors();
  renderOutput();
  updateLineNumbers();
}

// 2. 수록곡 목록 체크박스 렌더링
function renderTracks() {
  const root = $('tracklist');
  root.innerHTML = '';
  tracks.forEach((t, i) => {
    const d = document.createElement('div');
    d.className = 'track';
    d.innerHTML = `
      <span class="num">${String(i + 1).padStart(2, '0')}</span>
      <div class="name"></div>
      <label style="display:flex;align-items:center;gap:6px;margin:0;font-size:12px;font-weight:650;white-space:nowrap;cursor:pointer">
        <input type="checkbox" ${data[i].selected ? 'checked' : ''} aria-label="추출 여부"> 추출
      </label>
    `;
    d.querySelector('.name').textContent = t.name;
    d.querySelector('input').onchange = e => {
      data[i].selected = e.target.checked;
      renderEditors();
      renderOutput();
    };
    root.appendChild(d);
  });
}

// 3. 유튜브 후보 편집기 렌더링
function renderEditors() {
  const root = $('candidateEditor');
  root.innerHTML = '';

  tracks.forEach((t, i) => {
    if (!data[i].selected) return;

    const wrap = document.createElement('div');
    wrap.className = 'panel';
    wrap.style.margin = '10px 0';

    const head = document.createElement('h2');
    head.textContent = `${String(i + 1).padStart(2, '0')}. ${t.name}`;
    wrap.appendChild(head);

    const searchRow = document.createElement('div');
    searchRow.className = 'row';
    searchRow.style.margin = '8px 0 12px';

    const searchBtn = document.createElement('button');
    searchBtn.className = 'btn primary';
    searchBtn.textContent = '유튜브 후보 재검색';
    searchBtn.onclick = () => searchYouTube(i, searchBtn);
    searchRow.appendChild(searchBtn);
    wrap.appendChild(searchRow);

    const grid = document.createElement('div');
    grid.className = 'candidates';

    const visibleList = (data[i].candidates || []).slice(0, data[i].visibleCount || 3);

    visibleList.forEach((c, j) => {
      const card = document.createElement('div');
      card.className = 'candidate';
      const mp3DownloadUrl = c.url ? `https://en.savefrom.net/1-youtube-video-downloader-78a/?url=${encodeURIComponent(c.url)}` : '';

      card.innerHTML = `
        <div class="thumb-box"><img alt="후보 썸네일" src="${escapeAttr(c.image || '')}"></div>
        <h3>${escapeAttr(c.title || '제목 없음')}</h3>
        <div class="meta">⏱️ 재생시간: ${escapeAttr(c.duration || '-')}</div>
        <div class="pick">
          <label><input type="radio" name="imagePick_${i}" data-k="imagePick" ${c.imagePick ? 'checked' : ''}> 이미지 선택</label>
          <label><input type="radio" name="audioPick_${i}" data-k="audioPick" ${c.audioPick ? 'checked' : ''}> 음원 선택</label>
          ${mp3DownloadUrl ? `<a href="${mp3DownloadUrl}" target="_blank" class="btn accent" style="padding:3px 8px;font-size:11px;text-decoration:none">MP3 다운</a>` : ''}
        </div>
      `;

      card.querySelectorAll('input[type=radio]').forEach(inp => {
        inp.onchange = () => {
          const key = inp.dataset.k;
          data[i].candidates.forEach(x => { x[key] = false; });
          c[key] = true;
          renderOutput();
        };
      });

      grid.appendChild(card);
    });

    wrap.appendChild(grid);

    if (data[i].allResults && data[i].allResults.length > (data[i].visibleCount || 3)) {
      const moreRow = document.createElement('div');
      moreRow.style.marginTop = '12px';
      moreRow.style.textAlign = 'center';

      const moreBtn = document.createElement('button');
      moreBtn.className = 'btn';
      moreBtn.textContent = '추가 후보 3개 더 보기';
      moreBtn.onclick = () => {
        data[i].visibleCount = (data[i].visibleCount || 3) + 3;
        syncCandidates(i);
        renderEditors();
      };
      moreRow.appendChild(moreBtn);
      wrap.appendChild(moreRow);
    }

    root.appendChild(wrap);
  });
}

function syncCandidates(i) {
  const current = data[i].candidates || [];
  const limit = data[i].visibleCount || 3;
  const list = data[i].allResults.slice(0, limit);

  data[i].candidates = list.map((item, idx) => {
    const prev = current[idx] || {};
    return {
      ...item,
      imagePick: prev.imagePick || false,
      audioPick: prev.audioPick || false
    };
  });
}

// 4. 미리보기 렌더링: 상단 헤드라인 완전 제외, 우리 크롭 방식 적용(16:9 비율 유지, scale 왜곡 없음)
function renderOutput() {
  const selected = tracks.filter((t, i) => data[i]?.selected);
  $('count').textContent = selected.length + '곡 선택';

  const container = $('previewContainer');
  container.innerHTML = '';

  const pageSize = 8;
  const totalSongbooks = Math.ceil(selected.length / pageSize) || 1;

  for (let s = 0; s < totalSongbooks; s++) {
    const pageItems = selected.slice(s * pageSize, (s + 1) * pageSize);

    const songbookCard = document.createElement('div');
    songbookCard.className = 'single-songbook';
    songbookCard.dataset.songbookIndex = s + 1;

    // [요청 반영] 상단 헤드라인(중앙정렬) 완전 제외! 헤더 없이 바로 2열 4행 카드가 시작됩니다.

    // 2열 4행 그리드
    const gridDiv = document.createElement('div');
    gridDiv.className = 'songbook-grid';

    pageItems.forEach(t => {
      const i = t.order;
      const c = data[i].candidates.find(x => x.imagePick) || data[i].candidates[0];
      const item = document.createElement('div');
      item.className = 'song-item';

      if (c && c.image) {
        // 우리 크롭 방식: 16:9 비율 래퍼 + object-fit: cover (인위적 1.34배 줌 삭제)
        const cropDiv = document.createElement('div');
        cropDiv.className = 'thumb-crop';
        const img = document.createElement('img');
        img.crossOrigin = 'anonymous';
        img.src = c.image;
        img.alt = t.name;
        cropDiv.appendChild(img);
        item.appendChild(cropDiv);
      } else {
        const cropDiv = document.createElement('div');
        cropDiv.className = 'thumb-crop';
        const missing = document.createElement('div');
        missing.className = 'missing';
        missing.textContent = '후보 미선택';
        cropDiv.appendChild(missing);
        item.appendChild(cropDiv);
      }

      const cap = document.createElement('div');
      cap.className = 'song-title';
      cap.textContent = t.name;
      item.appendChild(cap);

      gridDiv.appendChild(item);
    });

    songbookCard.appendChild(gridDiv);

    // 송북 개별 저장 액션
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'songbook-actions no-print';
    actionsDiv.innerHTML = `
      <span style="font-size:11px;color:var(--muted);margin-right:auto;align-self:center">송북 ${s + 1} (${pageItems.length}곡)</span>
      <button class="btn" onclick="exportSingleSongbook(${s}, 'image')">이 송북 이미지 저장</button>
      <button class="btn success" onclick="exportSingleSongbook(${s}, 'pdf')">이 송북 PDF 저장</button>
    `;
    songbookCard.appendChild(actionsDiv);

    container.appendChild(songbookCard);
  }
}

async function renderSongbookToCanvas(songbookElement) {
  const actions = songbookElement.querySelector('.songbook-actions');
  if (actions) actions.style.display = 'none';

  try {
    const canvas = await html2canvas(songbookElement, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff'
    });
    return canvas;
  } finally {
    if (actions) actions.style.display = 'flex';
  }
}

window.exportSingleSongbook = async function(index, format) {
  const songbooks = document.querySelectorAll('.single-songbook');
  const target = songbooks[index];
  if (!target) return;

  const title = $('album')?.value || '타요_송북';

  if (typeof html2canvas === 'undefined') {
    alert('PDF/이미지 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
    return;
  }

  const canvas = await renderSongbookToCanvas(target);

  if (format === 'image') {
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug(title)}_송북_${index + 1}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  } else if (format === 'pdf') {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
      window.print();
      return;
    }
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    pdf.addImage(imgData, 'JPEG', 5, 5, 138, (canvas.height * 138) / canvas.width);
    pdf.save(`${slug(title)}_송북_${index + 1}.pdf`);
  }
};

$('downloadAllPdfBtn').onclick = async () => {
  const songbooks = document.querySelectorAll('.single-songbook');
  if (!songbooks.length) { alert('선택된 곡이 없습니다.'); return; }

  const btn = $('downloadAllPdfBtn');
  btn.disabled = true;
  btn.textContent = 'PDF 생성 중…';

  try {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF || typeof html2canvas === 'undefined') {
      window.print();
      return;
    }

    const title = $('album')?.value || '타요_송북';
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });

    for (let i = 0; i < songbooks.length; i++) {
      if (i > 0) pdf.addPage('a5', 'portrait');
      const canvas = await renderSongbookToCanvas(songbooks[i]);
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(imgData, 'JPEG', 5, 5, 138, (canvas.height * 138) / canvas.width);
    }

    pdf.save(`${slug(title)}_전체송북.pdf`);
  } catch (err) {
    alert('PDF 직접 저장 실패: 인쇄 창으로 전환합니다. (' + err.message + ')');
    window.print();
  } finally {
    btn.disabled = false;
    btn.textContent = '📄 전체 송북 PDF 다운로드';
  }
};

$('downloadAllImgBtn').onclick = async () => {
  const songbooks = document.querySelectorAll('.single-songbook');
  if (!songbooks.length) { alert('선택된 곡이 없습니다.'); return; }

  const btn = $('downloadAllImgBtn');
  btn.disabled = true;
  btn.textContent = '이미지 생성 중…';

  try {
    const title = $('album')?.value || '타요_송북';
    for (let i = 0; i < songbooks.length; i++) {
      const canvas = await renderSongbookToCanvas(songbooks[i]);
      canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slug(title)}_송북_${i + 1}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
      await new Promise(r => setTimeout(r, 400));
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '🖼️ 전체 송북 이미지(PNG) 저장';
  }
};

// 단일 곡 유튜브 후보 검색 함수 (/api/search 지원 및 YouTube Data API v3 연동)
async function searchTrackCandidates(trackName) {
  const album = ($('album')?.value || '').trim();
  const query = (album ? album + ' ' + trackName : trackName).trim();

  // 1. 로컬 또는 원격 백엔드 /api/search 시도
  if (backendAvailable !== false) {
    try {
      const resp = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: [query], limit: 6 })
      });
      if (resp.ok) {
        const json = await resp.json();
        if (json.status === 'ok' && json.results && json.results[0] && json.results[0].candidates?.length > 0) {
          backendAvailable = true;
          return json.results[0].candidates.map(c => ({
            id: c.id,
            title: c.title || '',
            url: c.url || `https://www.youtube.com/watch?v=${c.id}`,
            image: c.thumbnail || `https://i.ytimg.com/vi/${c.id}/hqdefault.jpg`,
            duration: c.duration_str || secondsToDuration(c.duration || 0),
            seconds: c.duration || 0
          }));
        }
      } else {
        backendAvailable = false;
      }
    } catch (e) {
      backendAvailable = false;
    }
  }

  // 2. YouTube Data API v3 조회
  const key = getApiKey();
  if (!key) {
    throw new Error('API_KEY_REQUIRED');
  }

  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&order=relevance&q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`;
  const sr = await fetch(searchUrl);
  const sj = await sr.json();
  if (!sr.ok) throw new Error(sj.error?.message || 'YouTube 검색 실패');

  const ids = (sj.items || []).map(x => x.id?.videoId).filter(Boolean);
  if (!ids.length) throw new Error('검색 결과가 없습니다.');

  const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${ids.join(',')}&key=${encodeURIComponent(key)}`;
  const dr = await fetch(detailsUrl);
  const dj = await dr.json();
  if (!dr.ok) throw new Error(dj.error?.message || '상세 정보 획득 실패');

  return (dj.items || []).map(v => ({
    id: v.id,
    title: v.snippet?.title || '',
    url: `https://www.youtube.com/watch?v=${v.id}`,
    image: v.snippet?.thumbnails?.high?.url || v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    duration: secondsToDuration(isoDurationToSeconds(v.contentDetails?.duration || '')),
    seconds: isoDurationToSeconds(v.contentDetails?.duration || '')
  }));
}

// 개별 곡 재검색
async function searchYouTube(i, button) {
  button.disabled = true;
  button.textContent = '검색 중…';

  try {
    const track = tracks[i];
    const results = await searchTrackCandidates(track.name);

    data[i].allResults = results;
    data[i].visibleCount = 3;
    data[i].candidates = results.slice(0, 3).map((r, idx) => ({
      ...r,
      imagePick: idx === 0,
      audioPick: idx === 0
    }));

    renderEditors();
    renderOutput();
  } catch (e) {
    if (e.message === 'API_KEY_REQUIRED') {
      alert('YouTube API 키가 필요합니다. 3번 섹션에 YouTube Data API v3 키를 입력해 주세요.');
      $('ytkey')?.focus();
    } else {
      alert('유튜브 후보 검색 오류: ' + e.message);
    }
  } finally {
    button.disabled = false;
    button.textContent = '유튜브 후보 재검색';
  }
}

// [요청 반영] '유튜브 후보 찾기' 클릭 시 전곡 일괄 조회
async function searchAllCandidates() {
  // 먼저 입력된 수록곡 적용
  applySongs();

  const selectedIndices = tracks.map((t, idx) => idx).filter(i => data[i]?.selected);
  if (!selectedIndices.length) {
    alert('조회할 수록곡이 없습니다. 수록곡 목록을 입력하고 추출을 선택해 주세요.');
    return;
  }

  const applyBtn = $('apply');
  const statusBox = $('batchSearchStatus');
  applyBtn.disabled = true;
  if (statusBox) {
    statusBox.style.display = 'block';
    statusBox.style.background = '#e0f2fe';
    statusBox.style.borderColor = '#bae6fd';
    statusBox.style.color = '#0369a1';
  }

  let successCount = 0;
  let failCount = 0;

  for (let step = 0; step < selectedIndices.length; step++) {
    const i = selectedIndices[step];
    const trackName = tracks[i].name;
    const currentNum = step + 1;
    const totalNum = selectedIndices.length;

    applyBtn.textContent = `⏳ [${currentNum}/${totalNum}] 검색 중... (${trackName})`;
    if (statusBox) {
      statusBox.innerHTML = `⏳ <strong>[${currentNum}/${totalNum}]</strong> "${escapeAttr(trackName)}" 유튜브 후보 검색 진행 중...`;
    }

    try {
      const candidates = await searchTrackCandidates(trackName);
      data[i].allResults = candidates;
      data[i].visibleCount = 3;
      data[i].candidates = candidates.slice(0, 3).map((r, idx) => ({
        ...r,
        imagePick: idx === 0,
        audioPick: idx === 0
      }));
      successCount++;
    } catch (err) {
      failCount++;
      if (err.message === 'API_KEY_REQUIRED') {
        alert('YouTube Data API 키가 필요합니다. 3번 섹션에 API 키를 입력해 주세요.\n(자체 Python 서버로 실행 시에는 API 키 없이 바로 검색됩니다)');
        $('ytkey')?.focus();
        break;
      }
      console.warn(`[${trackName}] 검색 실패:`, err);
    }

    // 곡이 검색될 때마다 실시간으로 미리보기 반영
    renderOutput();
  }

  renderEditors();
  renderOutput();

  applyBtn.disabled = false;
  applyBtn.textContent = '🔍 유튜브 후보 찾기';

  if (statusBox) {
    statusBox.style.display = 'block';
    statusBox.style.background = failCount === 0 ? '#f0fdf4' : '#fffbeb';
    statusBox.style.borderColor = failCount === 0 ? '#bbf7d0' : '#fef3c7';
    statusBox.style.color = failCount === 0 ? '#166534' : '#b45309';
    statusBox.innerHTML = `🎉 <strong>일괄 조회 완료!</strong> 총 ${selectedIndices.length}곡 중 ${successCount}곡 성공` + (failCount > 0 ? ` (${failCount}곡 실패)` : '');
  }
}

function getApiKey() {
  if (FIXED_YOUTUBE_API_KEY && FIXED_YOUTUBE_API_KEY.trim()) return FIXED_YOUTUBE_API_KEY.trim();
  const inputVal = $('ytkey')?.value.trim();
  if (inputVal) return inputVal;
  return localStorage.getItem('albumToolYouTubeKey') || '';
}

$('savePreviewHtml').onclick = () => {
  const title = $('album')?.value || '타요의 씽씽극장';
  const previewHtml = $('previewContainer').innerHTML;
  const currentFontClass = document.body.className || 'font-round';

  const doc = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttr(title)} - 송북</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/innks/NanumSquareRound@master/nanumsquareround.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link href="https://fonts.googleapis.com/css2?family=Jua&display=swap" rel="stylesheet">
<style>
@font-face {
  font-family: 'Cafe24Ssurround';
  src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2105_2@1.0/Cafe24Ssurround.woff') format('woff');
}
:root{
  --title-font: 'NanumSquareRound', 'Pretendard', sans-serif;
}
body.font-round { --title-font: 'NanumSquareRound', 'Pretendard', sans-serif; }
body.font-jua { --title-font: 'Jua', 'NanumSquareRound', sans-serif; }
body.font-ssurround { --title-font: 'Cafe24Ssurround', 'NanumSquareRound', sans-serif; }
body.font-pretendard { --title-font: 'Pretendard', sans-serif; }
body.font-system { --title-font: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
body{font-family:'Pretendard',sans-serif;margin:16px;background:#f8fafc;color:#1e293b;display:flex;flex-direction:column;align-items:center;gap:20px}
.single-songbook{border:1px dashed #94a3b8;border-radius:14px;padding:16px 14px 18px;background:#fff;width:100%;max-width:440px;display:flex;flex-direction:column;box-shadow:0 4px 16px rgba(0,0,0,0.06)}
.songbook-grid{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(4, minmax(0, 1fr));gap:12px 10px}
.song-item{border:none;padding:0;background:transparent;display:flex;flex-direction:column;align-items:center;text-align:center}
.thumb-crop{width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:6px;background:#e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,0.08);position:relative}
.thumb-crop img{width:100%;height:100%;object-fit:cover;display:block;border-radius:6px}
.song-item .song-title{font-family:var(--title-font);font-size:12.5px;font-weight:800;line-height:1.25;margin-top:6px;color:#1e293b;text-align:center;letter-spacing:-0.02em}
.songbook-actions{display:none}
@media print{
  @page{size:A4 portrait;margin:8mm}
  body{background:white;margin:0}
  .single-songbook{page-break-after:always;border:1px dashed #000!important;max-width:none!important;margin:0 0 12mm 0;box-shadow:none!important;padding:8mm!important}
  .thumb-crop img{-webkit-print-color-adjust:exact;print-color-adjust:exact;object-fit:cover!important}
  .song-item .song-title{font-family:var(--title-font)!important;font-weight:800!important}
}
</style>
</head>
<body class="${currentFontClass}">
${previewHtml}
</body>
</html>`;

  download(doc, `${slug(title)}_송북.html`, 'text/html;charset=utf-8');
};

$('downloadMp3Btn').onclick = () => {
  const modal = $('mp3Modal');
  const list = $('mp3List');
  list.innerHTML = '';

  const selectedTracks = tracks.filter((t, i) => data[i]?.selected);
  if (!selectedTracks.length) { alert('선택된 곡이 없습니다.'); return; }

  selectedTracks.forEach(t => {
    const c = (data[t.order].candidates || []).find(x => x.audioPick) || (data[t.order].candidates || [])[0];
    const row = document.createElement('div');
    row.className = 'mp3-item';
    
    const savefromUrl = c?.url ? `https://en.savefrom.net/1-youtube-video-downloader-78a/?url=${encodeURIComponent(c.url)}` : '';
    const yt1sUrl = c?.url ? `https://yt1s.com/en/youtube-to-mp3?q=${encodeURIComponent(c.url)}` : '';
    const loaderUrl = c?.url ? `https://loader.to/api/button/?url=${encodeURIComponent(c.url)}&f=mp3` : '';

    row.innerHTML = `
      <div>
        <strong style="font-size:13px">${escapeAttr(t.name)}</strong>
        <div style="font-size:11px;color:var(--muted)">${escapeAttr(c?.title || '후보 미선택')}</div>
      </div>
      <div class="mp3-btn-group">
        ${c?.url ? `
          <a href="${savefromUrl}" target="_blank" class="btn accent" style="font-size:11px;text-decoration:none;padding:4px 8px">다운로드 1</a>
          <a href="${yt1sUrl}" target="_blank" class="btn" style="font-size:11px;text-decoration:none;padding:4px 8px">다운로드 2</a>
          <a href="${loaderUrl}" target="_blank" class="btn" style="font-size:11px;text-decoration:none;padding:4px 8px">다운로드 3</a>
        ` : '<span style="font-size:11px;color:var(--muted)">URL 없음</span>'}
      </div>
    `;
    list.appendChild(row);
  });

  modal.style.display = 'flex';
};

$('downloadUrlTxt').onclick = () => {
  const lines = [];
  tracks.forEach(t => {
    if (!data[t.order]?.selected) return;
    const c = (data[t.order].candidates || []).find(x => x.audioPick) || (data[t.order].candidates || [])[0];
    if (c?.url) lines.push(`${t.name}: ${c.url}`);
  });
  download(lines.join('\r\n'), `${slug($('album').value)}_음원링크.txt`, 'text/plain;charset=utf-8');
};

$('downloadPyScript').onclick = () => {
  const albumName = $('album').value.trim() || '타요의 씽씽극장';
  const urls = [];
  tracks.forEach(t => {
    if (!data[t.order]?.selected) return;
    const c = (data[t.order].candidates || []).find(x => x.audioPick) || (data[t.order].candidates || [])[0];
    if (c?.url) urls.push({ name: t.name, url: c.url });
  });

  if (!urls.length) { alert('선택된 음원 URL이 없습니다.'); return; }

  const pyCode = `# -*- coding: utf-8 -*-
import os, subprocess, sys

try:
    import yt_dlp
except ImportError:
    print("yt-dlp 설치 중...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "yt-dlp"])

tracks = ${JSON.stringify(urls, null, 2)}
folder = "${slug(albumName)}_MP3"
os.makedirs(folder, exist_ok=True)

for i, t in enumerate(tracks, 1):
    print(f"[{i}/{len(tracks)}] {t['name']} 다운로드 중...")
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-x", "--audio-format", "mp3", "--audio-quality", "0",
        "-o", os.path.join(folder, f"{i:02d}_{t['name']}.%(ext)s"),
        t["url"]
    ]
    subprocess.run(cmd)

print(f"\n모든 곡이 '{folder}' 폴더에 성공적으로 저장되었습니다!")
`;
  download(pyCode, `${slug(albumName)}_전곡다운로더.py`, 'text/x-python;charset=utf-8');
};

$('downloadBatScript').onclick = () => {
  const albumName = $('album').value.trim() || '타요의 씽씽극장';
  const urls = [];
  tracks.forEach(t => {
    if (!data[t.order]?.selected) return;
    const c = (data[t.order].candidates || []).find(x => x.audioPick) || (data[t.order].candidates || [])[0];
    if (c?.url) urls.push(`yt-dlp -x --audio-format mp3 -o "${albumName}/%(title)s.%(ext)s" "${c.url}"`);
  });

  if (!urls.length) { alert('다운로드할 음원 후보가 없습니다.'); return; }
  const batContent = `@echo off\r\nchcp 65001 > nul\r\necho [${albumName}] MP3 일괄 다운로드를 진행합니다...\r\n` + urls.join('\r\n') + '\r\npause';
  download(batContent, `${slug(albumName)}_일괄다운로드.bat`, 'text/plain;charset=utf-8');
};

$('print').onclick = () => window.print();

$('savecsv').onclick = () => {
  const albumName = $('album').value.trim() || '앨범';
  const rows = [['앨범이름', '곡이름', '유튜브 타이틀', '유튜브 url', '재생시간']];
  tracks.forEach((t, i) => {
    if (!data[i].selected) return;
    const cs = data[i].candidates || [];
    const target = cs.find(c => c.audioPick) || cs.find(c => c.imagePick) || cs[0] || {};
    rows.push([albumName, t.name, target.title || '', target.url || '', target.duration || '']);
  });
  const csvContent = '\ufeff' + rows.map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n');
  download(csvContent, `${slug(albumName)}_음원목록.csv`, 'text/csv;charset=utf-8');
};

function isoDurationToSeconds(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0;
}
function secondsToDuration(sec) {
  if (!sec) return '0:00';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
function escapeAttr(s) {
  return String(s || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
function slug(s) {
  return String(s || 'album').replace(/[\\/:*?"<>|]/g, '_').trim() || 'album';
}
function download(content, name, type) {
  const blob = new Blob([content], { type }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

try {
  const savedKey = localStorage.getItem('albumToolYouTubeKey');
  if (savedKey && $('ytkey')) $('ytkey').value = savedKey;
} catch (e) {}
if ($('ytkey')) {
  $('ytkey').onchange = () => {
    try {
      const val = $('ytkey').value.trim();
      if (val) localStorage.setItem('albumToolYouTubeKey', val);
    } catch (e) {}
  };
}

// 이벤트 핸들러 바인딩
$('apply').onclick = searchAllCandidates;
$('all').onclick = () => { tracks.forEach((t, i) => data[i].selected = true); renderTracks(); renderEditors(); renderOutput(); };
$('none').onclick = () => { tracks.forEach((t, i) => data[i].selected = false); renderTracks(); renderEditors(); renderOutput(); };
$('album').onchange = renderEditors;
$('csvin').onclick = () => $('csvfile').click();
$('csvfile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const txt = await f.text();
  $('songs').value = txt.split(/\r?\n/).map(line => line.split(',')[0].replace(/^"|"$/g, '').trim()).filter(Boolean).join('\n');
  applySongs();
  tracks.forEach((t, i) => { if (data[i]) data[i].selected = true; });
  renderTracks();
  renderEditors();
  renderOutput();
  updateLineNumbers();
};

// 수록곡 입력창 실시간 라인 번호 동기화
if ($('songs')) {
  $('songs').addEventListener('input', updateLineNumbers);
  $('songs').addEventListener('scroll', () => {
    if ($('lineNumbers')) $('lineNumbers').scrollTop = $('songs').scrollTop;
  });
}

// 글씨체 실시간 변경 이벤트
if ($('fontSelect')) {
  try {
    const savedFont = localStorage.getItem('albumToolFont') || 'round';
    $('fontSelect').value = savedFont;
    document.body.className = `font-${savedFont}`;
  } catch (e) {}

  $('fontSelect').onchange = (e) => {
    const val = e.target.value;
    document.body.className = `font-${val}`;
    try {
      localStorage.setItem('albumToolFont', val);
    } catch (err) {}
    renderOutput();
  };
}

// 초기 로딩 실행
applySongs();
tracks.forEach((t, i) => { if (data[i]) data[i].selected = true; });
renderTracks();
renderEditors();
renderOutput();
updateLineNumbers();
