CREATE TABLE books (
  isbn text PRIMARY KEY,
  title text NOT NULL,
  price_cents integer NOT NULL,
  stock integer NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_email text NOT NULL,
  status text NOT NULL CHECK (status IN ('placed', 'paid', 'shipped', 'cancelled')),
  total_cents integer NOT NULL
);

CREATE TABLE order_lines (
  order_id uuid NOT NULL REFERENCES orders (id),
  isbn text NOT NULL REFERENCES books (isbn),
  quantity integer NOT NULL
);
