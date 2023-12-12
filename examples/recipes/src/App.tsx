import { Box, Link } from '@mui/material'
import logo from './assets/electric_logo.svg'
import { Link as RouterLink } from 'react-router-dom';

function App() {
  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
        <Link href="https://electric-sql.com" target="_blank" rel="noreferrer">
          <img src={logo} />
        </Link>
        <h1>Electric SQL Recipes</h1>
        <Link component={RouterLink} to="/activity-events" underline="hover">
          Actvity Events
        </Link>
      </Box>
    </>
  )
}

export default App
