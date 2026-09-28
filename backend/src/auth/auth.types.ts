import type { Request } from 'express';
import type { SessionData } from './session.store.js';

export interface AuthenticatedRequest extends Request {
  authSession?: SessionData;
  authSessionId?: string;
}

export interface AuthUser {
  userId: number;
  loginId: string;
  name: string;
  roles: string[];
  linkedInstructorId: number | null;
  mustChangePassword: boolean;
}

export interface PermissionGrant {
  screenId: string;
  action: string;
  scope: string;
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
