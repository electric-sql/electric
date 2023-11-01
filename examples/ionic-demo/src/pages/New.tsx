import {
  IonButton,
  IonButtons,
  IonBackButton,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonDatetime,
  IonCol,
  IonGrid,
  IonRow,
  IonLabel,
} from '@ionic/react'
import { useState, useMemo } from 'react'
import { useLiveQuery } from 'electric-sql/react'
import { useElectric, Appointment as AppointmentBase } from '../electric'

import './New.css'

const New: React.FC = () => {
  const { db } = useElectric()!
  const [date, setDate] = useState<Date>(new Date())

  const { results } = useLiveQuery(
    db.appointments.liveMany({
      where: {
        start: {
          // gte beginning of this month
          gte: new Date(date.getFullYear(), date.getMonth(), 1),
          // lt beginning of next month
          lt: new Date(date.getFullYear(), date.getMonth() + 1, 1),
        },
      },
      orderBy: {
        start: 'asc',
      },
    }),
  )

  const timeOptions = useMemo(() => {
    const timeOptions = []
    for (let h = 8; h < 18; h++) {
      const row = []
      for (let m = 0; m < 60; m += 15) {
        const time = `${h}:${m < 10 ? '0' : ''}${m}`
        const optionStart = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          h,
          m,
        )
        const optionEnd = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          h,
          m + 15,
        )
        let disabled = false
        if (optionStart < new Date()) {
          // Can't book in the past or within the current 15 minute window
          disabled = true
        }
        // Check for clashes
        if (results && !disabled) {
          disabled = results.some((appointment) => {
            const appointmentStart = new Date(appointment.start)
            const appointmentEnd = new Date(appointment.end)
            return (
              optionStart.getTime() < appointmentEnd.getTime() &&
              optionEnd.getTime() > appointmentStart.getTime()
            )
          })
        }
        row.push(
          <IonCol key={time}>
            <IonButton
              expand="block"
              fill="clear"
              color="dark"
              disabled={disabled}
              routerLink={`/new/${date.getFullYear()}/${date.getMonth()}/${date.getDate()}/${h}/${m}`}
            >
              {time}
            </IonButton>
          </IonCol>,
        )
      }
      timeOptions.push(<IonRow key={h}>{row}</IonRow>)
    }
    return timeOptions
  }, [date, results])

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/"></IonBackButton>
          </IonButtons>
          <IonTitle>New Appointment</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen color="light">
        <IonDatetime
          className="ion-margin-bottom"
          presentation="date"
          size="cover"
          min={new Date().toISOString()}
          value={date.toISOString()}
          onIonChange={(e) => setDate(new Date(e.detail.value as string))}
        ></IonDatetime>
        <IonLabel color="medium" className="ion-padding">
          Select a Time
        </IonLabel>
        <IonGrid className="time-grid">{timeOptions}</IonGrid>
      </IonContent>
    </IonPage>
  )
}

export default New
