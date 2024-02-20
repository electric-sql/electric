import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Box,
  Typography,
} from '@mui/material'
import { CheckCircleOutline, Done, ErrorOutline } from '@mui/icons-material'

const getStatusIcon = (loading: boolean) =>
  loading ? <CircularProgress size={24} /> : <Done color="success" />

const getResponseIcon = (data: unknown, error: unknown) =>
  data ? <CheckCircleOutline color="success" /> : error ? <ErrorOutline color="error" /> : null

export const RequestResultView = ({
  data,
  error,
  isPending,
  isFetching,
}: {
  data: unknown
  error: unknown
  isPending: boolean
  isFetching: boolean
}) => {
  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell align="center" width={100}>
              Submitted
            </TableCell>
            <TableCell align="center" width={100}>
              Processed
            </TableCell>
            <TableCell>Response</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell align="center">{getStatusIcon(isPending)}</TableCell>
            <TableCell align="center">{!isPending && getStatusIcon(isFetching)}</TableCell>
            <TableCell>
              <Box display="flex" gap={1}>
                {getResponseIcon(data, error)}
                <Typography>{JSON.stringify(data ?? error)}</Typography>
              </Box>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  )
}
