import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ElectricWrapper } from './electric/ElectricWrapper.tsx';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { ActivityEventsExample } from './activity_events/ActivityEventsExample.tsx';

import './index.css'
import theme from './theme.ts';
import { CssBaseline } from '@mui/material';


const router = createBrowserRouter([
  {
    path: "/",
    element: <App />
  },
  {
    path: "/activity-events",
    element: <ActivityEventsExample />
  }
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ElectricWrapper>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <RouterProvider router={router} />
      </ThemeProvider>
    </ElectricWrapper>
  </React.StrictMode>,
)
