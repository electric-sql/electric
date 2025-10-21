import { ShapeStreamOptions } from "@electric-sql/client"
import { baseUrl, source_id, secret } from "./electric"

export const issueShape: ShapeStreamOptions = {
  url: `${baseUrl}/v1/shape/`,
  params: {
    table: "issue",
    secret,
    source_id,
  },
}
