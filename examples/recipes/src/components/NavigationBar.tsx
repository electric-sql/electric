import { AppBar, Box, IconButton, Link, Toolbar, Typography } from '@mui/material'
import { ReactElement } from 'react'
import { ElectricLogo } from './ElectricLogo'


export const NavigationBar = ({ title, items = [] } : { title: string, items?: ReactElement[] }) => (
    <Box sx={{ flexGrow: 1, mb: 2 }}>
      <AppBar position="static" color="primary">
        <Toolbar>
          <IconButton
            size="large"
            edge="start"
            color="inherit"
            aria-label="menu"
            sx={{ mr: 2 }}
          >
            <Link href="https://electric-sql.com" target="_blank" rel="noreferrer"
              underline="none" sx={{ fontSize: 0 }}>
              <ElectricLogo />
            </Link>
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            {title}
          </Typography>
          {
            items && items.length > 0 &&
              <div>
                {...items}
              </div>
          }
        </Toolbar>
      </AppBar>
    </Box>
)