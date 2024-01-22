import express, { type Express } from 'express'
import bodyParser from 'body-parser'
import expressAsyncHandler from 'express-async-handler'
import { wait } from './timing-utils'
import { faker } from '@faker-js/faker'

interface SumApiRequest {
  body: {
    summands: number[]
  }
}

/**
 * An endpoint for calculating the sum of a list of summands
 */
function randomResultApi (app: Express): void {
  app.get('/random-result', expressAsyncHandler(async (req: SumApiRequest, res) => {
    try {
      await wait(Math.random() * 1000)
      res.status(200).json({
        message: faker.word.words({ count: { min: 2, max: 4 }})
      })
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
  randomResultApi(app)

  // Start the Express server
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
  })

  return app
}
