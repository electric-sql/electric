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
  IonBadge,
} from '@ionic/react'
import { useContext } from 'react'
import { SupabaseContext } from '../SupabaseContext'
import { useLiveQuery } from 'electric-sql/react'
import { useElectric, type OrderWithItems } from '../electric'
import { formatPrice, statusDisplay, statusColor, type Status } from '../utils'

const Account: React.FC = () => {
  const { supabase, session } = useContext(SupabaseContext)!
  const { db } = useElectric()!

  const { results } = useLiveQuery(
    db.orders.liveMany({
      where: {
        electric_user_id: session?.user.id,
      },
      include: {
        basket_items: true,
      },
    })
  )
  const orders = results as OrderWithItems[]

  const signOut = async () => {
    await supabase.auth.signOut()
    // TODO: DELETE ALL LOCAL DATA!
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Account</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonList>
          <IonListHeader>
            <IonLabel>Your Orders</IonLabel>
          </IonListHeader>
          {orders?.map((order) => (
            <IonItem
              key={order.id}
              routerLink={`/account/order/${order.id}`}
              routerDirection="forward"
            >
              <IonLabel>
                <h1 title={order.id}>{order.id.slice(0, 18)}</h1>
                <p>
                  {order.created_at.toLocaleDateString()} -{' '}
                  {order.basket_items.length} item
                  {order.basket_items.length === 1 ? '' : 's'} -{' '}
                  {formatPrice(order.delivery_price)}
                </p>
              </IonLabel>
              <IonBadge slot="end" color={statusColor[order.status as Status]}>
                {statusDisplay[order.status as Status] ?? order.status}
              </IonBadge>
            </IonItem>
          ))}
        </IonList>
        <div className="ion-padding">
          <IonButton expand="block" onClick={signOut}>
            Sign Out
          </IonButton>
        </div>
      </IonContent>
    </IonPage>
  )
}

export default Account
