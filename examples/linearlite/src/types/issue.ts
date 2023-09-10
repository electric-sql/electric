export const Priority = {
  NONE: 'none',
  URGENT: 'urgent',
  HIGH: 'high',
  LOW: 'low',
  MEDIUM: 'medium',
}

export const Status = {
  BACKLOG: 'backlog',
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  CANCELED: 'canceled',
}

// export type User = {
//   id?: string;
//   name?: string;
//   avatar?: string;
// };
// export type Issue = {
//   priority: string;
//   id: string | undefined;
//   title: string;
//   description: string;
//   status: string;
//   createdAt?: Date;
//   owner?: User;
// };
//
export type Label = {
  id: string
  name: string
  color: string
}

export const DEFAULT_LABELS: Array<Label> = [
  { id: '1', name: 'Bug', color: '#eb5757' },
  { id: '2', name: 'Feature', color: '#bb87fc' },
  { id: '3', name: 'Improvement', color: '#4ea7fc' },
]

export function getPriorityString(priority: string) {
  switch (priority) {
    case Priority.NONE:
      return 'Priority'
    case Priority.HIGH:
      return 'High'
    case Priority.MEDIUM:
      return 'Medium'
    case Priority.LOW:
      return 'Low'
    case Priority.URGENT:
      return 'Urgent'
    default:
      return 'Priority'
  }
}
