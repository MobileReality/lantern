import type { Book } from '../types/order';

const BOOKS_TABLE = 'books';
const ORDER_LINES_TABLE = 'order_lines';

export async function findBook(isbn: string): Promise<Book> {
  return query<Book>(`SELECT * FROM ${BOOKS_TABLE} WHERE isbn = $1`, [isbn]);
}

export async function decrementStock(orderId: string): Promise<void> {
  await query(
    `UPDATE ${BOOKS_TABLE} SET stock = stock - l.quantity FROM ${ORDER_LINES_TABLE} l WHERE l.order_id = $1 AND l.isbn = ${BOOKS_TABLE}.isbn`,
    [orderId],
  );
}

declare function query<T = void>(sql: string, params: unknown[]): Promise<T>;
