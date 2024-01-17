import { Box, Select, MenuItem, TextField, Typography, Fade, Button } from "@mui/material"
import { HttpMethod } from "./utilities"
import { useMemo, useState } from "react"


export const RequestFormView = ({
  methods,
  paths, 
  initialPayload,
  onSend,
} : {
  methods: HttpMethod[],
  paths: string[],
  initialPayload?: string,
  onSend: (method: HttpMethod, path: string, payload: string | null) => void,
}) => {
  const [ method, setMethod ] = useState(HttpMethod.POST)
  const [ path, setPath ] = useState(paths[0])
  const [ payload, setPayload ] = useState<string | null>(initialPayload ?? null)
  const includePayload = useMemo(
    () =>  method == HttpMethod.POST || method == HttpMethod.PUT,
    [method]
  )
  return (
    <Box display="flex" flexDirection="row" alignItems="center">
      <Typography variant="h5">
        Request:
      </Typography>
      <Select
        value={method}
        onChange={(e) => setMethod(e.target.value as HttpMethod)}>
        {methods.map((method) => (
          <MenuItem key={method} value={method}>
            {method}
          </MenuItem>
        ))}
      </Select>
      <Select
        value={path}
        onChange={(e) => setPath(e.target.value)}>
        {paths.map((path) => (
          <MenuItem key={path} value={path}>
            {path}
          </MenuItem>
        ))}
      </Select>
      <Fade in={includePayload}>
        <TextField
        label="Payload"
        variant="outlined"
        inputProps={{ maxLength: 100 }}
        value={payload}
        onChange={(e) => setPayload(e.target.value)}
        />
      </Fade>
      <Button onClick={() => onSend(method, path, includePayload ? payload : null)}>
        Send
      </Button>
    </Box>
    )
    }