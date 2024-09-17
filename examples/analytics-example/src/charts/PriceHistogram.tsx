import { useMemo, useState } from "react"
import { listingsTableName } from "../table"
import { useLiveQuery } from "@electric-sql/pglite-react"
import { Bar } from "react-chartjs-2"

export const PriceHistogram = () => {
  const availableCities = useLiveQuery<{ city: string }>(
    `SELECT DISTINCT city FROM ${listingsTableName}`,
    []
  )?.rows.map((row) => row.city) ?? [`Paris`]

  const [city, setCity] = useState(availableCities[0])

  const result = useLiveQuery<{
    bin_number: number
    price_range: string
    listings_count: number
  }>(
    `
    WITH price_limits AS (
      -- Get the minimum and maximum price in the dataset
      SELECT
        MIN(price) AS min_price,
        MAX(price) AS max_price
      FROM ${listingsTableName}
      WHERE city = $1
    ),
    bins AS (
      -- Calculate the width of each bin based on the min/max prices and divide into 10 bins
      SELECT
        min_price,
        max_price,
        LEAST(2 * min_price, GREATEST((max_price - min_price) / $2::float, 1.0)) AS bin_width
      FROM price_limits
    )
    SELECT
      -- Calculate which bin each price falls into
      FLOOR((price - b.min_price) / b.bin_width) AS bin_number,
      -- Create bin labels based on the bin number and width
      CONCAT(
        FLOOR(b.min_price + FLOOR((price - b.min_price) / b.bin_width) * b.bin_width), 
        '-', 
        FLOOR(b.min_price + (FLOOR((price - b.min_price) / b.bin_width) + 1) * b.bin_width)
      ) AS price_range,
      COUNT(*) AS listings_count
    FROM
      ${listingsTableName}, bins b
    WHERE
      city = $3
    GROUP BY
      bin_number, price_range
    ORDER BY
      bin_number;
  `,
    [city, 30, city]
  )

  const chartData = useMemo(
    () => ({
      labels: result?.rows.map((row) => row.price_range),
      datasets: [
        {
          label: `# of listings`,
          data: result?.rows.map((row) => row.listings_count) ?? [],
          backgroundColor: `rgba(75, 192, 192, 0.6)`,
          borderColor: `rgba(75, 192, 192, 1)`,
          borderWidth: 0,
          categoryPercentage: 1.0,
          barPercentage: 1.0,
        },
      ],
    }),
    [result]
  )

  return (
    <div>
      <select
        name="selectedCity"
        value={city}
        onChange={(e) => setCity(e.target.value)}
      >
        {availableCities.map((city) => (
          <option key={city} value={city}>
            {city}
          </option>
        ))}
      </select>
      <Bar
        data={chartData}
        options={{
          responsive: true,
          plugins: {
            legend: {
              display: false,
            },
            title: {
              display: true,
              text: `Histogram of Airbnb Listing Prices`,
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: `Number of Listings`,
              },
            },

            x: {
              title: {
                display: true,
                text: `Price Range (local currency)`,
              },
            },
          },
        }}
      />
    </div>
  )
}
