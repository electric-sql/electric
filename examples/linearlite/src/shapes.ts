import { ShapeStreamOptions } from '@electric-sql/next'
import { baseUrl, databaseId, token } from './electric'

console.log(import.meta.env)

export const issueShape: ShapeStreamOptions = {
  url: `${baseUrl}/v1/shape/issue`,
  databaseId,
  headers: {
    'Authorization': `Bearer ${token}`
  }
}
