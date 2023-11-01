import {
  IonButton,
  IonButtons,
  IonBackButton,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonList,
  IonItem,
  IonInput,
  IonTextarea,
  IonFooter,
} from '@ionic/react'
import { useParams, useHistory } from 'react-router-dom'
import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useElectric } from '../electric'

const NewForm: React.FC = () => {
  const { db } = useElectric()!
  const { year, month, day, hour, minute } = useParams<{
    year: string
    month: string
    day: string
    hour: string
    minute: string
  }>()
  const start = new Date(
    parseInt(year),
    parseInt(month),
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
  )
  const end = new Date(start.getTime() + 15 * 60 * 1000)

  const history = useHistory()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [comments, setComments] = useState('')

  const handleSubmit = async () => {
    db.appointments.create({
      data: {
        id: uuidv4(),
        start: start,
        end: end,
        name,
        email,
        phone,
        address,
        comments,
        cancelled: false,
      },
    })
    history.replace('/thanks')
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/"></IonBackButton>
          </IonButtons>
          <IonTitle>Enter Your Details</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent color="light">
        <IonList inset={true}>
          <IonItem>
            <IonInput
              label="Appointment Time"
              label-placement="floating"
              value={`${start.toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}, ${start.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })} to ${end.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}`}
              readonly={true}
            ></IonInput>
          </IonItem>
        </IonList>

        <IonList inset={true}>
          <IonItem>
            <IonInput
              label="Name"
              label-placement="floating"
              onIonInput={(e) => setName(e.detail.value!)}
              value={name}
            ></IonInput>
          </IonItem>
          <IonItem>
            <IonInput
              label="Email"
              label-placement="floating"
              type="email"
              onIonInput={(e) => setEmail(e.detail.value!)}
              value={email}
            ></IonInput>
          </IonItem>
          <IonItem>
            <IonInput
              label="Phone"
              label-placement="floating"
              type="tel"
              onIonInput={(e) => setPhone(e.detail.value!)}
              value={phone}
            ></IonInput>
          </IonItem>
          <IonItem>
            <IonTextarea
              label="Address"
              label-placement="floating"
              rows={3}
              onIonInput={(e) => setAddress(e.detail.value!)}
              value={address}
            ></IonTextarea>
          </IonItem>
        </IonList>

        <IonList inset={true}>
          <IonItem>
            <IonTextarea
              label="Comments"
              label-placement="floating"
              rows={5}
              onIonInput={(e) => setComments(e.detail.value!)}
              value={comments}
            ></IonTextarea>
          </IonItem>
        </IonList>
      </IonContent>
      <IonFooter>
        <IonToolbar>
          <IonButton expand="block" onClick={handleSubmit}>
            Make Appointment
          </IonButton>
        </IonToolbar>
      </IonFooter>
    </IonPage>
  )
}

export default NewForm
