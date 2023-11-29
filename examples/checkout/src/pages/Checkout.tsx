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
  IonModal,
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
import CheckoutConfirm from './CheckoutConfirm'

interface CheckoutProps {
  isOpen: boolean
  onDismiss: () => void
  onCompleted: () => void
  basketItems: BasketItem[]
}

const Checkout = ({
  isOpen,
  onDismiss,
  onCompleted,
  basketItems: basket,
}: CheckoutProps) => {
  const { session } = useContext(SupabaseContext)!
  const { db } = useElectric()!
  const history = useHistory()
  const nameInput = useRef<HTMLIonInputElement>(null)
  const addressInput = useRef<HTMLIonTextareaElement>(null)
  const postcodeInput = useRef<HTMLIonInputElement>(null)
  const countryInput = useRef<HTMLIonInputElement>(null)
  const cardNameInput = useRef<HTMLIonInputElement>(null)
  const cardInput = useRef<HTMLIonInputElement>(null)
  const expiryInput = useRef<HTMLIonInputElement>(null)
  const cvcInput = useRef<HTMLIonInputElement>(null)
  const [confirmIsOpen, setConfirmIsOpen] = useState(false)

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

  async function handleConfirm() {
    setConfirmIsOpen(true)
  }

  useEffect(() => {
    return () => {
      setConfirmIsOpen(false)
    }
  }, [])

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
            onClick={handleConfirm}
          >
            Continue
          </IonButton>
        </IonToolbar>
      </IonFooter>
      <IonModal isOpen={confirmIsOpen}>
        <CheckoutConfirm
          isOpen={confirmIsOpen}
          onDismiss={() => {
            setConfirmIsOpen(false)
          }}
          onCompleted={onCompleted}
          orderOptions={{
            shippingAddress: {
              name: nameInput.current?.value?.toString() ?? '',
              address: addressInput.current?.value?.toString() ?? '',
              postcode: postcodeInput.current?.value?.toString() ?? '',
              country: countryInput.current?.value?.toString() ?? '',
            },
            payment: {
              name: cardNameInput.current?.value?.toString() ?? '',
              last4: cardInput.current?.value?.toString().slice(-4) ?? '',
              cardToken: 'A-GENERATED-CARD-TOKEN',
            },
            basket,
          }}
        />
      </IonModal>
    </>
  )
}

export default Checkout
