# 배포·운영 가이드

단일 서버에 Docker Compose 로 올리는 구성을 기준으로 한다. 구성 요소는 4개다.

| 서비스 | 이미지 | 역할 |
|---|---|---|
| `db` | postgres:16-alpine | 업무 DB. 데이터는 `pgdata` 볼륨 |
| `migrate` | backend(build 단계) | 배포 때마다 1회 실행: 스키마 마이그레이션 → 기준 데이터 시드(역할·권한·탐지규칙·최초 관리자). 둘 다 멱등 |
| `backend` | backend(runtime 단계) | API 서버(NestJS, 3000 포트, 외부 비공개). 첨부는 `uploads` 볼륨 |
| `web` | frontend(nginx) | 화면(정적 파일) + `/api` 리버스 프록시. 외부 공개 포트(기본 8080) |

```
브라우저 ──HTTPS──▶ (TLS 종료: 로드밸런서·호스트 nginx 등) ──HTTP──▶ web:80 ──/api──▶ backend:3000 ──▶ db:5432
```

## 1. 최초 배포

1. 서버에 Docker(Compose v2 포함)를 설치하고 이 저장소를 받는다.
2. 설정 파일을 만든다.
   ```bash
   cp deploy.env.example deploy.env
   # POSTGRES_PASSWORD, SEED_ADMIN_LOGIN_ID, SEED_ADMIN_PASSWORD 를 채운다(deploy.env 는 커밋하지 않는다 — .gitignore)
   ```
3. 빌드하고 올린다.
   ```bash
   docker compose --env-file deploy.env up -d --build
   docker compose --env-file deploy.env ps        # backend·web 이 healthy/running, migrate 는 Exited (0)
   curl -s http://localhost:8080/api/v1/health    # {"status":"ok"}
   ```
4. `SEED_ADMIN_LOGIN_ID` / `SEED_ADMIN_PASSWORD` 로 로그인해 **바로 비밀번호를 바꾼다**(오른쪽 위 "비밀번호 변경"). 이후 계정은 시스템 관리 > 사용자(S25)에서 만든다 — 임시 비밀번호가 발급되고 첫 로그인 때 변경이 강제된다.

> 사내 프록시처럼 자체 CA 인증서가 필요한 망에서 `npm ci` 가 `SELF_SIGNED_CERT_IN_CHAIN` 으로 실패하면 CA 를 빌드 비밀로 넘긴다.
> ```bash
> docker build --secret id=extra_ca,src=/path/to/ca.pem --target build   -t training-ops-migrate ./backend
> docker build --secret id=extra_ca,src=/path/to/ca.pem --target runtime -t training-ops-backend ./backend
> docker build --secret id=extra_ca,src=/path/to/ca.pem                  -t training-ops-web     ./frontend
> docker compose --env-file deploy.env up -d --no-build
> ```

## 2. HTTPS(필수)

운영에서는 반드시 HTTPS 로 접속하게 한다. 백엔드는 `NODE_ENV=production`(이미지 기본값)이면 세션 쿠키를 `Secure` 로 내보내므로 **HTTP 로는 로그인이 되지 않는다**.

- `web` 앞에 TLS 를 끝내는 프록시(로드밸런서·호스트 nginx·Caddy 등)를 두고 `http://<서버>:8080` 으로 넘긴다.
- 앞단 프록시가 `X-Forwarded-For` 를 붙이면 감사로그·로그인 기록에 실제 접속 IP 가 남는다. 프록시 단계가 늘면 `TRUST_PROXY` 를 그 수(예: `2`)로 바꾼다.
- TLS 없이 내부망에서 시험만 할 때는 `deploy.env` 에 `SESSION_COOKIE_SECURE=false` 를 둔다(운영 금지).

## 3. 업데이트 배포

```bash
git pull
docker compose --env-file deploy.env up -d --build
```
`migrate` 가 새 마이그레이션만 적용하고(이미 적용된 것은 건너뜀) 시드를 다시 확인한 뒤 backend 가 새 버전으로 바뀐다. 적용 전에는 **백업을 먼저 받는다**(아래 5).

- 마이그레이션 되돌리기가 필요하면: `docker compose --env-file deploy.env run --rm migrate npm run migrate:down` (한 단계씩). 되돌리기 전에 백업을 받는다.
- backend 는 종료 신호(SIGTERM)를 받으면 진행 중인 배치·출결 이벤트 평가를 마치고 DB 연결을 닫은 뒤 끝난다(`stop_grace_period: 30s`).

## 4. 환경변수

