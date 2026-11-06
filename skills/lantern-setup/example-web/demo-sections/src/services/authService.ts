import type { Role } from '../types/order';

const MANAGER_EMAILS = ['owner@bookshop.example'];
const CLERK_EMAILS = ['till@bookshop.example', 'stockroom@bookshop.example'];

export function roleFor(email: string): Role {
  if (MANAGER_EMAILS.includes(email)) return 'manager';
  if (CLERK_EMAILS.includes(email)) return 'clerk';
  return 'customer';
}
