import express, { type Express } from 'express'
import bodyParser from 'body-parser'
import expressAsyncHandler from 'express-async-handler'
import { wait } from './timing-utils'

interface SumApiRequest {
  body: {
    summands: number[]
  }
}

/**
 * An endpoint for calculating the sum of a list of summands
 */
function sumApi (app: Express): void {
  app.post('/sum', expressAsyncHandler(async (req: SumApiRequest, res) => {
    try {
      const sum = req.body.summands.reduce((acc, value) => acc + value, 0)
      await wait(3000)
      res.status(200).json({ sum })
    } catch (err: any) {
      res.status(500).json({ message: err?.message })
    }
  }))
}

/**
 * Initialize Express API
 */
export function setupApi (port: number): Express {
  const app = express()

  // Middleware to parse JSON data in the request body
  app.use(bodyParser.json())

  // Set up the various endpoints
  sumApi(app)

  // Start the Express server
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
  })

  return app
}
