import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
} from "@ionic/react";

import "./Shop.css";
import Logo from "../assets/logo.svg";

const Shop: React.FC = () => {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            <img src={Logo} alt="ElectricSQL" className="logo" />
            Electric Shop
          </IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">
              <img src={Logo} alt="ElectricSQL" className="logo" />
              Electric Shop
            </IonTitle>
          </IonToolbar>
        </IonHeader>
        stuff
      </IonContent>
    </IonPage>
  );
};

export default Shop;
