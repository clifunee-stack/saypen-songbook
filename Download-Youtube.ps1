param (
    [Parameter(Mandatory=$true)]
    [string[]]$Inputs
)

# UTF-8 한글 출력 설정
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$index = 1

foreach ($inputStr in $Inputs) {
    $prefix = "{0:D2}_" -f $index
    $targetUrl = ""
    
    # 1. 입력값이 URL인지 키워드인지 판별
    if ($inputStr -like "http://*" -or $inputStr -like "https://*") {
        $cleanUrl = $inputStr -replace '&list=.*$', ''
        Write-Host "`n[URL 입력] $cleanUrl 처리 중..." -ForegroundColor Cyan
        $targetUrl = $cleanUrl
    } else {
        Write-Host "`n[키워드 검색] '$inputStr' 검색 중 (하이브리드 필터 적용)..." -ForegroundColor Yellow
        
        # 상위 5개 검색 결과 추출
        $jsonOutputs = .\yt-dlp "ytsearch5:$inputStr" --dump-json --flat-playlist --quiet --no-warnings
        
        if (-not $jsonOutputs) {
            Write-Host "❌ 검색 결과를 찾지 못했습니다." -ForegroundColor Red
            $index++
            continue
        }
        
        # JSON 파싱
        $parsedEntries = $jsonOutputs | ForEach-Object { $_ | ConvertFrom-Json }
        
        # 하이브리드 필터링: 30초 이상 ~ 600초(10분) 이하 중 검색 순위가 가장 높은 영상 선택
        $selectedVideo = $parsedEntries | 
            Where-Object { $_.duration -ge 30 -and $_.duration -le 600 } | 
            Select-Object -First 1

        # 만약 필터 조건에 맞는 영상이 없으면 검색 결과 1위 영상 선택
        if (-not $selectedVideo) {
            $selectedVideo = $parsedEntries | Select-Object -First 1
        }
            
        $targetUrl = "https://www.youtube.com/watch?v=$($selectedVideo.id)"
        Write-Host "👉 선택된 영상: $($selectedVideo.title) (재생시간: $($selectedVideo.duration)초)" -ForegroundColor Green
    }

    # 2. 영상 제목 및 썸네일 URL 가져오기
    $jsonRaw = .\yt-dlp $targetUrl --dump-json --no-playlist --quiet --no-warnings 2>$null
    
    if (-not $jsonRaw) {
        Write-Host "❌ 영상 정보를 가져올 수 없습니다." -ForegroundColor Red
        $index++
        continue
    }

    $videoInfoJson = $jsonRaw | ConvertFrom-Json
    $title = $videoInfoJson.title
    $thumbnailUrl = $videoInfoJson.thumbnail

    # 특수문자 제거 및 파일명 지정
    $safeTitle = $title -replace '[\\/*?:"<>|]', ""
    if ([string]::IsNullOrWhiteSpace($safeTitle)) {
        $safeTitle = "Youtube_Audio"
    }
    $baseName = "$prefix$safeTitle"

    # 3. MP3 음원 다운로드 및 변환
    Write-Host "🎵 MP3 추출 중: $baseName.mp3" -ForegroundColor Yellow
    .\yt-dlp $targetUrl --no-playlist -x --audio-format mp3 --audio-quality 0 -o "$baseName.%(ext)s" --quiet --no-warnings

    # 4. 썸네일(JPG) 다운로드
    if ($thumbnailUrl) {
        Write-Host "🖼️ 썸네일 다운로드 중: $baseName.jpg" -ForegroundColor Yellow
        try {
            Invoke-WebRequest -Uri $thumbnailUrl -OutFile "$baseName.jpg"
        } catch {
            Write-Host "⚠️ 썸네일 다운로드 실패" -ForegroundColor DarkGray
        }
    }

    Write-Host "✅ 완료: $baseName" -ForegroundColor Green
    $index++
}