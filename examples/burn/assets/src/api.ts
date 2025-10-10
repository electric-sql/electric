import axios, { AxiosError } from 'axios'
import type { PendingMutation } from '@tanstack/react-db'

import { authCollection } from './db/collections'
import type { User } from './db/schema'

type SignInResult = Pick<User, 'id' | 'name'>

type IngestPayload = {
  mutations: Omit<PendingMutation, 'collection'>[]
}

const authHeaders = () => {
  const auth = authCollection.get('current')

  return auth !== undefined ? { Authorization: `Bearer ${auth.user_id}` } : {}
}

export async function signIn(
  username: string,
  avatarUrl: string | undefined
): Promise<string | undefined> {
  const data = {
    avatar_url: avatarUrl !== undefined ? avatarUrl : null,
    username,
  }
  const headers = authHeaders()

  try {
    const response = await axios.post('/auth/sign-in', data, { headers })
    const { id: user_id }: SignInResult = response.data

    return user_id
  } catch (err: unknown) {
    if (err instanceof AxiosError) {
      return
    }

    throw err
  }
}

export async function ingest(
  payload: IngestPayload
): Promise<number | undefined> {
  const headers = authHeaders()

  try {
    const response = await axios.post('/ingest/mutations', payload, { headers })

    // Phoenix sync should return txid as a number but older versions used a string.
    // So handle either, making sure we treat it internally as a number.
    const txid = response.data.txid as string | number
    const txidInt = typeof txid === 'string' ? parseInt(txid, 10) : txid

    return txidInt
  } catch (err: unknown) {
    if (err instanceof AxiosError) {
      return
    }

    throw err
  }
}
