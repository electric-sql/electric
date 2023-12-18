import { genUUID } from "electric-sql/util";
import { Activity_events } from "../generated/client";


/**
 * Formats a date to a human-readable timestamp.
 * @param date - the date to format
 * @returns {string}
 */
export function formatDateTime(date: Date): string {
  const options: Intl.DateTimeFormatOptions = { 
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  }
  const formattedDate = date.toLocaleDateString(
    navigator.language,
    options
  );
  return formattedDate;
}

export const CURRENT_USER = 'me';

const users = [
  'Alice',
  'Bob',
  'Tauseef',
  'Misha',
  'Eleni'
]

enum ActivityType {
  like = 'like',
  comment = 'comment',
  react = 'react',
  invite = 'invite',
  join = 'join',
  message = 'message'
}

function getActivityText(user: string, activity: ActivityType): string {
  switch (activity) {
    case ActivityType.like:
      return `${user} liked your photo.`;
    case ActivityType.comment:
      return `${user} commented on your post.`;
    case ActivityType.react:
      return `${user} reacted to your post.`;
    case ActivityType.invite:
      return `${user} invited you to an event.`;
    case ActivityType.join:
      return `${user} joined your group.`;
    case ActivityType.message:
      return `${user} sent you a message.`;
    default:
      return `${user} performed an unknown activity.`;
  }
}

function getActivityAction(activity: ActivityType): string | null {
  switch (activity) {
    case ActivityType.comment:
    case ActivityType.message:
      return 'Reply';
    case ActivityType.invite:
      return 'Accept';
  }
  return null;
}


function getRandomElement<T>(list: T[]): T | null {
  if (list.length === 0) {
    return null; // Return null if the list is empty
  }
  const randomIndex = Math.floor(Math.random() * list.length);
  return list[randomIndex];
}


/**
 * Generates a randomized social-media-like activity event for
 * demo-ing purposes
 * 
 * @returns {Activity_events}
 */
export function generateActivity(): Activity_events {
  const user = getRandomElement(users)!;
  const activityType = getRandomElement(Object.values(ActivityType))!;
  return {
    id: genUUID(),
    source: user,
    target: CURRENT_USER,
    activity_type: activityType,
    timestamp: new Date(),
    message: getActivityText(user, activityType),
    action: getActivityAction(activityType),
    read_at: null
  }
}




