import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import EmptyBag from '../components/EmptyBag';
import './Bag.css';

const Bag: React.FC = () => {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Bag</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">Bag</IonTitle>
          </IonToolbar>
        </IonHeader>
        <EmptyBag />
      </IonContent>
    </IonPage>
  );
};

export default Bag;
