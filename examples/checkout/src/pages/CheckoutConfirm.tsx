import {
  IonButton,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonFooter,
  IonButtons,
  IonList,
  IonItem,
  IonInput,
  IonLabel,
  IonTextarea,
  IonListHeader,
  IonAlert,
} from '@ionic/react'
import { useContext, useState, useRef, useEffect } from 'react'
import { useHistory } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import type { Session } from '@supabase/supabase-js'
import { useMaskito } from '@maskito/react'
import { SupabaseContext } from '../SupabaseContext'
import { formatPrice, statusDisplay } from '../utils'
import { BasketItem, useElectric, type Electric } from '../electric'
import { useLiveQuery } from 'electric-sql/react'

interface NewOrderOptions {
  basket: BasketItem[]
  shippingAddress: {
    name: string
    address: string
    postcode: string
    country: string
  }
  payment: {
    name: string
    cardToken: string
    last4: string
  }
}

async function newOrder(
  db: Electric['db'],
  session: Session,
  options: NewOrderOptions
): Promise<string> {
  const order_id = uuidv4()

  const totalCost = options.basket.reduce((acc, item) => {
    return acc + item.quantity * item.items.price
  }, 0)

  const order = await db.orders.create({
    data: {
      id: order_id,
      electric_user_id: session.user.id,
      status: 'awaitingSubmission',
      recipient_name: options.shippingAddress.name || '-',
      delivery_address: options.shippingAddress.address || '-',
      delivery_postcode: options.shippingAddress.postcode || '-',
      delivery_country: options.shippingAddress.country || '-',
      delivery_price: totalCost,
      created_at: new Date(),
    },
  })

  // Add the items to the order
  await db.basket_items.updateMany({
    data: {
      order_id,
    },
    where: {
      id: {
        in: options.basket.map((item) => item.id),
      },
    },
  })

  return order_id
}

interface CheckoutProps {
  isOpen: boolean
  onDismiss: () => void
  onCompleted: () => void
  orderOptions: NewOrderOptions
}

const CheckoutConfirm = ({
  isOpen,
  onDismiss,
  onCompleted,
  orderOptions,
}: CheckoutProps) => {
  const { session } = useContext(SupabaseContext)!
  const { db } = useElectric()!
  const history = useHistory()

  const totalCost = (orderOptions.basket ?? []).reduce((acc, item) => {
    return acc + item.quantity * item.items.price
  }, 0)

  async function handleCheckout() {
    const orderId = await newOrder(db, session!, orderOptions)
    onCompleted()
    history.push(`/account/order/${orderId}`)
  }

  return (
    <>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton color="medium" onClick={() => onDismiss()}>
              Cancel
            </IonButton>
          </IonButtons>
          <IonTitle>Confirm Order</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent color="light">

        <IonList inset={true}>
          <IonListHeader>
            <IonLabel>Items</IonLabel>
          </IonListHeader>
          {orderOptions.basket.map((basket_item) => (
            <IonItem key={basket_item.id}>
              <img
                slot="start"
                width="80"
                height="80"
                src={`/images/items/${basket_item.items.slug}.jpg`}
              />
              <IonLabel>
                {/* TODO: something is wrong with the types here?? */}
                <h3>{basket_item.items.name}</h3>
                <p>{formatPrice(basket_item.items.price)}</p>
              </IonLabel>
            </IonItem>
          ))}
          <IonItem>
            <IonLabel>Total</IonLabel>
            <IonLabel slot="end">{formatPrice(totalCost)}</IonLabel>
          </IonItem>
        </IonList>

        <IonList inset={true}>
          <IonListHeader>
            <IonLabel>Shipping Address</IonLabel>
          </IonListHeader>
          <IonItem>
            <IonLabel>
              <h5>Name</h5>
              <p>{orderOptions.shippingAddress.name}</p>
            </IonLabel>
          </IonItem>
          <IonItem>
            <IonLabel>
              <h5>Address</h5>
              <p>{orderOptions.shippingAddress.address}</p>
            </IonLabel>
          </IonItem>
          <IonItem>
            <IonLabel>
              <h5>Postcode</h5>
              <p>{orderOptions.shippingAddress.postcode}</p>
            </IonLabel>
          </IonItem>
          <IonItem>
            <IonLabel>
              <h5>Country</h5>
              <p>{orderOptions.shippingAddress.country}</p>
            </IonLabel>
          </IonItem>
        </IonList>

        <IonList inset={true}>
          <IonListHeader>
            <IonLabel>Payment</IonLabel>
          </IonListHeader>
          <IonItem>
            <IonLabel>
              <h5>Name</h5>
              <p>{orderOptions.payment.name}</p>
            </IonLabel>
          </IonItem>
          <IonItem>
            <IonLabel>
              <h5>Card</h5>
              <p>xxxx xxxx xxxx {orderOptions.payment.last4}</p>
            </IonLabel>
          </IonItem>
        </IonList>
      </IonContent>
      <IonFooter>
        <IonToolbar style={{ padding: 0 }}>
          <IonButton
            expand="full"
            size="large"
            className="checkout"
            style={{ margin: '10px' }}
            onClick={handleCheckout}
          >
            Pay {formatPrice(totalCost)}
          </IonButton>
        </IonToolbar>
      </IonFooter>
    </>
  )
}

export default CheckoutConfirm
