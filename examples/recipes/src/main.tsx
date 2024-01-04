import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ElectricWrapper } from './electric/ElectricWrapper.tsx';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import './index.css'
import theme from './theme.ts';

import { ActivityEventsExample } from './activity_events/ActivityEventsExample.tsx';
import { LogViewerExample } from './log_viewer/LogViewerExample.tsx';
import { MonitoringMetricsExample } from './monitoring_metrics/MonitoringMetricsExample.tsx';
import { RequestResponseExample } from './request_response/RequestResponseExample.tsx';
import { BackgroundJobsExample } from './background_jobs/BackgroundJobsExample.tsx';
import { ChatRoomExample } from './chat_room/ChatRoomExample.tsx';


const router = createBrowserRouter([
  {
    path: "/",
    element: <App />
  },
  {
    path: "/activity-events",
    element: <ActivityEventsExample />
  },
  {
    path: "/log-viewer",
    element: <LogViewerExample />
  },
  {
    path: "/monitoring",
    element: <MonitoringMetricsExample />
  },
  {
    path: "/request-response",
    element: <RequestResponseExample />
  },
  {
    path: "/background-jobs",
    element: <BackgroundJobsExample />
  },
  {
    path: "/chat-room",
    element: <ChatRoomExample />
  },
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
