import { useState, useContext } from 'react'
import {
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonButton,
  IonToast,
} from '@ionic/react'
import { v4 as uuidv4 } from 'uuid'
import { formatPrice } from '../utils'
import { Item, useElectric } from '../electric'
import { SupabaseContext } from '../SupabaseContext'

interface ItemProps {
  item: Item
}

function ItemCard({ item }: ItemProps) {
  const { db } = useElectric()!
  const { session } = useContext(SupabaseContext)!
  const [toastIsOpen, setIsOpen] = useState(false)

  async function addToCart() {
    await db.basket_items.create({
      data: {
        id: uuidv4(),
        item_id: item.id,
        quantity: 1,
        electric_user_id: session!.user.id,
        created_at: new Date(),
      },
    })
    setIsOpen(true)
  }

  return (
    <IonCard className="item">
      <img alt={item.name} src={`/images/items/${item.slug}.jpg`} />
      <IonButton expand="full" size="small" onClick={addToCart}>
        Add to cart
      </IonButton>
      <IonCardHeader>
        <IonCardTitle>{item.name}</IonCardTitle>
        <IonCardSubtitle>{formatPrice(item.price)}</IonCardSubtitle>
      </IonCardHeader>
      <IonCardContent>{item.description}</IonCardContent>

      <IonToast
        color={'primary'}
        isOpen={toastIsOpen}
        message={`Added ${item.name} to cart`}
        onDidDismiss={() => setIsOpen(false)}
        duration={1000}
        position="top"
      ></IonToast>
    </IonCard>
  )
}
export default ItemCard
