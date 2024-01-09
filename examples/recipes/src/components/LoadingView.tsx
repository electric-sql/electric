import CircularProgress from '@mui/material/CircularProgress';
import React from 'react';
import { Box, Fade, Typography } from '@mui/material';

export const LoadingView = ({
  children,
  loading
} : {
  children: React.ReactElement,
  loading: boolean 
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%'
      }}
    >
      { loading &&
        <Box sx={{
            position: 'absolute',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}>
          <CircularProgress  />
          <Typography variant="h4" sx={{ my: 2 }}>
            Loading...
          </Typography>
        </Box>
      }
      <Fade in={!loading}>
        {children}
      </Fade>
    </Box>
  );
};