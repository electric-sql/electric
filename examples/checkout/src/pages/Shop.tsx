import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonCol,
  IonGrid,
  IonRow,
} from '@ionic/react'
import { Item, useElectric } from '../electric'
import { useLiveQuery } from 'electric-sql/react'

import './Shop.css'
import Logo from '../assets/logo.svg'
import ItemCard from '../components/ItemCard'

const Shop: React.FC = () => {
  const { db } = useElectric()!
  const { results } = useLiveQuery(db.items.liveMany())
  const items: Item[] = results ?? []

  console.log(items)

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            <img src={Logo} alt="ElectricSQL" className="logo" />
            Electric Store
          </IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">
              <img src={Logo} alt="ElectricSQL" className="logo" />
              Electric Store
            </IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonGrid>
          <IonRow>
            {items.map((item) => (
              <IonCol key={item.id} size="6" size-md="4" size-lg="3">
                <ItemCard item={item} />
              </IonCol>
            ))}
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonPage>
  )
}

export default Shop
