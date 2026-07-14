FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# 클라우드 빌드 중 브라우저 중복 다운로드로 인한 메모리/타임아웃 폭발 방지
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
# 클라우드 환경에 최적화된 클린 설치
RUN npm ci

COPY . .

# 포트 개방
EXPOSE 8080

# npm run 대신 node 직접 실행으로 시스템 시그널 오류 방지
CMD ["node", "src/mcp_server.js"]
