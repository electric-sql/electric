import { useState } from "react"
import { useElectricFetch } from "./utilities"
import { Box, CircularProgress, Paper, Slider, Typography, Button } from "@mui/material"

interface SumResult {
  sum: number
}

export const Calculator = ({ defaultSummands = [5, 10]}: { defaultSummands?: number[] }) => {
  const [ summands, setSummands ] = useState<number[]>(defaultSummands)

  // Request data from your API's /sum endpoint, see
  // utilities.ts for useElectricFetch's implementation
  const {
    response,
    requestProcessing,
    cancelRequest
  } = useElectricFetch<SumResult>({
    path: '/sum',
    method: 'POST',
    data: JSON.stringify({ summands }),
  })

  return <CaclulatorView
    defaultSummands={defaultSummands}
    summands={summands}
    sum={response?.data?.sum ?? null}
    processing={requestProcessing}
    cancelled={!cancelRequest}
    onCancel={cancelRequest}
    onSummandChange={(newSummand, index) => setSummands((prevSummands) => {
      const newSummands = [...prevSummands];
      newSummands[index] = newSummand;
      return newSummands;
    })}
  />
}

const CaclulatorView = ({
  defaultSummands,
  summands,
  sum,
  processing,
  cancelled,
  onCancel,
  onSummandChange,
  summandRange = [-100, 100],
} : {
  defaultSummands: number[],
  summands: number[],
  sum: number | null,
  processing: boolean,
  cancelled: boolean,
  onCancel?: () => void
  onSummandChange: (newSummand : number, index : number) => void
  summandRange? : [number, number]
}) => {
  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{
        display: 'flex',
        flexDirection: 'row', 
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <Typography variant="h5">
          Summands
        </Typography>
        <Button 
          variant="text" color="info"
          disabled={sum !== null || cancelled}
          onClick={onCancel}
        >
          { processing && 
            <CircularProgress color="info" size={15} sx={{ mr: 1 }} />
          }
          Cancel request
        </Button>
      </Box>
      {
        summands.map((summand, index) => (
          <Slider
            key={index}
            sx={{ pt: 10 }}
            min={summandRange[0]}
            max={summandRange[1]}
            defaultValue={defaultSummands[index]}
            valueLabelDisplay="on"
            onChangeCommitted={(_, value) =>
              value !== summand && onSummandChange(value as number, index)
            }
          />
        ))
      }
      <Typography variant="h5">
        Sum
      </Typography>
      <Slider
        key="sum"
        sx={{ pt: 10 }}
        min={summandRange[0] * summands.length}
        max={summandRange[1] * summands.length}
        value={sum ?? 0}
        valueLabelDisplay={sum !== null && !processing ? "on" : "off"}
        disabled
      />
    </Paper>
  )
}