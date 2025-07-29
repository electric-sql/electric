import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Database connection setup
 *
 * This file exports the database connection and Drizzle ORM instance
 * that will be used throughout the application.
 */

// Database connection string
const connectionString =
  "postgres://postgres:password@localhost:54321/electric";

// Create a Postgres client
const client = postgres(connectionString);

// Create a Drizzle ORM instance with the schema
export const db = drizzle(client, { schema });

// Export the schema for use in other parts of the application
export { schema };
