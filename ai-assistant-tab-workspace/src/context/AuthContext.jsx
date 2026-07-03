import { createContext } from 'react'

const AuthContext = createContext({
  user: null,
  loading: true,
  login: () => {},
  logout: () => {},
})

export default AuthContext

