import { Box, Select, MenuItem, TextField, Typography, Fade, Button } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { HttpMethod } from '../use_electric_query'

export const RequestFormView = ({
  paths,
  methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  initialPayload,
  disableOnSubmit = false,
  onSend,
}: {
  paths: string[]
  methods?: HttpMethod[]
  initialPayload?: string
  disableOnSubmit?: boolean
  onSend: (method: HttpMethod, path: string, payload: string | null) => void
}) => {
  const [submitted, setSubmitted] = useState(false)
  const [method, setMethod] = useState<HttpMethod>('POST')
  const [path, setPath] = useState(paths[0])
  const [payload, setPayload] = useState<string | null>(initialPayload ?? null)
  const includePayload = useMemo(
    () => method == 'POST' || method == 'PUT' || method == 'PATCH',
    [method],
  )
  const handleSend = (method: HttpMethod, path: string, payload: string | null) => {
    onSend(method, path, payload)
    setSubmitted(true)
  }

  // reset submission state on change
  useEffect(() => setSubmitted(false), [method, path, payload])

  return (
    <Box display="flex" flexDirection="row" justifyContent="space-between">
      <Box
        display="flex"
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        minWidth="650px">
        <Typography variant="h5">Request:</Typography>
        <Select
          value={method}
          sx={{ minWidth: 120 }}
          onChange={(e) => setMethod(e.target.value as HttpMethod)}>
          {methods.map((method) => (
            <MenuItem key={method} value={method}>
              {method}
            </MenuItem>
          ))}
        </Select>
        <Select value={path} sx={{ minWidth: 200 }} onChange={(e) => setPath(e.target.value)}>
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
            onChange={(e) => setPayload(e.target.value?.length > 0 ? e.target.value : null)}
          />
        </Fade>
      </Box>
      <Button
        disabled={disableOnSubmit && submitted}
        variant="outlined"
        sx={{ px: 4 }}
        onClick={() => handleSend(method, path, includePayload ? payload : null)}>
        Send
      </Button>
    </Box>
  )
}
