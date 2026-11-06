import { roleFor } from '../services/authService';
import type { Role } from '../types/order';

export function requireRole(allowed: Role[], email: string): boolean {
  return allowed.includes(roleFor(email));
}
