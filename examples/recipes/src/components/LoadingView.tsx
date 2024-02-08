import CircularProgress from '@mui/material/CircularProgress'
import React from 'react'
import { Box, Fade, Typography } from '@mui/material'

export const LoadingView = ({
  children,
  loading,
}: {
  children: React.ReactElement
  loading: boolean
}) => {
  return (
    <Box height="100%">
      {loading && (
        <Box
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <CircularProgress />
          <Typography variant="h4" sx={{ my: 2 }}>
            Loading...
          </Typography>
        </Box>
      )}

      <Fade in={!loading}>{children}</Fade>
    </Box>
  )
}
