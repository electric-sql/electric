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
            sx={{ pt: 8 }}
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

      <Box sx={{ display: 'flex', flexDirection: 'row' }}>
        <Typography variant="h5">
          Sum
        </Typography>
        {
          requestProcessing &&
            <CircularProgress />
        }
      </Box>

      <Slider
        key="sum"
        sx={{ pt: 7 }}
        min={-100}
        max={100}
        value={response?.statusCode == 200 ? response!.data!.sum : 0}
        valueLabelDisplay="on"
        disabled
      />

    </Paper>
  )
}