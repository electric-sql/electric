import {
  IonButton,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonList,
  IonItem,
  IonLabel,
  IonListHeader,
  IonButtons,
  IonBadge,
} from '@ionic/react'
import { useContext } from 'react'
import { useParams } from 'react-router-dom'
import { SupabaseContext } from '../SupabaseContext'
import { useLiveQuery } from 'electric-sql/react'
import { useElectric, type OrderWithItems } from '../electric'
import { formatPrice, statusDisplay, statusColor, Status } from '../utils'

const Order: React.FC = () => {
  const { session } = useContext(SupabaseContext)!
  const { db } = useElectric()!
  const { id } = useParams<{ id: string }>()

  const { results } = useLiveQuery(
    db.orders.liveFirst({
      where: {
        electric_user_id: session?.user.id,
        id: id,
      },
      include: {
        basket_items: {
          include: {
            items: true,
          },
        },
      },
    })
  )
  const order = results as OrderWithItems

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton routerDirection="back" routerLink="/account">
              Account
            </IonButton>
          </IonButtons>
          <IonTitle>Order</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonList>
          <IonListHeader>
            <IonLabel>
              Order <code>{order?.id.slice(0, 18)}</code>
            </IonLabel>
          </IonListHeader>
          <IonItem>
            <IonLabel>
              <h1>Status</h1>
            </IonLabel>
            <IonBadge slot="end" color={statusColor[order?.status as Status]}>
              {statusDisplay[order?.status as Status]}
            </IonBadge>
          </IonItem>
          {order?.basket_items.map((item) => (
            <IonItem key={item.id}>
              <img
                slot="start"
                width="80"
                height="80"
                src={`/images/items/${item.items.slug}.jpg`}
              />
              <IonLabel>{item.items.name}</IonLabel>
              <IonLabel slot="end">
                {item.quantity} x{' '}
                {formatPrice(item.quantity * item.items.price)}
              </IonLabel>
            </IonItem>
          ))}
          <IonItem>
            <IonLabel>
              <h1>Shipping</h1>
              <p>{order?.recipient_name || '-'}</p>
              <p>{order?.delivery_address || '-'}</p>
              <p>{order?.delivery_postcode || '-'}</p>
              <p>{order?.delivery_country || '-'}</p>
            </IonLabel>
          </IonItem>
          <IonItem>
            <IonLabel>
              <h1>Total</h1>
            </IonLabel>
            <IonLabel slot="end">
              {formatPrice(order?.delivery_price ?? 0)}
            </IonLabel>
          </IonItem>
        </IonList>
      </IonContent>
    </IonPage>
  )
}

export default Order
