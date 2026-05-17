import { createContext, useState, useEffect } from 'react'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('hpe_user')
    if (stored) {
      try { setUser(JSON.parse(stored)) } catch {}
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const originalFetch = window.fetch

    window.fetch = (input, init = {}) => {
      const reqUrl = typeof input === 'string' ? input : (input?.url || '')
      const isInternal = reqUrl.startsWith('/') || reqUrl.includes(window.location.host)
      const shouldAttach = isInternal && (reqUrl.includes('/api') || reqUrl.includes('/chatbot') || reqUrl === '' || reqUrl.startsWith('/'))

      if (!shouldAttach || !user) {
        return originalFetch(input, init)
      }

      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined) || {})

      if (user.token && reqUrl.includes('/chatbot') && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${user.token}`)
      }

      headers.set('X-User-Id', String(user._id || ''))
      headers.set('X-User-Role', String(user.role || 'team_member'))
      headers.set('X-User-Team', String(user.team || ''))
      headers.set('X-User-Cluster', String(user.cluster || ''))
      headers.set('X-User-Managed-Teams', Array.isArray(user.managedTeams) ? user.managedTeams.join(',') : '')
      headers.set('X-User-Managed-Clusters', Array.isArray(user.managedClusters) ? user.managedClusters.join(',') : '')

      return originalFetch(input, { ...init, headers }).then(response => {
        if (response.status === 401 && (reqUrl.includes('/chat') || reqUrl.includes('/message') || reqUrl.includes('/chatbot'))) {
          setUser(null);
          localStorage.removeItem('hpe_user');
        }
        return response;
      });
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [user])

  const login = (userData) => {
    setUser(userData)
    localStorage.setItem('hpe_user', JSON.stringify(userData))
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('hpe_user')
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
