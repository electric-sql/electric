import 'animate.css/animate.min.css'
import Board from './pages/Board'
import { useState, createContext } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import 'react-toastify/dist/ReactToastify.css'
import List from './pages/List'
import Root from './pages/root'
import Issue from './pages/Issue'
import { ShapesProvider, getShape } from '../../../react-hooks'
import { issueShape } from './shapes'

interface MenuContextInterface {
  showMenu: boolean
  setShowMenu: (show: boolean) => void
}

export const MenuContext = createContext(null as MenuContextInterface | null)

const router = createBrowserRouter([
  {
    path: `/`,
    element: <Root />,
    loader: async () => {
      const shape = getShape(issueShape)
      await shape.isUpToDate
      return null
    },
    children: [
      {
        path: `/`,
        element: <List />,
      },
      {
        path: `/search`,
        element: <List showSearch={true} />,
      },
      {
        path: `/board`,
        element: <Board />,
      },
      {
        path: `/issue/:id`,
        element: <Issue />,
      },
    ],
  },
])

const App = () => {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <ShapesProvider>
      <MenuContext.Provider value={{ showMenu, setShowMenu }}>
        <RouterProvider router={router} />
      </MenuContext.Provider>
    </ShapesProvider>
  )
}

export default App
