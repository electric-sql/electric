import { faker } from "@faker-js/faker"
import { v4 as uuidv4 } from 'uuid'
import { type Pool } from 'pg'
import { checkTableExists } from "./pg-utils"


const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000

const PROMO_CODES = [
  'XMAS', 'BLACK_FRIDAY', 'RETURNING'
]

function maybeGeneratePromoCode(): string | null {
  if (Math.random() < 0.8) return null
  return faker.helpers.arrayElement(PROMO_CODES)
}

function maybeGenerateCity(): string | null {
  if (Math.random() < 0.8) return null
  return faker.location.city()
}

function generateOrder(orderId: string) {
  return [
    orderId,
    faker.date.between({
      from: Date.now() - YEAR_MS,
      to: Date.now()
    }).toISOString(),
    Math.round(parseFloat(faker.commerce.price()) * 100),
    faker.finance.currencyCode(),
    maybeGeneratePromoCode(),
    faker.person.fullName(),
    faker.location.country(),
    maybeGenerateCity()
  ]
}

function generateLineItems(orderId: string) {
  return faker.helpers.multiple(
    () => (
      [
        uuidv4(),
        orderId,
        faker.commerce.product(),
        faker.number.int({ min: 1, max: 3})
      ]
    ),
    {
      count: faker.number.int({ min: 1, max: 3 })
    }
  )
}

/**
 * Generates and inserts [numOrders] rows to orders and line items
 */
export async function batchInsertOrders(
  pgPool: Pool,
  numOrders: number = 10000
) {
  // wait for tables to exist
  await Promise.all([
    checkTableExists(pgPool, 'commerce_orders'),
    checkTableExists(pgPool, 'commerce_line_items')
  ])

  const client = await pgPool.connect();

  try {
    console.log(`Generating ${numOrders} random commerce orders.`)
    // Generate orders and line items
    const orders = []
    const lineItems = []
    for (let i = 0; i < numOrders; i++) {
      const orderId = uuidv4()
      orders.push(generateOrder(orderId))
      lineItems.push(...generateLineItems(orderId))
    }

    // Start a transaction
    await client.query('BEGIN');

    // Insert orders
    const insertOrderQuery = `
      INSERT INTO commerce_orders(order_id, timestamp, price_amount_cents, price_currency, promo_code, customer_full_name, country, city)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`

    // Insert line items
    const insertLineItemQuery = `
    INSERT INTO commerce_line_items(line_item_id, order_id, product_name, quantity)
    VALUES ($1, $2, $3, $4);`

    // NOTE(msfstef): definitely not the best way to do this but it'll do
    console.log(`Inserting ${orders.length} orders and ${lineItems.length} associated line items.`)
    await Promise.all([
      ...orders.map((o) => client.query(insertOrderQuery, o)),
      ...lineItems.map((li) => client.query(insertLineItemQuery, li))
    ])

    // Commit the transaction
    await client.query('COMMIT');

    console.log(`Successfully inserted ${numOrders} orders and associated line items.`);
  } catch (error) {
    // Rollback the transaction in case of any error
    console.log(`Failed to generate and insert orders - rolling back transaction.`)
    await client.query('ROLLBACK');
    throw error;
  } finally {
    // Release the client back to the pool
    client.release();
  }
}