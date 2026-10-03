import { ShapeStreamOptions } from '@electric-sql/client'
import { baseUrl } from './electric'

export const issueShape: ShapeStreamOptions = {
  url: `${baseUrl}/v1/shape`,
  params: {
    table: `issue`,
  },
}
