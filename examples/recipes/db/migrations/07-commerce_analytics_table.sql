/* This is an example of an SQL DDL migration. It creates tables and
 * then calls an `electric.electrify` procedure to expose the tables to the
 * ElectricSQL replication machinery.
 *
 * Note that these statements are applied directly to the *Postgres* database.
 * Electric then handles keeping the local SQLite database schema in sync with
 * the electrified subset of your Postgres database schema.
 *
 * See https://electric-sql.com/docs/usage/data-modelling for more information.
 */

-- Create an orders table.
CREATE TABLE IF NOT EXISTS commerce_orders (
  order_id UUID PRIMARY KEY NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  price_amount_cents INT NOT NULL,
  price_currency VARCHAR NOT NULL,
  promo_code VARCHAR,
  customer_full_name VARCHAR NOT NULL,
  country VARCHAR NOT NULL,
  city VARCHAR
);

-- Create a line items table such that every line item
-- links back to an order.
CREATE TABLE IF NOT EXISTS commerce_line_items (
  line_item_id UUID PRIMARY KEY NOT NULL,
  order_id UUID NOT NULL
    REFERENCES commerce_orders(order_id)
    ON DELETE CASCADE,
  product_name VARCHAR NOT NULL,
  quantity INT NOT NULL
);

-- Index for timestamp column in commerce_orders table
CREATE INDEX idx_timestamp ON commerce_orders(timestamp);

-- Index for country and city columns in commerce_orders table
CREATE INDEX idx_country_city ON commerce_orders(country, city);

-- ⚡
-- Electrify the commerce table
ALTER TABLE commerce_orders ENABLE ELECTRIC;
ALTER TABLE commerce_line_items ENABLE ELECTRIC;
