import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ElectricWrapper } from './electric/ElectricWrapper.tsx';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import './index.css'
import { ActivityEventsExample } from './activity_events/ActivityEventsExample.tsx';

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
      <RouterProvider router={router} />
    </ElectricWrapper>
  </React.StrictMode>,
)
