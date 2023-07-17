
import 'animate.css/animate.min.css';
import Board from './pages/Board';
import React, { useEffect, useState } from 'react'
import { Route, Switch,  BrowserRouter} from 'react-router-dom';
import { cssTransition, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Home from './pages/Home';

import { ElectricProvider, initElectric } from './electric'
import { Electric} from './generated/client'

const slideUp = cssTransition({
  enter: 'animate__animated animate__slideInUp',
  exit: 'animate__animated animate__slideOutDown',
});

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

  var router = (
    <Switch>
      <Route path="/" exact component={Home} />
      <Route path="/board" exact component={Board} />
    </Switch>
  )

  // return (
  //   <ElectricProvider db={electric}>
  //     {router}
  //     <ToastContainer
  //       position="bottom-right"
  //       autoClose={5000}
  //       hideProgressBar
  //       newestOnTop
  //       closeOnClick
  //       rtl={false}
  //       transition={slideUp}
  //       pauseOnFocusLoss
  //       draggable
  //       pauseOnHover
  //     />
  //   </ElectricProvider>
  // );

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

  // return (
  //     <ElectricProvider db={electric}>
  //         <BrowserRouter>
  //             <>
  //                 {router}
  //                 <ToastContainer
  //                     position="bottom-right"
  //                     autoClose={5000}
  //                     hideProgressBar
  //                     newestOnTop
  //                     closeOnClick
  //                     rtl={false}
  //                     transition={slideUp}
  //                     pauseOnFocusLoss
  //                     draggable
  //                     pauseOnHover
  //                 />
  //             </>
  //         </BrowserRouter>
  //     </ElectricProvider>
  // );
}

export default App

