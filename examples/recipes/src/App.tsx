import { Box, Link, useTheme } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { ElectricLogo } from './components/ElectricLogo'

const links = [
  { path: '/activity-events', text: 'Activity Events' },
  { path: '/log-viewer', text: 'Log Viewer' },
  { path: '/monitoring', text: 'Monitoring Metrics' },
  { path: '/request-response', text: 'Request/Response Pattern' },
  { path: '/background-jobs', text: 'Background Jobs' },
  { path: '/chat-room', text: 'Chat Room' },
  { path: '/data-viewer', text: 'Data Viewer' },
]

function App() {
  const theme = useTheme()
  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Link href="https://electric-sql.com" target="_blank" rel="noreferrer">
          <ElectricLogo size={132} fill={theme.palette.primary.main} />
        </Link>
        <h1>ElectricSQL Recipes</h1>
        {links.map((linkData, idx) => (
          <Link key={idx} component={RouterLink} to={linkData.path} underline="hover">
            {linkData.text}
          </Link>
        ))}
      </Box>
    </>
  )
}

export default App
