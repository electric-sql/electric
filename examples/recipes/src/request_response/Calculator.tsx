import { useState } from "react"
import { useElectricFetch } from "./utilities"
import { Box, CircularProgress, Paper, Slider, Typography } from "@mui/material"

interface SumResult {
  sum: number
}

export const Calculator = () => {
  const [ summands, setSummands ] = useState<number[]>([5, 10])

  const {
    response,
    requestProcessing,
  } = useElectricFetch<SumResult>({
    path: '/sum',
    method: 'POST',
    data: JSON.stringify({ summands }),
  })

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h5">
        Summands
      </Typography>
      {
        summands.map((summand, index) => (
          <Slider
            key={index}
            sx={{ pt: 10 }}
            min={-100}
            max={100}
            defaultValue={summand}
            valueLabelDisplay="on"
            onChangeCommitted={(_, value) => setSummands((prevSummands) => {
              const newSummands = [...prevSummands]
              newSummands[index] = value as number
              return newSummands
            })}
          />
        ))
      }

      <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
        <Typography variant="h5">
          Sum
        </Typography>
        {
          requestProcessing &&
            <CircularProgress size={15} sx={{ ml: 1 }} />
        }
      </Box>

      <Slider
        key="sum"
        sx={{ pt: 10 }}
        min={-200}
        max={200}
        value={response?.statusCode == 200 ? response!.data!.sum : 0}
        valueLabelFormat={(val) => response?.statusCode == 200 ? val : 'processing...'}
        valueLabelDisplay="on"
        disabled
      />

    </Paper>
  )
}