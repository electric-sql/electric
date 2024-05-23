import 'animate.css/animate.min.css'
import Board from './pages/Board'
import { useEffect, useState, createContext } from 'react'
import { Route, Routes, BrowserRouter } from 'react-router-dom'
import { cssTransition, ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import ElectricIcon from './assets/images/icon.inverse.svg?react'
import { AiOutlineLoading3Quarters } from 'react-icons/ai'
import List from './pages/List'
import Issue from './pages/Issue'
import LeftMenu from './components/LeftMenu'

import { getUserId, setUserId } from './utils/userId'
import { ElectricProvider, initElectric, dbName, DEBUG } from './electric'
import { Electric } from './generated/client'

interface MenuContextInterface {
  showMenu: boolean
  setShowMenu: (show: boolean) => void
}

export const MenuContext = createContext(null as MenuContextInterface | null)

interface ProfileContextInterface {
  userId: string
  setUserId: (userId: string) => void
}

export const ProfileContext = createContext(
  null as ProfileContextInterface | null
)

const slideUp = cssTransition({
  enter: 'animate__animated animate__slideInUp',
  exit: 'animate__animated animate__slideOutDown',
})

function deleteDB() {
  console.log("Deleting DB as schema doesn't match server's")
  const DBDeleteRequest = window.indexedDB.deleteDatabase(dbName)
  DBDeleteRequest.onsuccess = function () {
    console.log('Database deleted successfully')
  }
  // the indexedDB cannot be deleted if the database connection is still open,
  // so we need to reload the page to close any open connections.
  // On reload, the database will be recreated.
  window.location.reload()
}

const App = () => {
  const [electric, setElectric] = useState<Electric>()
  const [showMenu, setShowMenu] = useState(false)
  const userId = getUserId()
  const setUserIdAndReset = (userId: string) => {
    setUserId(userId)
    setElectric(undefined)
    deleteDB()
  }

  useEffect(() => {
    const init = async () => {
      try {
        const client = await initElectric(userId)
        setElectric(client)

        const { synced } = await client.db.profile.sync({
          include: {
            project: true,
          },
        })
        await synced

        const timeToSync = performance.now()
        if (DEBUG) {
          console.log(`Synced in ${timeToSync}ms from page load`)
        }
      } catch (error) {
        if (
          (error as Error).message.startsWith(
            "Local schema doesn't match server's"
          )
        ) {
          deleteDB()
        }
        throw error
      }
    }

    init()
  }, [])

  if (electric === undefined) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center">
        <div className="flex flex-col items-center">
          <ElectricIcon className="w-20 mb-4 scale-150 fill-gray-500" />
          <div className="flex flex-row items-center text-lg text-gray-500">
            <AiOutlineLoading3Quarters className="animate-spin" />
            <span className="ml-2">Loading...</span>
          </div>
        </div>
      </div>
    )
  }

  const router = (
    <Routes>
      <Route path="/" element={<List />} />
      <Route path="/:id" element={<List />} />
      <Route path="/search" element={<List showSearch={true} />} />
      <Route path="/board" element={<Board />} />
      <Route path="/board/:id" element={<Board />} />
      <Route path="/issue/:id" element={<Issue />} />
    </Routes>
  )

  return (
    <ElectricProvider db={electric}>
      <ProfileContext.Provider value={{ userId, setUserId: setUserIdAndReset }}>
        <MenuContext.Provider value={{ showMenu, setShowMenu }}>
          <BrowserRouter>
            <div className="flex w-full h-screen overflow-y-hidden">
              <LeftMenu />
              {router}
            </div>
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
        </MenuContext.Provider>
      </ProfileContext.Provider>
    </ElectricProvider>
  )
}

export default App
