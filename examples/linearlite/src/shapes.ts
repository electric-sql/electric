import { ShapeStreamOptions } from '@electric-sql/client'
import { baseUrl, databaseId, token } from './electric'

export const issueShape: ShapeStreamOptions = {
  url: `${baseUrl}/v1/shape/`,
  table: `issue`,
  databaseId,
  headers: {
    Authorization: `Bearer ${token}`,
  },
}
