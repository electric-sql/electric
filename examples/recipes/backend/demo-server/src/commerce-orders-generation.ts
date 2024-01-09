import { faker } from "@faker-js/faker"
import { v4 as uuidv4 } from 'uuid'
import { type Pool } from 'pg'
import { waitForTable } from "./pg-utils"


const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000

const PROMO_CODES = [
  'XMAS', 'BLACK_FRIDAY', 'RETURNING'
]

function maybeGeneratePromoCode(): string | null {
  if (Math.random() < 0.8) return null
  return faker.helpers.arrayElement(PROMO_CODES)
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
    faker.commerce.product(),
  ]
}

/**
 * Generates and inserts [numOrders] rows to orders and line items
 */
export async function batchInsertOrders(
  pgPool: Pool,
  numOrders: number = 10000
) {
  // wait for table to exist
  await waitForTable(pgPool, 'commerce_orders');

  const client = await pgPool.connect();

  try {
    console.log(`Generating ${numOrders} random commerce orders.`)
    // Generate orders
    const orders = []
    for (let i = 0; i < numOrders; i++) {
      const orderId = uuidv4()
      orders.push(generateOrder(orderId))
    }

    // Start a transaction
    await client.query('BEGIN');

    // Insert orders
    const insertOrderQuery = `
      INSERT INTO commerce_orders(order_id, timestamp, price_amount, price_currency, promo_code, customer_full_name, country, product)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`

    // NOTE(msfstef): definitely not the best way to do this but it'll do
    console.log(`Inserting ${orders.length} orders.`)
    await Promise.all(orders.map((o) => client.query(insertOrderQuery, o)))

    // Commit the transaction
    await client.query('COMMIT');

    console.log(`Successfully inserted ${numOrders} orders.`);
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