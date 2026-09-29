import type { NextFunction, Request, Response } from 'express';

// API 응답 공통 보안 헤더. nginx 앞단이 없어도(직접 노출·개발) 같은 보호가 걸리도록 백엔드에서도 붙인다.
// - nosniff: 첨부 다운로드 등에서 브라우저가 내용을 추측해 실행하지 못하게 한다.
// - no-store: 개인정보(훈련생·강사)가 담긴 응답이 브라우저·중간 프록시 캐시에 남지 않게 한다.
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  next();
}
