FROM python:3.10-slim

# ffmpeg 및 필수 패키지 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python 의존성 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 애플리케이션 파일 복사
COPY . .

# Hugging Face 및 클라우드 포트 지정 (기본 7860 또는 8000)
ENV PORT=7860
EXPOSE 7860

# 서버 실행
CMD ["python", "server.py"]
