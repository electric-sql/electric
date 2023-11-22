import { Redirect, Route } from 'react-router-dom';
import {
  IonApp,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  setupIonicReact
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { bagOutline, bookOutline, ellipse, personOutline, searchOutline, square, triangle } from 'ionicons/icons';
import Shop from './pages/Shop';
import Bag from './pages/Bag';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/* Theme variables */
import './theme/variables.css';

setupIonicReact();

const App: React.FC = () => (
  <IonApp>
    <IonReactRouter>
      <IonTabs>
        <IonRouterOutlet>
          <Route exact path="/shop">
            <Shop />
          </Route>
          <Route path="/bag">
            <Bag />
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
          <IonTabButton tab="account" href="/account" disabled>
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
  </IonApp>
);

export default App;
