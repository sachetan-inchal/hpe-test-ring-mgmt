import { useState } from 'react'
import AuthContext from './context/AuthContext'
import ChatPage from './pages/ChatPage'

export default function App() {
  // Standalone mode: no real auth; keep same shape expected by ChatPage.
  const [auth, setAuth] = useState({
    user: { username: 'Guest', token: null },
    loading: false,
    login: () => setAuth(a => ({ ...a, user: { ...a.user, token: 'demo' } })),
    logout: () => setAuth(a => ({ ...a, user: { username: 'Guest', token: null } })),
  })

  return (
    <AuthContext.Provider value={auth}>
      <ChatPage apiBase={`http://${window.location.hostname}:5005`} chatbotApi={'/chatbot'} />
    </AuthContext.Provider>
  )
}

