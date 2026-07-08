import { useNavigate, Navigate } from 'react-router-dom'
import { useContext } from 'react'
import { AuthContext } from '../context/AuthContext'
import { ArrowRight, Hexagon, Activity, Shield, Zap, Globe, Database, Network, Cpu, Lock, BarChart3, CheckCircle, Radar } from 'lucide-react'

export default function LandingPage() {
  const navigate = useNavigate()
  const { user } = useContext(AuthContext)

  // Redirect logged-in users to ssh-ring
  if (user) return <Navigate to="/ssh-ring" replace />

  const features = [
    { icon: Activity, title: 'Real-time Monitoring', desc: 'Live network discovery and health tracking' },
    { icon: Shield, title: 'Enterprise Security', desc: 'Role-based access and secure authentication' },
    { icon: Zap, title: 'Lightning Fast', desc: 'Optimized performance for large-scale networks' },
    { icon: Globe, title: 'Global Reach', desc: 'Manage SAN infrastructure across locations' },
    { icon: Database, title: 'Smart Inventory', desc: 'Hierarchical resource management' },
    { icon: Network, title: 'Topology Visualization', desc: 'Interactive SAN diagram and ring topology' },
  ]

  return (
    <div className="landing-page">
      {/* Animated background */}
      <div className="landing-bg">
        <div className="landing-glow glow-1" />
        <div className="landing-glow glow-2" />
        <div className="landing-glow glow-3" />
        <div className="landing-grid" />
      </div>

      {/* Header */}
      <header className="landing-header">
        <img
          src={localStorage.getItem('theme') !== 'dark' ? '/images/Hewlett_Packard_Enterprise-Logo.png' : '/images/HPE_logo_transparent.png'}
          alt="Hewlett Packard Enterprise"
          className="header-logo"
        />
        <div className="header-buttons">
          <button
            className="header-btn secondary"
            onClick={() => {
              console.log('Navigate to /login')
              navigate('/login')
            }}
          >
            Sign In
          </button>
          <button
            className="header-btn primary"
            onClick={() => {
              console.log('Navigate to /login')
              navigate('/login')
            }}
          >
            Get Started
          </button>
        </div>
      </header>

      <div className="landing-container">
        {/* Left side - Text content */}
        <div className="landing-content">
          <h1 className="landing-title">
            HPE SAN Unified Platform
          </h1>

          <p className="landing-subtitle">
            Comprehensive Test Ring Management for Storage Area Networks
          </p>

          <p className="landing-description">
            Monitor, discover, and manage your SAN infrastructure with our unified platform.
            Real-time topology visualization, automated discovery, and intelligent health monitoring
            all in one place.
          </p>

          <div className="landing-features-horizontal">
            <div className="feature-horizontal-item">
              <Radar size={32} className="feature-horizontal-icon" />
              <h3 className="feature-horizontal-title">Real-time Discovery</h3>
              <p className="feature-horizontal-desc">Instant topology mapping</p>
            </div>
            <div className="feature-horizontal-item">
              <Shield size={32} className="feature-horizontal-icon" />
              <h3 className="feature-horizontal-title">Secure & Reliable</h3>
              <p className="feature-horizontal-desc">Enterprise-grade security</p>
            </div>
            <div className="feature-horizontal-item">
              <BarChart3 size={32} className="feature-horizontal-icon" />
              <h3 className="feature-horizontal-title">Unified Insights</h3>
              <p className="feature-horizontal-desc">All SAN data in one view</p>
            </div>
            <div className="feature-horizontal-item">
              <Zap size={32} className="feature-horizontal-icon" />
              <h3 className="feature-horizontal-title">Intelligent Automation</h3>
              <p className="feature-horizontal-desc">Smarter operations</p>
            </div>
          </div>

          <div className="landing-buttons">
            <button
              className="landing-btn primary"
              onClick={() => {
                console.log('Navigate to /login from main button')
                navigate('/login')
              }}
            >
              Login
              <ArrowRight size={18} />
            </button>
            <button
              className="landing-btn secondary"
              onClick={() => alert('Demo video coming soon!')}
            >
              Watch Demo
            </button>
          </div>
        </div>

        {/* Right side - Image */}
        <div className="landing-image-wrapper">
          <img
            src="/images/landing_page_image.png"
            alt="HPE Platform Dashboard"
            className="landing-image"
          />
        </div>
      </div>

      {/* Trusted by section */}
      <div className="trusted-section">
        <p className="trusted-label">Developed by HPE CPP3 Team</p>
        <div className="trusted-logos">
          <div className="logo-placeholder">Enterprise A</div>
          <div className="logo-placeholder">Enterprise B</div>
          <div className="logo-placeholder">Enterprise C</div>
          <div className="logo-placeholder">Enterprise D</div>
        </div>
      </div>

      {/* Features grid */}
      <div className="features-section">
        <h2 className="features-title">Key Features</h2>
        <div className="features-grid">
          {features.map((feature, index) => (
            <div key={index} className="feature-card">
              <div className="feature-icon-wrapper">
                <feature.icon size={28} className="feature-icon" />
              </div>
              <h3 className="feature-card-title">{feature.title}</h3>
              <p className="feature-card-desc">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="landing-footer">
        <Hexagon size={14} />
        <span>HPE SAN Platform v0.2</span>
      </div>
    </div>
  )
}
