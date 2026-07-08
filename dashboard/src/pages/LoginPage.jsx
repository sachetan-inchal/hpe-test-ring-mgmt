import { useState, useContext, useEffect } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'
import { ToastContext } from '../context/ToastContext'
import { Hexagon, Eye, EyeOff } from 'lucide-react'

const CHATBOT_API = '/chatbot'

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState('team_member')
  const [team, setTeam] = useState('team-alpha')
  const [availableTeams, setAvailableTeams] = useState([])
  const [selectedTeamOption, setSelectedTeamOption] = useState('')
  const [customTeam, setCustomTeam] = useState('')
  const [checkedTeams, setCheckedTeams] = useState([])
  const [showPw, setShowPw] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const { user, login } = useContext(AuthContext)
  const { addToast } = useContext(ToastContext)
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLogin) {
      fetch(`http://${window.location.hostname}:5005/api/teams`)
        .then(r => r.json())
        .then(data => {
          if (data.teams && Array.isArray(data.teams)) {
            const normalized = data.teams.map(t => {
              if (typeof t === 'string') {
                return { id: t.toLowerCase().replace(/ /g, '-'), name: t, manager_name: 'Test' }
              }
              return {
                id: t.id || t.name?.toLowerCase().replace(/ /g, '-'),
                name: t.name || t,
                manager_name: t.manager_name || 'Test'
              }
            })
            setAvailableTeams(normalized)
            if (normalized.length > 0) {
              setSelectedTeamOption(normalized[0].name)
              setTeam(normalized[0].name)
            } else {
              setSelectedTeamOption('Other')
            }
          }
        })
        .catch(() => {})
    }
  }, [isLogin])

  if (user) return <Navigate to="/" replace />

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    if (!isLogin && password !== confirmPassword) {
      setErrorMsg('Passwords do not match')
      return
    }
    
    let finalTeam = team
    if (!isLogin && selectedTeamOption === 'Other' && customTeam.trim()) {
      finalTeam = customTeam.trim()
      const isExist = availableTeams.some(t => t.name.toLowerCase() === finalTeam.toLowerCase())
      if (!isExist) {
        setAvailableTeams(prev => [...prev, { id: finalTeam.toLowerCase().replace(/ /g, '-'), name: finalTeam, manager_name: name }].sort((a,b) => a.name.localeCompare(b.name)))
        setSelectedTeamOption(finalTeam)
      }
    } else if (!isLogin) {
      finalTeam = selectedTeamOption
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
            name,
            role,
            team: finalTeam,
            cluster: 'cluster-1',
            managedTeams: (role === 'manager' || role === 'director') ? checkedTeams : [],
            managedClusters: [],
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
          <div className="login-logo-row" style={{ justifyContent: 'center', marginBottom: '1rem' }}>
            <img
              src={localStorage.getItem('theme') !== 'dark' ? '/images/Hewlett_Packard_Enterprise-Logo.png' : '/images/HPE_logo_transparent.png'}
              alt="Hewlett Packard Enterprise"
              style={{ width: '270px', borderRadius: '8px', objectFit: 'contain' }}
            />
          </div>

          <p className="login-subtitle">
            {isLogin ? 'Sign in to access the HPE Ring Test Management Tool' : 'Create your account to get started'}
          </p>
        </div>

        {errorMsg && <div className="login-error">{errorMsg}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          {!isLogin && (
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                required
                autoFocus
              />
            </div>
          )}
          <div className="form-group">
            <label>Email or Username</label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@hpe.com"
              required
              autoFocus={isLogin}
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
                <select 
                  className="input" 
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    background: '#161b22',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    outline: 'none'
                  }}
                  value={role} 
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="team_member" style={{ background: '#161b22', color: '#ffffff' }}>Team Member</option>
                  <option value="manager" style={{ background: '#161b22', color: '#ffffff' }}>Manager</option>
                  <option value="director" style={{ background: '#161b22', color: '#ffffff' }}>Director</option>
                  <option value="admin" style={{ background: '#161b22', color: '#ffffff' }}>Administrator</option>
                </select>
              </div>
              {role !== 'admin' && (
                <div className="form-group">
                  <label>Team</label>
                  <select
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '6px',
                      background: '#161b22',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#ffffff',
                      outline: 'none',
                      fontSize: '14px',
                      cursor: 'pointer',
                      appearance: 'auto'
                    }}
                    value={selectedTeamOption}
                    onChange={(e) => {
                      const val = e.target.value
                      setSelectedTeamOption(val)
                      if (val !== 'Other') {
                        setTeam(val)
                        setCustomTeam('')
                      } else {
                        setTeam('')
                      }
                    }}
                  >
                    {availableTeams.map(t => (
                      <option key={t.id || t.name} value={t.name} style={{ background: '#161b22', color: '#ffffff' }}>
                        {t.name}{t.manager_name ? ` (${t.manager_name})` : ''}
                      </option>
                    ))}
                    <option value="Other" style={{ background: '#161b22', color: '#ffffff' }}>Other (Enter new team...)</option>
                  </select>

                  {(selectedTeamOption === 'Other' || !selectedTeamOption || selectedTeamOption.toLowerCase().includes('other')) && (
                    <input
                      type="text"
                      value={customTeam}
                      onChange={(e) => {
                        setCustomTeam(e.target.value)
                        setTeam(e.target.value)
                      }}
                      placeholder="Type new team name here..."
                      autoFocus
                      required
                      style={{
                        display: 'block',
                        width: '100%',
                        marginTop: '10px',
                        padding: '10px 12px',
                        borderRadius: '6px',
                        background: '#0d1117',
                        border: '2px solid #01a982',
                        color: '#ffffff',
                        fontSize: '14px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  )}
                </div>
              )}
              {(role === 'manager' || role === 'director') && (
                <div className="form-group" style={{ paddingLeft: '12px' }}>
                  <label style={{ marginBottom: '8px', display: 'block' }}>Managed Teams</label>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    maxHeight: '150px',
                    overflowY: 'auto',
                    background: 'rgba(255,255,255,0.03)',
                    padding: '10px 16px',
                    borderRadius: '6px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    marginLeft: '8px'
                  }}>
                    {availableTeams.map(t => {
                      const isChecked = checkedTeams.includes(t.name)
                      return (
                        <label key={t.id || t.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setCheckedTeams(prev => [...prev, t.name])
                              } else {
                                setCheckedTeams(prev => prev.filter(item => item !== t.name))
                              }
                            }}
                            style={{ cursor: 'pointer' }}
                          />
                          {t.name}{t.manager_name ? ` (${t.manager_name})` : ''}
                        </label>
                      )
                    })}
                    {selectedTeamOption === 'Other' && customTeam.trim() && !availableTeams.some(t => t.name.toLowerCase() === customTeam.trim().toLowerCase()) && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                        <input
                          type="checkbox"
                          checked={checkedTeams.includes(customTeam.trim())}
                          onChange={(e) => {
                            const val = customTeam.trim()
                            if (e.target.checked) {
                              setCheckedTeams(prev => [...prev, val])
                            } else {
                              setCheckedTeams(prev => prev.filter(item => item !== val))
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                        {customTeam.trim()} (New)
                      </label>
                    )}
                  </div>
                </div>
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
          <span>HPE SAN Platform v0.2</span>
        </div>
      </div>
    </div>
  )
}
