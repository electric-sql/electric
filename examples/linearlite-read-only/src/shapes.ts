import { ShapeStreamOptions } from '@electric-sql/client'
import { baseUrl, source_id, source_secret } from './electric'

export const issueShape: ShapeStreamOptions = {
  url: `${baseUrl}/v1/shape/`,
  params: {
    table: `issue`,
    source_secret,
    source_id,
  },
}
