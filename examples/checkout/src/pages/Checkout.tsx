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
    cardNumber: string
    expiry: string
    cvc: string
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

  // In a real app, you would convert the payment details into a token
  // and add it to the order for capturing on the server.
  console.log(session.user.id)
  const order = await db.orders.create({
    data: {
      id: order_id,
      electric_user_id: session.user.id,
      status: 'submitted',
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
  basketItems: BasketItem[]
}

const Checkout = ({
  isOpen,
  onDismiss,
  basketItems: basket,
}: CheckoutProps) => {
  const { session } = useContext(SupabaseContext)!
  const { db } = useElectric()!
  const history = useHistory()
  const [progressIsOpen, setProgressIsOpen] = useState(false)
  const nameInput = useRef<HTMLIonInputElement>(null)
  const addressInput = useRef<HTMLIonTextareaElement>(null)
  const postcodeInput = useRef<HTMLIonInputElement>(null)
  const countryInput = useRef<HTMLIonInputElement>(null)
  const cardNameInput = useRef<HTMLIonInputElement>(null)
  const cardInput = useRef<HTMLIonInputElement>(null)
  const expiryInput = useRef<HTMLIonInputElement>(null)
  const cvcInput = useRef<HTMLIonInputElement>(null)
  const [orderId, setOrderId] = useState<string>('')

  const { results: order } = useLiveQuery(
    db.orders.liveUnique({
      where: {
        id: orderId,
      },
    })
  )

  useEffect(() => {
    if (order?.status === 'placed') {
      // Show the order confirmation
      // then close the checkout
      setTimeout(() => {
        setProgressIsOpen(false)
        onDismiss()
        history.push(`/account/order/${order.id}`)
      }, 500)
    }
  }, [order])

  const totalCost = (basket ?? []).reduce((acc, item) => {
    return acc + item.quantity * item.items.price
  }, 0)

  const cardMask = useMaskito({
    options: {
      mask: [
        ...Array(4).fill(/\d/),
        ' ',
        ...Array(4).fill(/\d/),
        ' ',
        ...Array(4).fill(/\d/),
        ' ',
        ...Array(4).fill(/\d/),
        ' ',
        ...Array(3).fill(/\d/),
      ],
    },
  })

  useEffect(() => {
    async function init() {
      if (cardInput.current) {
        const input = await cardInput.current.getInputElement()
        cardMask(input)
      }
    }
    init()
  }, [cardInput])

  const expiryMask = useMaskito({
    options: {
      mask: [...Array(2).fill(/\d/), '/', ...Array(2).fill(/\d/)],
    },
  })

  useEffect(() => {
    async function init() {
      if (expiryInput.current) {
        const input = await expiryInput.current.getInputElement()
        expiryMask(input)
      }
    }
    init()
  }, [expiryInput])

  const cvcMask = useMaskito({
    options: {
      mask: [...Array(4).fill(/\d/)],
    },
  })

  useEffect(() => {
    async function init() {
      if (cvcInput.current) {
        const input = await cvcInput.current.getInputElement()
        cvcMask(input)
      }
    }
    init()
  }, [cvcInput])

  async function handleCheckout() {
    setProgressIsOpen(true)
    const orderId = await newOrder(db, session!, {
      basket,
      shippingAddress: {
        name: (nameInput.current?.value as string) ?? '',
        address: addressInput.current?.value ?? '',
        postcode: (postcodeInput.current?.value as string) ?? '',
        country: (countryInput.current?.value as string) ?? '',
      },
      payment: {
        name: (cardNameInput.current?.value as string) ?? '',
        cardNumber: (cardInput.current?.value as string) ?? '',
        expiry: (expiryInput.current?.value as string) ?? '',
        cvc: (cvcInput.current?.value as string) ?? '',
      },
    })
    setOrderId(orderId)
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
          <IonTitle>Checkout</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent color="light">
        <IonList inset={true}>
          <IonListHeader>
            <IonLabel>Shipping Address</IonLabel>
          </IonListHeader>
          <IonItem>
            <IonInput
              label="Name"
              labelPlacement="floating"
              value="Kevin McCallister"
              ref={nameInput}
            ></IonInput>
          </IonItem>
          <IonItem>
            <IonTextarea
              label="Address"
              labelPlacement="floating"
              rows={5}
              value={`671 Lincoln Ave
Chicago
IL`}
              ref={addressInput}
            ></IonTextarea>
          </IonItem>
          <IonItem>
            <IonInput
              label="Postcode / Zip"
              labelPlacement="floating"
              ref={postcodeInput}
              value="60093"
            ></IonInput>
          </IonItem>
          <IonItem>
            <IonInput
              label="Country"
              labelPlacement="floating"
              ref={countryInput}
              value="United States"
            ></IonInput>
          </IonItem>
        </IonList>

        <IonList inset={true}>
          <IonListHeader>
            <IonLabel>Payment</IonLabel>
          </IonListHeader>
          <IonItem>
            <IonInput
              label="Name on card"
              labelPlacement="floating"
              ref={cardNameInput}
              value="Peter McCallister"
            ></IonInput>
          </IonItem>
          <IonItem>
            <IonInput
              ref={cardInput}
              label="Card number"
              labelPlacement="floating"
              placeholder="0000 0000 0000 0000"
              value="4242 4242 4242 4242"
            ></IonInput>
          </IonItem>
          <IonItem>
            <IonInput
              ref={expiryInput}
              label="Expiry"
              labelPlacement="floating"
              placeholder="00/00"
              value="12/90"
            ></IonInput>
            <IonInput
              ref={cvcInput}
              label="CVC"
              labelPlacement="floating"
              placeholder="000"
              value="123"
            ></IonInput>
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
            Pay {formatPrice(totalCost || order?.delivery_price!)}
          </IonButton>
        </IonToolbar>
      </IonFooter>
      <IonAlert
        isOpen={progressIsOpen}
        backdropDismiss={false}
        header={
          order?.status === 'placed' ? 'Order Placed' : 'Order Processing'
        }
        subHeader={order?.status ? statusDisplay[order.status] : null}
      ></IonAlert>
    </>
  )
}

export default Checkout
