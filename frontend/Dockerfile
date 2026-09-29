# 프론트엔드 이미지: Vite 로 빌드한 정적 파일을 nginx 로 제공하고 /api 는 백엔드로 넘긴다(nginx.conf).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# 사내 프록시처럼 자체 CA 가 필요한 망이면 빌드 비밀로 넘긴다(선택): docker build --secret id=extra_ca,src=<CA.pem> ...
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/extra_ca ] && echo /run/secrets/extra_ca) npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
