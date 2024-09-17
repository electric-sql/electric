import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./style.css"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js"

// Register the necessary chart components
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

ReactDOM.createRoot(document.getElementById(`root`)!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
