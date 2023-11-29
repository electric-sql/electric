import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonList,
  IonItem,
  IonLabel,
  IonInput,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonFooter,
  IonButton,
  IonModal,
} from '@ionic/react'
import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'electric-sql/react'
import { BasketItem, useElectric, type Electric } from '../electric'

import EmptyCart from '../components/EmptyCart'
import { formatPrice } from '../utils'
import Checkout from './Checkout'
import './Cart.css'

async function deduplicateBasketItems(
  db: Electric['db'],
  basket: BasketItem[]
) {
  const firstItem = new Map<string, BasketItem>()
  for (const item of basket) {
    const existingItem = firstItem.get(item.item_id)
    if (existingItem) {
      // TODO: This should be a transaction
      await db.basket_items.delete({
        where: {
          id: item.id,
        },
      })
      await db.basket_items.update({
        where: {
          id: existingItem.id,
        },
        data: {
          quantity: existingItem.quantity + item.quantity,
        },
      })
    } else {
      firstItem.set(item.item_id, item)
    }
  }
}

const Cart: React.FC = () => {
  const { db } = useElectric()!
  const [checkoutIsOpen, setCheckoutIsOpen] = useState(false)
  const frozenBasket = useRef<BasketItem[]>([])

  const { results: basket } = useLiveQuery(
    db.basket_items.liveMany({
      orderBy: {
        created_at: 'desc',
      },
      where: {
        // Only show items that are not in an order
        order_id: null,
      },
      include: {
        items: true,
      },
    })
  )

  const totalCost = (basket ?? []).reduce((acc, item) => {
    return acc + item.quantity * item.items.price
  }, 0)

  deduplicateBasketItems(db, basket ?? [])

  useEffect(() => {
    return () => {
      setCheckoutIsOpen(false)
    }
  }, [])

  async function deleteItem(id: string) {
    await db.basket_items.delete({
      where: {
        id,
      },
    })
  }

  async function updateQuantity(id: string, quantity: number) {
    if (quantity === 0) {
      return await deleteItem(id)
    } else {
      await db.basket_items.update({
        where: {
          id,
        },
        data: {
          quantity,
        },
      })
    }
  }

  function handleCheckout() {
    // Freeze the basket so that it doesn't change while the user is checking out
    frozenBasket.current = [...basket ?? []]
    setCheckoutIsOpen(true)
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Cart</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">Cart</IonTitle>
          </IonToolbar>
        </IonHeader>
        {!basket?.length ? (
          <EmptyCart />
        ) : (
          <IonList>
            {basket.map((basket_item) => (
              <IonItemSliding key={basket_item.id}>
                <IonItem>
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
                  <IonInput
                    slot="end"
                    type="number"
                    placeholder="1"
                    aria-label="quantity"
                    style={{ width: '3em', textAlign: 'right' }}
                    value={basket_item.quantity}
                    onIonChange={(e) =>
                      updateQuantity(basket_item.id, parseInt(e.detail.value!))
                    }
                  ></IonInput>
                </IonItem>

                <IonItemOptions>
                  <IonItemOption
                    color="danger"
                    onClick={() => deleteItem(basket_item.id)}
                  >
                    Remove
                  </IonItemOption>
                </IonItemOptions>
              </IonItemSliding>
            ))}
            <IonItem>
              <IonLabel>Total</IonLabel>
              <IonLabel slot="end">{formatPrice(totalCost)}</IonLabel>
            </IonItem>
          </IonList>
        )}
      </IonContent>
      {basket?.length > 0 && (
        <IonFooter>
          <IonButton
            expand="full"
            size="large"
            className="checkout"
            style={{ margin: '10px' }}
            onClick={handleCheckout}
          >
            Checkout
          </IonButton>
        </IonFooter>
      )}
      <IonModal isOpen={checkoutIsOpen}>
        <Checkout
          isOpen={checkoutIsOpen}
          basketItems={frozenBasket.current}
          onDismiss={() => setCheckoutIsOpen(false)}
          onCompleted={() => setCheckoutIsOpen(false)}
        />
      </IonModal>
    </IonPage>
  )
}

export default Cart
