import { faker } from '@faker-js/faker'

/**
 * Generates randomized web server log
 */
export function generateWebServerLog (): string {
  const ipAddress = faker.internet.ipv4()
  const httpMethod = faker.internet.httpMethod()
  const url = faker.internet.url()
  const statusCode = faker.internet.httpStatusCode({
    types: ['success', 'clientError', 'serverError']
  })
  return `${ipAddress} - ${httpMethod} ${url} - ${statusCode}`
}
