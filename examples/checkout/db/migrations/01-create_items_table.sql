-- Shop items
CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL, -- A URL-friendly identifier, used for assets
  name TEXT NOT NULL,
  price INTEGER NOT NULL,  -- In cents
  description TEXT NOT NULL
);
ALTER TABLE items ENABLE ELECTRIC;

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY NOT NULL,
  electric_user_id UUID NOT NULL,
  recipient_name TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  delivery_postcode TEXT NOT NULL,
  delivery_country TEXT NOT NULL,
  delivery_price INTEGER NOT NULL,  -- In cents
  status TEXT NOT NULL,  -- One of 'pending', 'paid', 'shipped', 'cancelled'
  created_at TIMESTAMP NOT NULL
);
ALTER TABLE orders ENABLE ELECTRIC;

CREATE INDEX IF NOT EXISTS orders_electric_user_id_idx ON orders(electric_user_id);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at);

-- Basket items are a many-to-many relationship between baskets and items.
CREATE TABLE IF NOT EXISTS basket_items (
  id UUID PRIMARY KEY NOT NULL,
  electric_user_id UUID NOT NULL,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,  -- null until the item is purchased
  purchased_price INTEGER  -- null until the item is purchased
);
ALTER TABLE basket_items ENABLE ELECTRIC;

CREATE INDEX IF NOT EXISTS basket_items_order_id_idx ON basket_items(order_id);
CREATE INDEX IF NOT EXISTS basket_items_electric_user_id_idx ON basket_items(electric_user_id);
CREATE INDEX IF NOT EXISTS basket_items_item_id_idx ON basket_items(item_id);
