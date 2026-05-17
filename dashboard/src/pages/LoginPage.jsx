import { useState, useContext } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'
import { ToastContext } from '../context/ToastContext'
import { Hexagon, Eye, EyeOff } from 'lucide-react'

const CHATBOT_API = '/chatbot'

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState('team_member')
  const [team, setTeam] = useState('team-alpha')
  const [cluster, setCluster] = useState('cluster-1')
  const [managedTeams, setManagedTeams] = useState('')
  const [managedClusters, setManagedClusters] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const { user, login } = useContext(AuthContext)
  const { addToast } = useContext(ToastContext)
  const navigate = useNavigate()

  if (user) return <Navigate to="/" replace />

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    if (!isLogin && password !== confirmPassword) {
      setErrorMsg('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register'
      const res = await fetch(`${CHATBOT_API}${endpoint.replace('/api', '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: email,
          password,
          ...(isLogin ? {} : {
            role,
            team,
            cluster,
            managedTeams: managedTeams.split(',').map(s => s.trim()).filter(Boolean),
            managedClusters: managedClusters.split(',').map(s => s.trim()).filter(Boolean),
          })
        })
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data.message || 'Authentication failed')
      } else {
        login(data)
        addToast(isLogin ? 'Signed in successfully' : 'Account created successfully', 'success')
        navigate('/')
      }
    } catch {
      setErrorMsg('Cannot connect to server. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      {/* Animated background */}
      <div className="login-bg">
        <div className="login-glow glow-1" />
        <div className="login-glow glow-2" />
        <div className="login-glow glow-3" />
        <div className="login-grid" />
      </div>

      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo-row">
            <span className="brand-rect large" />
            <div>
              <div className="login-brand-name">Hewlett Packard</div>
              <div className="login-brand-sub">Enterprise</div>
            </div>
          </div>
          <h1 className="login-title">SAN Unified Platform</h1>
          <p className="login-subtitle">
            {isLogin ? 'Sign in to access the SAN management dashboard' : 'Create your account to get started'}
          </p>
        </div>

        {errorMsg && <div className="login-error">{errorMsg}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>Email or Username</label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@hpe.com"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <div className="pw-wrapper">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
              />
              <button type="button" className="pw-toggle" onClick={() => setShowPw(p => !p)}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {!isLogin && (
            <div className="form-group">
              <label>Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                required
              />
            </div>
          )}

          {!isLogin && (
            <>
              <div className="form-group">
                <label>Role</label>
                <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="team_member">Team Member</option>
                  <option value="manager">Manager</option>
                  <option value="senior_manager">Senior Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="form-group">
                <label>Team</label>
                <input
                  type="text"
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  placeholder="team-alpha"
                  required
                />
              </div>
              <div className="form-group">
                <label>Cluster</label>
                <input
                  type="text"
                  value={cluster}
                  onChange={(e) => setCluster(e.target.value)}
                  placeholder="cluster-1"
                  required
                />
              </div>
              {(role === 'manager' || role === 'senior_manager' || role === 'admin') && (
                <>
                  <div className="form-group">
                    <label>Managed Teams (comma separated)</label>
                    <input
                      type="text"
                      value={managedTeams}
                      onChange={(e) => setManagedTeams(e.target.value)}
                      placeholder="team-alpha,team-beta"
                    />
                  </div>
                  <div className="form-group">
                    <label>Managed Clusters (comma separated)</label>
                    <input
                      type="text"
                      value={managedClusters}
                      onChange={(e) => setManagedClusters(e.target.value)}
                      placeholder="cluster-1,cluster-2"
                    />
                  </div>
                </>
              )}
            </>
          )}
          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <p className="login-toggle">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button onClick={() => { setIsLogin(!isLogin); setErrorMsg('') }}>
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </p>

        <div className="login-footer">
          <Hexagon size={14} />
          <span>HPE SAN Platform v2.0</span>
        </div>
      </div>
    </div>
  )
}
