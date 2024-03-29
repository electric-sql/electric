-- Create an orders table.
-- Can be extended or modified to any arbitrary table
-- to fit your use case.
CREATE TABLE IF NOT EXISTS commerce_orders (
  order_id UUID PRIMARY KEY NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  price_amount REAL NOT NULL,
  price_currency VARCHAR NOT NULL,
  promo_code VARCHAR,
  customer_full_name VARCHAR NOT NULL,
  country VARCHAR NOT NULL,
  product VARCHAR NOT NULL
);

-- Index for timestamp column in commerce_orders table
CREATE INDEX commerce_orders_idx_timestamp ON commerce_orders(timestamp);

-- Index for country column in commerce_orders table
CREATE INDEX commerce_orders_idx_country ON commerce_orders(country);

-- ⚡ Electrify the table
ALTER TABLE commerce_orders ENABLE ELECTRIC;
