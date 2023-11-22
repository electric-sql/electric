import { useState, useEffect } from "react";
import { Redirect, Route } from "react-router-dom";
import {
  IonApp,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  setupIonicReact,
} from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import {
  bagOutline,
  bookOutline,
  personOutline,
  searchOutline,
} from "ionicons/icons";
import { createClient, Session } from "@supabase/supabase-js";

import Shop from "./pages/Shop";
import Bag from "./pages/Bag";
import Account from "./pages/Account";
import SignIn from "./pages/SignIn";
import { SupabaseContext } from "./SupabaseContext";

/* Core CSS required for Ionic components to work properly */
import "@ionic/react/css/core.css";

/* Basic CSS for apps built with Ionic */
import "@ionic/react/css/normalize.css";
import "@ionic/react/css/structure.css";
import "@ionic/react/css/typography.css";

/* Optional CSS utils that can be commented out */
import "@ionic/react/css/padding.css";
import "@ionic/react/css/float-elements.css";
import "@ionic/react/css/text-alignment.css";
import "@ionic/react/css/text-transformation.css";
import "@ionic/react/css/flex-utils.css";
import "@ionic/react/css/display.css";

/* Theme variables */
import "./theme/variables.css";

setupIonicReact();

// Supabase
const supabaseUrl = import.meta.env.ELECTRIC_SUPABASE_URL;
const anonKey = import.meta.env.ELECTRIC_SUPABASE_ANON_KEY;
console.log(supabaseUrl, anonKey)
const supabase = createClient(supabaseUrl, anonKey);

const App: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <SupabaseContext.Provider value={supabase}>
      <IonApp>
        {session ? (
          <IonReactRouter>
            <IonTabs>
              <IonRouterOutlet>
                <Route exact path="/shop">
                  <Shop />
                </Route>
                <Route path="/bag">
                  <Bag />
                </Route>
                <Route path="/account">
                  <Account />
                </Route>
                <Route exact path="/">
                  <Redirect to="/shop" />
                </Route>
              </IonRouterOutlet>
              <IonTabBar slot="bottom">
                <IonTabButton tab="shop" href="/shop">
                  <IonIcon aria-hidden="true" icon={bookOutline} />
                  <IonLabel>Shop</IonLabel>
                </IonTabButton>
                <IonTabButton tab="search" href="/search" disabled>
                  <IonIcon aria-hidden="true" icon={searchOutline} />
                  <IonLabel>Search</IonLabel>
                </IonTabButton>
                <IonTabButton tab="account" href="/account">
                  <IonIcon aria-hidden="true" icon={personOutline} />
                  <IonLabel>Account</IonLabel>
                </IonTabButton>
                <IonTabButton tab="bag" href="/bag">
                  <IonIcon aria-hidden="true" icon={bagOutline} />
                  <IonLabel>Bag</IonLabel>
                </IonTabButton>
              </IonTabBar>
            </IonTabs>
          </IonReactRouter>
        ) : (
          <SignIn />
        )}
      </IonApp>
    </SupabaseContext.Provider>
  );
};

export default App;
