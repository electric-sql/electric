import { useLocalSearchParams } from "expo-router"
import * as Linking from 'expo-linking';

const USER_ID_KEY = 'user_id'
const USER_NAME_KEY = 'user_name'
const FAMILY_ID_KEY = 'family_id'

interface InviteParams extends Record<string, string>{
  [USER_ID_KEY]: string,
  [USER_NAME_KEY]: string,
  [FAMILY_ID_KEY]: string
}

interface InviteQueryParams {
  queryTargetFamilyId?: string
  inviteeUserId?: string
  inviteeUserName?: string
}


/**
 * Utility hook for reading invite related query parameters
 * @returns the invite related query parameters
 */
export function useInviteQueryParams(): InviteQueryParams {
  const {
    [FAMILY_ID_KEY]: queryTargetFamilyId,
    [USER_ID_KEY]: inviteeUserId,
    [USER_NAME_KEY]: inviteeUserName
  } = useLocalSearchParams<InviteParams>()
  return {
    queryTargetFamilyId,
    inviteeUserId,
    inviteeUserName
  }
}


/**
 * Create a deep link that can be used for inviting the
 * person who created it to other families
 * @param userId - the link creator's user ID
 * @param userName - the link creator's desired user name
 * @returns a deep link to the invite page
 */
export function createInviteUrl(
  userId: string,
  userName?: string
): string {
  return Linking.createURL('/invite', {
    queryParams: {
      [USER_ID_KEY]: userId,
      [USER_NAME_KEY]: userName
    },
  })
}


/**
 * Parses an invite URL to an internal link for redirecting to the
 * appropriate invite page and optionally pre-selecting the right family
 * @param inviteUrl the source URL to parse
 * @param familyId the optional family ID to pre-select for the invite
 * @returns local link (path + query params) to perform invite
 */
export function parseToInternalInviteUrl(inviteUrl: string, familyId?: string): string {
  const parsedUrl = Linking.parse(inviteUrl)

  // ensure link has correct schema, path, and a user ID
  // before redirecting to a family invite
  if (
    parsedUrl.scheme === Linking.resolveScheme({}) &&
    parsedUrl.path === 'invite' &&
    !!parsedUrl.queryParams?.['user_id']
  ) {
    const searchParams = new URLSearchParams(
      familyId !== undefined ? {
        ...parsedUrl.queryParams,
        [FAMILY_ID_KEY]: familyId,
      } :
      parsedUrl.queryParams as Record<string, string>
    )
    return `/invite?${searchParams.toString()}`
  } 

  throw Error('Invalid invite URL')
}