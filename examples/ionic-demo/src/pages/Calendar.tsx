import {
  IonButtons,
  IonButton,
  IonBackButton,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonDatetime,
  IonList,
  IonItem,
  IonLabel,
  IonInput,
  IonText,
  IonNote,
  IonModal,
  IonTextarea,
  IonToggle,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
} from '@ionic/react'
import { useEffect, useState, useMemo, useRef } from 'react'
import { useLiveQuery } from 'electric-sql/react'
import { useElectric, Appointment as AppointmentBase } from '../electric'

import './Calendar.css'

type Appointment = AppointmentBase & {
  hasClash?: boolean
}

const Calendar: React.FC = () => {
  const { db } = useElectric()!
  const [date, setDate] = useState(new Date())
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment>()
  const [presentingElement, setPresentingElement] = useState<HTMLElement>()
  const page = useRef<HTMLElement>()
  const modal = useRef<HTMLIonModalElement>(null)

  useEffect(() => {
    setPresentingElement(page.current)
  }, [])

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

  const appointments = useMemo(() => {
    if (!results) return []
    return results.reduce((appointments, appointment) => {
      const appointmentStart = new Date(appointment.start)
      const appointmentEnd = new Date(appointment.end)
      const appointmentId = appointment.id
      const hasClash = results
        .filter((appointment) => !appointment.cancelled)
        .some((otherAppointment) => {
          const otherAppointmentStart = new Date(otherAppointment.start)
          const otherAppointmentEnd = new Date(otherAppointment.end)
          const otherAppointmentId = otherAppointment.id
          return (
            appointmentId !== otherAppointmentId &&
            appointmentStart.getTime() < otherAppointmentEnd.getTime() &&
            appointmentEnd.getTime() > otherAppointmentStart.getTime()
          )
        })
      appointments.push({ ...appointment, hasClash })
      return appointments
    }, [] as Appointment[])
  }, [results])

  const appointmentsDay = useMemo(() => {
    if (!results) return []
    const dateDay = date.getDate()
    return appointments.reduce((appointmentsDay, appointment) => {
      const appointmentDay = new Date(appointment.start).getDate()
      if (dateDay === appointmentDay) {
        appointmentsDay.push(appointment)
      }
      return appointmentsDay
    }, [] as Appointment[])
  }, [date, appointments])

  const dayCounts = useMemo(() => {
    if (!results) return {}
    return results
      .filter((appointment) => !appointment.cancelled)
      .reduce(
        (dayCounts, appointment) => {
          const appointmentDay = new Date(appointment.start).getDate()
          if (dayCounts[appointmentDay]) {
            dayCounts[appointmentDay]++
          } else {
            dayCounts[appointmentDay] = 1
          }
          return dayCounts
        },
        {} as { [day: string]: number },
      )
  }, [results])

  const onModalDismiss = (ev: any) => {
    setSelectedAppointment(undefined)
  }

  const updatedCanceled = (appointment: Appointment, cancelled: boolean) => {
    db.appointments.update({
      where: {
        id: appointment.id,
      },
      data: {
        cancelled,
      },
    })
  }

  return (
    <IonPage ref={page}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/"></IonBackButton>
          </IonButtons>
          <IonTitle>Your Calendar</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonDatetime
          presentation="date"
          size="cover"
          value={date.toISOString()}
          onIonChange={(e) => setDate(new Date(e.detail.value as string))}
          highlightedDates={(isoString) => {
            const thisDate = new Date(isoString)
            const day = thisDate.getDate()
            const month = thisDate.getMonth()
            const year = thisDate.getFullYear()
            if (month !== date.getMonth() || year !== date.getFullYear()) {
              return
            }
            if (dayCounts[day]) {
              return {
                backgroundColor: '#e7e7ef',
              }
            }
          }}
        ></IonDatetime>

        <IonList>
          {appointmentsDay.map((appointment) => (
            <Row
              key={appointment.id}
              appointment={appointment}
              onClick={() => setSelectedAppointment(appointment)}
              onCancel={() => updatedCanceled(appointment, true)}
              onUnCancel={() => updatedCanceled(appointment, false)}
            />
          ))}
        </IonList>

        <IonModal
          ref={modal}
          isOpen={!!selectedAppointment}
          onWillDismiss={(ev) => onModalDismiss(ev)}
          presentingElement={presentingElement!}
        >
          {selectedAppointment && (
            <EditForm
              key={selectedAppointment?.id}
              appointment={selectedAppointment!}
              modal={modal}
            />
          )}
        </IonModal>
      </IonContent>
    </IonPage>
  )
}

const Row = ({
  appointment,
  onClick,
  onCancel,
  onUnCancel,
}: {
  appointment: Appointment
  onClick: () => void
  onCancel: () => void
  onUnCancel: () => void
}) => {
  return (
    <IonItemSliding>
      <IonItem
        button={true}
        detail={false}
        className={appointment.cancelled ? 'cancelled-item' : ''}
        onClick={onClick}
      >
        <div slot="start">
          <IonNote color={appointment.hasClash ? 'danger' : 'medium'}>
            {new Date(appointment.start).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
            <br />
            {new Date(appointment.end).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </IonNote>
        </div>
        <IonLabel>
          {!!appointment.cancelled && (
            <IonText color="danger">Cancelled: </IonText>
          )}
          <strong>{appointment.name}</strong>{' '}
          <IonText>{appointment.email}</IonText>
          <br />
          <IonNote color="medium" className="ion-text-wrap">
            {appointment.comments || '-'}
          </IonNote>
        </IonLabel>
      </IonItem>
      <IonItemOptions>
        <IonItemOption color="secondary" onClick={onClick}>
          Edit
        </IonItemOption>
        {!appointment.cancelled && (
          <IonItemOption color="danger" onClick={onCancel}>
            Cancel
          </IonItemOption>
        )}
        {appointment.cancelled && (
          <IonItemOption color="success" onClick={onUnCancel}>
            Un-cancel
          </IonItemOption>
        )}
      </IonItemOptions>
    </IonItemSliding>
  )
}

const EditForm = ({
  appointment,
  modal,
}: {
  appointment: Appointment
  modal: React.MutableRefObject<HTMLIonModalElement | null>
}) => {
  const { db } = useElectric()!
  const [name, setName] = useState(appointment.name)
  const [email, setEmail] = useState(appointment.email)
  const [phone, setPhone] = useState(appointment.phone)
  const [address, setAddress] = useState(appointment.address)
  const [comments, setComments] = useState(appointment.comments)
  const [cancelled, setCancelled] = useState(!!appointment.cancelled)

  const start = useMemo(() => new Date(appointment.start), [appointment.start])
  const end = useMemo(() => new Date(appointment.end), [appointment.end])

  const handleConfirm = async () => {
    db.appointments.update({
      where: {
        id: appointment.id,
      },
      data: {
        name,
        email,
        phone,
        address,
        comments,
        cancelled,
      },
    })
    modal.current?.dismiss()
  }

  return (
    <>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => modal.current?.dismiss()}>
              Cancel
            </IonButton>
          </IonButtons>
          <IonTitle>Edit Appointment</IonTitle>
          <IonButtons slot="end">
            <IonButton strong={true} onClick={handleConfirm}>
              Confirm
            </IonButton>
          </IonButtons>
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

        <IonList inset={true}>
          <IonItem>
            <IonToggle
              checked={cancelled}
              onIonChange={(e) => setCancelled(e.detail.checked)}
              color="danger"
            >
              Cancelled
            </IonToggle>
          </IonItem>
        </IonList>
      </IonContent>
    </>
  )
}

export default Calendar
