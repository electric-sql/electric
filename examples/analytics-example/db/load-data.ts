import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"
import AdmZip from "adm-zip"
import csvParser from "csv-parser"
import pg from "pg"

// Constants for folder and file paths
const DATA_FOLDER = path.join(
  fileURLToPath(path.dirname(import.meta.url)),
  "data"
)
const ZIP_URL = "https://maven-datasets.s3.amazonaws.com/Airbnb/Airbnb+Data.zip"
const ZIP_FILE_PATH = path.join(DATA_FOLDER, "Airbnb_Data.zip")
const CSV_FILE_PATH = path.join(DATA_FOLDER, "Airbnb Data", "Listings.csv")

// PostgreSQL connection configuration
if (!process.env.DATABASE_URL) {
  throw new Error('No "DATABASE_URL" environment variable found.')
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // idleTimeoutMillis: 0,
  connectionTimeoutMillis: 0,
})

// Function to check if a folder exists, and if not, create it
function ensureDirectoryExists(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log(`Created folder: ${dir}`)
  } else {
    console.log(`Folder already exists: ${dir}`)
  }
}

// Function to download the zip file if it doesn't exist
async function downloadZipFile(): Promise<void> {
  if (!fs.existsSync(ZIP_FILE_PATH)) {
    console.log(`Downloading zip file from ${ZIP_URL}...`)

    const response = await fetch(ZIP_URL)

    if (!response.ok) {
      throw new Error(`Failed to download zip file: ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    fs.writeFileSync(ZIP_FILE_PATH, Buffer.from(buffer))

    console.log(`Downloaded zip file to ${ZIP_FILE_PATH}`)
  } else {
    console.log("Zip file already exists.")
  }
}

// Function to extract the zip file
function extractZipFile(): void {
  if (!fs.existsSync(CSV_FILE_PATH)) {
    console.log("Extracting zip file...")
    const zip = new AdmZip(ZIP_FILE_PATH)
    zip.extractAllTo(DATA_FOLDER, true)
    console.log(`Extracted files to ${DATA_FOLDER}`)
  } else {
    console.log("CSV file already exists.")
  }
}

const safeParseFloat = (value: string) => {
  const parsed = parseFloat(value)
  return isNaN(parsed) ? null : parsed
}

const safeParseInt = (value: string) => {
  const parsed = parseInt(value)
  return isNaN(parsed) ? null : parsed
}

// Function to load CSV data into PostgreSQL
async function loadCsvToPostgres(): Promise<void> {
  if (!fs.existsSync(CSV_FILE_PATH)) {
    console.error("Listings.csv not found.")
    return
  }

  const client = await pool.connect()

  try {
    console.log("Loading data from Listings.csv into PostgreSQL...")
    await client.query(`BEGIN`)

    let rowCount = 0

    const stream = fs.createReadStream(CSV_FILE_PATH).pipe(csvParser())
    console.log(`Rows added: 0`)
    for await (const row of stream) {
      const query = `
      INSERT INTO airbnb_listings (
        listing_id, name, host_id, host_since, host_location, host_response_time, 
        host_response_rate, host_acceptance_rate, host_is_superhost, host_total_listings_count, 
        host_has_profile_pic, host_identity_verified, neighbourhood, district, city, 
        latitude, longitude, property_type, room_type, accommodates, bedrooms, amenities, 
        price, minimum_nights, maximum_nights, review_scores_rating, review_scores_accuracy, 
        review_scores_cleanliness, review_scores_checkin, review_scores_communication, 
        review_scores_location, review_scores_value, instant_bookable
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, 
        $31, $32, $33
      )`

      const values = [
        row.listing_id,
        row.name,
        row.host_id,
        row.host_since || null,
        row.host_location,
        row.host_response_time,
        safeParseFloat(row.host_response_rate),
        safeParseFloat(row.host_acceptance_rate),
        row.host_is_superhost === "t",
        safeParseInt(row.host_total_listings_count),
        row.host_has_profile_pic === "t",
        row.host_identity_verified === "t",
        row.neighbourhood,
        row.district,
        row.city,
        safeParseFloat(row.latitude),
        safeParseFloat(row.longitude),
        row.property_type,
        row.room_type,
        safeParseInt(row.accommodates),
        safeParseInt(row.bedrooms),
        row.amenities ? JSON.parse(row.amenities) : [],
        safeParseFloat(row.price),
        safeParseInt(row.minimum_nights),
        safeParseInt(row.maximum_nights),
        safeParseInt(row.review_scores_rating),
        safeParseInt(row.review_scores_accuracy),
        safeParseInt(row.review_scores_cleanliness),
        safeParseInt(row.review_scores_checkin),
        safeParseInt(row.review_scores_communication),
        safeParseInt(row.review_scores_location),
        safeParseInt(row.review_scores_value),
        row.instant_bookable === "t",
      ]

      await client.query(query, values)
      rowCount++
      if (rowCount % 1000 === 0) {
        process.stdout.moveCursor(0, -1)
        process.stdout.clearScreenDown()
        console.log(`Rows added: ${rowCount}`)
      }
    }

    console.log(`Finished loading ${rowCount} rows into PostgreSQL.`)

    await client.query(`COMMIT`)
  } catch (err) {
    await client.query(`ROLLBACK`)
    console.error("Error loading data into PostgreSQL:", err)
  } finally {
    client.release()
  }
}

// Main function
async function main() {
  // Ensure the 'db/data' folder exists
  ensureDirectoryExists(DATA_FOLDER)

  // Download the zip file if it's not already there
  await downloadZipFile()

  // Extract the zip file if the CSV is not already there
  extractZipFile()

  // Load CSV data into PostgreSQL
  await loadCsvToPostgres()
}

// Run the main function
main().catch((err) => {
  console.error("An error occurred:", err)
})
