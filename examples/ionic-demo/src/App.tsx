import { useState, useEffect } from 'react'
import { Redirect, Route } from 'react-router-dom'
import { IonApp, IonRouterOutlet, setupIonicReact } from '@ionic/react'
import { IonReactRouter } from '@ionic/react-router'

import { ElectricProvider, initElectric, dbName, DEBUG } from './electric'
import { Electric } from './generated/client'

import Home from './pages/Home'
import New from './pages/New'
import NewForm from './pages/NewForm'
import Calendar from './pages/Calendar'
import Thanks from './pages/Thanks'

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css'

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css'
import '@ionic/react/css/structure.css'
import '@ionic/react/css/typography.css'

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css'
import '@ionic/react/css/float-elements.css'
import '@ionic/react/css/text-alignment.css'
import '@ionic/react/css/text-transformation.css'
import '@ionic/react/css/flex-utils.css'
import '@ionic/react/css/display.css'

/* Theme variables */
import './theme/variables.css'
setupIonicReact()

const App: React.FC = () => {
  const [electric, setElectric] = useState<Electric>()

  useEffect(() => {
    const init = async () => {
      try {
        const client = await initElectric()
        setElectric(client)
        const { synced } = await client.db.appointments.sync({})
        await synced
        const timeToSync = performance.now()
        if (DEBUG) {
          console.log(`Synced in ${timeToSync}ms from page load`)
        }
      } catch (error) {
        if (
          (error as Error).message.startsWith(
            "Local schema doesn't match server's",
          )
        ) {
          deleteDB()
        }
        throw error
      }
    }

    init()
  }, [])

  const main = electric && (
    <ElectricProvider db={electric}>
      <IonReactRouter>
        <IonRouterOutlet>
          <Route exact path="/">
            <Home />
          </Route>
          <Route exact path="/new">
            <New />
          </Route>
          <Route exact path="/new/:year/:month/:day/:hour/:minute">
            <NewForm />
          </Route>
          <Route exact path="/calendar">
            <Calendar />
          </Route>
          <Route exact path="/thanks">
            <Thanks />
          </Route>
        </IonRouterOutlet>
      </IonReactRouter>
    </ElectricProvider>
  )

  return <IonApp>{main}</IonApp>
}

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

export default App
