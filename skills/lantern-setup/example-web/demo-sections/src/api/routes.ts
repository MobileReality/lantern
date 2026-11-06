import { cancelOrder, payOrder, placeOrder, shipOrder } from '../services/orderService';
import type { Role } from '../types/order';
import { requireRole } from './guards';

interface Route {
  method: 'GET' | 'POST';
  path: string;
  roles: Role[];
  run: (email: string, orderId: string) => Promise<unknown>;
}

export const ROUTES: Route[] = [
  { method: 'POST', path: '/orders', roles: ['customer', 'clerk', 'manager'], run: (email) => placeOrder(email) },
  { method: 'POST', path: '/orders/:id/pay', roles: ['customer', 'clerk', 'manager'], run: (_email, id) => payOrder(id) },
  { method: 'POST', path: '/orders/:id/ship', roles: ['clerk', 'manager'], run: (_email, id) => shipOrder(id) },
  { method: 'POST', path: '/orders/:id/cancel', roles: ['manager'], run: (_email, id) => cancelOrder(id) },
];

export function allowed(route: Route, email: string): boolean {
  return requireRole(route.roles, email);
}
