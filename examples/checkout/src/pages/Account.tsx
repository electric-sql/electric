import { IonButton, IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import { useContext } from 'react';
import { SupabaseContext } from "../SupabaseContext";

const Bag: React.FC = () => {
  const supabase = useContext(SupabaseContext)!;

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Account</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">Account</IonTitle>
          </IonToolbar>
        </IonHeader>
        <div className="ion-padding">
          <IonButton expand="block" onClick={signOut}>Sign Out</IonButton>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Bag;
