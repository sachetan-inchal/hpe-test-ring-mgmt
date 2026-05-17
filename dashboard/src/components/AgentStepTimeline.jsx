import { useState } from 'react'
import { Brain, Terminal, Braces, Database, Search, CheckCircle2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'

const ICONS = {
  thinking: Brain,
  command: Terminal,
  parsed: Braces,
  neo4j: Database,
  cypher: Search,
  cypher_error: AlertCircle,
  result: CheckCircle2,
  final: CheckCircle2,
  error: AlertCircle,
}

export default function AgentStepTimeline({ steps = [] }) {
  const [expandedSteps, setExpandedSteps] = useState({})

  if (!steps.length) return null

  const toggleExpand = (stepId) => {
    setExpandedSteps(prev => ({
      ...prev,
      [stepId]: !prev[stepId]
    }))
  }

  return (
    <div className="agent-timeline">
      {steps.map((step, i) => {
        const Icon = ICONS[step.type] || CheckCircle2
        const isLast = i === steps.length - 1
        const stepId = step.id || i + 1
        const isExpanded = !!expandedSteps[stepId]
        const hasOutput = step.type === 'command' && step.command_output

        return (
          <div key={step.id || i} className="agent-step animate-reveal" style={{ animationDelay: `${i * 150}ms` }}>
            <div className="agent-step-rail">
              <div className={`agent-step-icon agent-step-icon--${step.type || 'default'}`}>
                <Icon size={14} />
              </div>
              {!isLast && <div className="agent-step-line" />}
            </div>
            <div className="agent-step-body" style={{ width: '100%' }}>
              <div className="agent-step-head" 
                style={hasOutput ? { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 } : {}}
                onClick={hasOutput ? () => toggleExpand(stepId) : undefined}
              >
                <span className="agent-step-num">Step {stepId}</span>
                {hasOutput && (
                  isExpanded ? <ChevronDown size={14} style={{ color: 'var(--muted)' }} /> : <ChevronRight size={14} style={{ color: 'var(--muted)' }} />
                )}
                <span className="agent-step-title" style={hasOutput ? { textDecoration: 'underline decoration-dotted', color: 'var(--accent-cyan)' } : {}}>{step.title}</span>
                {step.timestamp && <span className="agent-step-time">{step.timestamp}</span>}
              </div>
              {step.detail && <p className="agent-step-detail">{step.detail}</p>}
              {step.command && <pre className="agent-step-cmd">{step.command}</pre>}
              
              {hasOutput && isExpanded && (
                <div style={{ marginTop: 8, animation: 'fadeIn 0.2s ease-out' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>COMMAND OUTPUT:</div>
                  <pre className="agent-step-cmd" style={{ 
                    maxHeight: '260px', 
                    overflowY: 'auto', 
                    background: 'var(--surface-3)', 
                    borderColor: 'var(--line)', 
                    color: 'rgba(255,255,255,0.85)',
                    padding: '8px 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    lineHeight: 1.5,
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    whiteSpace: 'pre-wrap'
                  }}>{step.command_output}</pre>
                </div>
              )}

              {step.cypher && <pre className="agent-step-cmd agent-step-cypher">{step.cypher}</pre>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
