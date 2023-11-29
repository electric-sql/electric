import { useState, useEffect } from 'react'
import { IonApp, setupIonicReact, IonAlert } from '@ionic/react'
import { createClient, Session } from '@supabase/supabase-js'

import SignIn from './pages/SignIn'
import MainRoutes from './MainRoutes'
import { SupabaseContext } from './SupabaseContext'

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

// Supabase
const supabaseUrl = import.meta.env.ELECTRIC_SUPABASE_URL
const anonKey = import.meta.env.ELECTRIC_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, anonKey)

const App: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log(session)
      setSession(session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession) {
        // if (!session) {
        //   setLoading(true)
        // }
        setTimeout(() => {
          // There is an issue with clock drift and the JWT being invalid
          // this is a hackey workaround for now
          setSession(newSession)
        }, 900)
      } else {
        setSession(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <SupabaseContext.Provider
      value={{
        supabase,
        session,
      }}
    >
      <IonApp>
        {session ? (
          <MainRoutes onElectricLoaded={() => setLoading(false)} />
        ) : (
          <SignIn />
        )}
        <IonAlert
          isOpen={loading}
          message="Loading Store..."
          backdropDismiss={false}
        />
      </IonApp>
    </SupabaseContext.Provider>
  )
}

export default App
