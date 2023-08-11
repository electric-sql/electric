import axios from 'axios'
import { BACKEND_URL } from './config'
axios.defaults.baseURL = BACKEND_URL

const setEndpoint = (url: string) => {
  axios.defaults.baseURL = url
}

const bootstrapDemo = async (sessionId, demoName, numItems) => {
  let resp

  const ts = `${Date.now()}`

  try {
    resp = await axios.post('/api/items/bootstrap', {
      data: {
        session_id: sessionId,
        name: demoName,
        timestamp: ts,
        num_items: numItems
      }
    })
  }
  catch (err) {
    return
  }

  if (resp.status !== 200) {
    return
  }

  return resp.data.data
}

const getItems = async (data: object) => {
  let resp

  try {
    resp = await axios.get('/api/items', {params: data})
  }
  catch (_err) {
    return
  }

  if (resp.status !== 200) {
    return
  }

  return resp.data.data
}

const postItem = async (data: object) => {
  let resp

  try {
    resp = await axios.post('/api/items', data)
  }
  catch (_err) {
    return
  }

  if (resp.status !== 200) {
    return
  }

  return resp.data.data
}

const deleteItem = async (data: object) => {
  let resp

  try {
    resp = await axios.delete('/api/items', {data: data})
  }
  catch (_err) {
    return false
  }

  if (resp.status !== 204) {
    return false
  }

  return true
}

const getUserCreds = async (userId: string) => {
  let resp

  try {
    resp = await axios.post(`/api/users/get_or_create/${userId}`)
  }
  catch (err) {
    return
  }

  if (resp.status !== 201) {
    return
  }

  const { user_id, password } = resp.data.data

  return {
    userId: user_id,
    password: password
  }
}

export default {
  bootstrapDemo,
  deleteItem,
  getItems,
  getUserCreds,
  postItem,
  setEndpoint
}
