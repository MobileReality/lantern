import { decrementStock } from '../repositories/bookRepository';
import { findOrder, insertOrder, setStatus } from '../repositories/orderRepository';
import type { Order } from '../types/order';

export async function placeOrder(customerEmail: string): Promise<Order> {
  return insertOrder({ customerEmail, status: 'placed', totalCents: 0 });
}

export async function payOrder(id: string): Promise<Order> {
  const order = await findOrder(id);
  if (order.status !== 'placed') throw new Error('only a placed order can be paid');
  await decrementStock(id);
  return setStatus(id, 'paid');
}

export async function shipOrder(id: string): Promise<Order> {
  const order = await findOrder(id);
  if (order.status !== 'paid') throw new Error('only a paid order can ship');
  return setStatus(id, 'shipped');
}

export async function cancelOrder(id: string): Promise<Order> {
  const order = await findOrder(id);
  if (order.status === 'shipped' || order.status === 'cancelled') throw new Error('this order is closed');
  return setStatus(id, 'cancelled');
}
