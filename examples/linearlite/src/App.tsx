import 'animate.css/animate.min.css'
import Board from './pages/Board'
import { useEffect, useState } from 'react'
import { Route, Routes, BrowserRouter } from 'react-router-dom'
import { cssTransition, ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import Home from './pages/Home'

import { ElectricProvider, initElectric } from './electric'
import { Electric } from './generated/client'

const slideUp = cssTransition({
  enter: 'animate__animated animate__slideInUp',
  exit: 'animate__animated animate__slideOutDown',
})

const App = () => {
  const [electric, setElectric] = useState<Electric>()

  useEffect(() => {
    const init = async () => {
      const client = await initElectric()
      setElectric(client)
    }

    init()
  }, [])

  if (electric === undefined) {
    return null
  }

  // TODO: proper initial sycn
  // NOTE: there is a db.isConnected that might be helpful

  const router = (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/board" element={<Board />} />
    </Routes>
  )

  return (
    <ElectricProvider db={electric}>
      <BrowserRouter>
        {router}
        <ToastContainer
          position="bottom-right"
          autoClose={5000}
          hideProgressBar
          newestOnTop
          closeOnClick
          rtl={false}
          transition={slideUp}
          pauseOnFocusLoss
          draggable
          pauseOnHover
        />
      </BrowserRouter>
    </ElectricProvider>
  )
}

export default App
