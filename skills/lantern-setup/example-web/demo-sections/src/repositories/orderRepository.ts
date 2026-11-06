import type { Order, OrderStatus } from '../types/order';

const ORDERS_TABLE = 'orders';

export async function findOrder(id: string): Promise<Order> {
  return query<Order>(`SELECT * FROM ${ORDERS_TABLE} WHERE id = $1`, [id]);
}

export async function insertOrder(order: Omit<Order, 'id'>): Promise<Order> {
  return query<Order>(`INSERT INTO ${ORDERS_TABLE} (customer_email, status, total_cents) VALUES ($1, $2, $3) RETURNING *`, [
    order.customerEmail,
    order.status,
    order.totalCents,
  ]);
}

export async function setStatus(id: string, status: OrderStatus): Promise<Order> {
  return query<Order>(`UPDATE ${ORDERS_TABLE} SET status = $2 WHERE id = $1 RETURNING *`, [id, status]);
}

declare function query<T>(sql: string, params: unknown[]): Promise<T>;
