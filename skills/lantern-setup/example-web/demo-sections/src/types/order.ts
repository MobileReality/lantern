export type Role = 'customer' | 'clerk' | 'manager';

export type OrderStatus = 'placed' | 'paid' | 'shipped' | 'cancelled';

export interface Book {
  isbn: string;
  title: string;
  priceCents: number;
  stock: number;
}

export interface Order {
  id: string;
  customerEmail: string;
  status: OrderStatus;
  totalCents: number;
}

export interface OrderLine {
  orderId: string;
  isbn: string;
  quantity: number;
}
