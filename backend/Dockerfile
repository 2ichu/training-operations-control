# 백엔드 이미지. 두 단계를 쓴다:
#  - build: 개발 의존성 포함 전체(빌드·마이그레이션 node-pg-migrate·시드 tsx). compose 의 migrate 서비스가 이 단계를 쓴다.
#  - runtime: 운영 의존성만 + 빌드 결과(dist). API 서버는 이 단계로 실행한다.
# Node 24(npm 11) — package-lock.json 과 npm ci 가 일치하는 버전(CI 와 동일).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# 사내 프록시처럼 자체 CA 가 필요한 망이면 빌드 비밀로 넘긴다(선택): docker build --secret id=extra_ca,src=<CA.pem> ...
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/extra_ca ] && echo /run/secrets/extra_ca) npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/extra_ca ] && echo /run/secrets/extra_ca) npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
# 첨부 저장소(볼륨으로 마운트). 컨테이너는 root 가 아닌 node 사용자로 실행한다
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health > /dev/null || exit 1
CMD ["node", "dist/main"]
