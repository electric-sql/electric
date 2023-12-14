import { Box, Link, useTheme } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom';
import { ElectricLogo } from './components/ElectricLogo';

function App() {
  const theme = useTheme();
  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
        <Link href="https://electric-sql.com" target="_blank" rel="noreferrer">
          <ElectricLogo size={132} fill={theme.palette.primary.main}/>
        </Link>
        <h1>Electric SQL Recipes</h1>
        <Link component={RouterLink} to="/activity-events" underline="hover">
          Actvity Events
        </Link>
        <Link component={RouterLink} to="/log-viewer" underline="hover">
          Log Viewer
        </Link>
      </Box>
    </>
  )
}

export default App
