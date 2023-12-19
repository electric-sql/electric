import { useState } from "react"
import { useElectricFetch } from "./utilities"
import { Box, CircularProgress, Paper, Slider, Typography, Button } from "@mui/material"

interface SumResult {
  sum: number
}

export const Calculator = ({ initialSummands = [5, 10]}: { initialSummands?: number[] }) => {
  const [ summands, setSummands ] = useState<number[]>(initialSummands)

  const {
    response,
    requestProcessing,
    cancelRequest
  } = useElectricFetch<SumResult>({
    path: '/sum',
    method: 'POST',
    data: JSON.stringify({ summands }),
  })

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
          disabled={!!response || !cancelRequest}
          onClick={cancelRequest}
        >
          { requestProcessing && 
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
            min={-100}
            max={100}
            defaultValue={initialSummands[index]}
            valueLabelDisplay="on"
            onChangeCommitted={(_, value) => value !== summand ? setSummands((prevSummands) => {
              const newSummands = [...prevSummands]
              newSummands[index] = value as number
              return newSummands
            }) : null}
          />
        ))
      }
      <Typography variant="h5">
        Sum
      </Typography>
      <Slider
        key="sum"
        sx={{ pt: 10 }}
        min={-200}
        max={200}
        value={response?.statusCode == 200 ? response!.data!.sum : 0}
        valueLabelDisplay={!!response && !requestProcessing ? "on" : "off"}
        disabled
      />

    </Paper>
  )
}