`deploy.env` 에 둔다. compose 가 `DATABASE_URL`·`TRUST_PROXY` 는 자동으로 채운다.

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `POSTGRES_PASSWORD` | O | — | DB 비밀번호(`db` 초기화·backend 접속에 함께 쓰임). 처음 볼륨을 만들 때 정해지므로 나중에 바꾸려면 DB 안에서도 바꿔야 한다 |
| `POSTGRES_DB` / `POSTGRES_USER` | | `training_mgmt` / `training_owner` | DB 이름·계정 |
| `SEED_ADMIN_LOGIN_ID` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | O | — | 최초 시스템 관리자. `migrate` 가 배포마다 시드를 확인하므로 **계속 채워 둔다**(비우면 migrate 가 실패하고 backend 가 뜨지 않는다). 같은 로그인ID 가 이미 있으면 건너뛰고, 비밀번호를 나중에 바꿔도 덮어쓰지 않는다 |
| `WEB_PORT` | | `8080` | 외부 공개 포트 |
| `SESSION_COOKIE_SECURE` | | `true`(production) | 2절 참고 |
| `SESSION_IDLE_MINUTES` / `SESSION_ABSOLUTE_HOURS` | | `30` / `8` | 세션 유휴·절대 만료(D-15/#29 확정값) |
| `LOGIN_MAX_FAILURES` / `LOGIN_LOCK_MINUTES` | | `5` / `15` | 로그인 실패 잠금(D-15/#29 확정값) |
| `SESSION_COOKIE_NAME` | | `sid` | 세션 쿠키 이름 |
| `APP_TIMEZONE` | | `Asia/Seoul` | "진행완료"·배치·오늘 판단 기준 시간대 |
| `BATCH_ENABLED` | | `true` | 시간 기반 배치(RULE_03~06, 과정 자동 운영중 전환)와 입실 후 RULE_01·02 평가. **backend 를 여러 대 띄우면 한 대만 `true`** (decisions P5-07) |
| `DB_POOL_MAX` | | `10` | DB 커넥션 풀 크기 |
| `TRUST_PROXY` | | compose: `1` | 믿을 앞단 프록시 수(또는 Express trust proxy 값). 비우면 직접 접속 IP |
| `UPLOAD_DIR` / `PORT` | | `/app/uploads` / `3000` | 이미지 기본값 — 바꿀 일 없음 |

## 5. 백업·복원

DB 와 첨부 볼륨을 **같은 시점에** 받는다(첨부 행은 DB 에, 파일은 볼륨에 있다).

```bash
# 백업
docker compose --env-file deploy.env exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backup-$(date +%F).dump
docker run --rm -v training-ops_uploads:/data -v "$PWD":/backup alpine tar czf /backup/uploads-$(date +%F).tgz -C /data .

# 복원(빈 DB 에) — 서비스를 멈추고 진행
docker compose --env-file deploy.env stop backend web
docker compose --env-file deploy.env exec -T db sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose --env-file deploy.env exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < backup-YYYY-MM-DD.dump
docker run --rm -v training-ops_uploads:/data -v "$PWD":/backup alpine sh -c 'rm -rf /data/* && tar xzf /backup/uploads-YYYY-MM-DD.tgz -C /data'
docker compose --env-file deploy.env start backend web
```

- 감사로그(`audit_log`)·변경이력은 append-only 이고 계속 쌓인다. 보존 기간·정리 정책은 정해지지 않았다(baseline 결정 필요 사항) — 정해질 때까지 지우지 않는다.

## 6. 점검·장애 대응

| 확인할 것 | 방법 |
|---|---|
| 살아 있는지 | `curl http://localhost:8080/api/v1/health` → `{"status":"ok"}`(로그인 불필요). DB 에 닿지 않으면 503 `DB_UNAVAILABLE`. compose 가 30초마다 확인해 `backend` 상태(healthy)에 반영 |
| 로그 | `docker compose --env-file deploy.env logs -f backend` — 배치 실행 결과(작업명·소요시간·건수)도 여기에 남는다(P5-08) |
| 로그인이 안 됨(HTTP) | 2절 — Secure 쿠키. HTTPS 로 접속하거나 시험용으로만 `SESSION_COOKIE_SECURE=false` |
| 감사로그 IP 가 모두 같은 값 | 앞단 프록시가 `X-Forwarded-For` 를 넘기는지, `TRUST_PROXY` 가 프록시 단계 수와 맞는지 |
| 첨부 업로드 실패 | 20MB 초과(`FILE_TOO_LARGE`). 앞단 프록시의 요청 크기 제한도 25MB 이상인지 |
| 관리자 계정이 모두 잠김·비활성 | 화면에서는 마지막 활성 시스템 관리자를 비활성화할 수 없다(P5-09). 그래도 로그인할 수 없으면 `deploy.env` 의 `SEED_ADMIN_LOGIN_ID` 를 새 값으로 바꾸고 `docker compose --env-file deploy.env run --rm migrate npm run db:seed` 로 새 관리자를 만든다 |
| 탐지 배치가 두 번 돈다 | backend 를 여러 대 띄웠다면 한 대만 `BATCH_ENABLED=true`(중복 건은 생기지 않지만 불필요한 실행이 늘어난다) |

## 7. 아직 정해지지 않은 운영 항목

코드는 임시값으로 동작하며, 정해지면 환경변수·설정만 바꾼다.

- 세션·로그인 잠금 정책값(STEP 12 #29)
- 감사로그 보존 기간, 첨부 저장소(현재 서버 로컬 볼륨, D-14)
- 결과물 제출기한 저장 위치(#24), 공식 출결 연계·RULE_07(D-12)
