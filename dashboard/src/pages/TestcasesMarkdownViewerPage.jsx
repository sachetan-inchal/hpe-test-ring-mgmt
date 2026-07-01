import React, { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Code, FileText, PanelsTopLeft, Plus, Pencil, Trash2, Check, X, Search } from 'lucide-react'

function safeJsonParse(s) {
  try {
    return typeof s === 'string' ? JSON.parse(s) : s
  } catch {
    return null
  }
}

function pretty(obj) {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

function Box({ title, icon, children, headerRight }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 14,
      padding: 14,
      boxShadow: '0 0 0 1px rgba(1,169,130,0.03) inset'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ color: 'var(--hpe-green)' }}>
            {icon}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
            {title}
          </div>
        </div>
        {headerRight && <div>{headerRight}</div>}
      </div>
      {children}
    </div>
  )
}

export default function TestcasesMarkdownViewerPage({ apiBase }) {
  const apiUrl = `${apiBase}/api/parsers/testcases-markdown`
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  
  const [preface, setPreface] = useState('')
  const [functions, setFunctions] = useState([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')

  // Edit / Add States
  const [isEditing, setIsEditing] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formFuncName, setFormFuncName] = useState('')
  const [formCode, setFormCode] = useState('')
  const [formCliOutput, setFormCliOutput] = useState('')
  const [formParsedOutput, setFormParsedOutput] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    setSuccessMsg('')
    try {
      const res = await fetch(apiUrl)
      if (!res.ok) {
        const txt = await res.text()
        setError(`Failed to load parser output (${res.status}): ${txt}`)
        return
      }
      const data = await res.json()
      setPreface(data.preface || '')
      setFunctions(data.functions || [])
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredFunctions = useMemo(() => {
    if (!searchTerm.trim()) return functions
    const lower = searchTerm.toLowerCase()
    return functions.filter(fn => 
      (fn.title || '').toLowerCase().includes(lower) ||
      (fn.func_name || '').toLowerCase().includes(lower) ||
      (fn.code || '').toLowerCase().includes(lower)
    )
  }, [functions, searchTerm])

  const selected = filteredFunctions.length ? filteredFunctions[Math.min(selectedIndex, filteredFunctions.length - 1)] : null

  // Find index in main list
  const selectedMainIndex = useMemo(() => {
    if (!selected) return -1
    return functions.findIndex(fn => fn.func_name === selected.func_name && fn.title === selected.title)
  }, [selected, functions])

  const startEdit = () => {
    if (!selected) return
    setFormTitle(selected.title || '')
    setFormFuncName(selected.func_name || '')
    setFormCode(selected.code || '')
    setFormCliOutput(selected.cli_outputs?.[0] || '')
    setFormParsedOutput(selected.parsed_outputs?.[0] || '')
    setIsEditing(true)
    setIsAdding(false)
    setError('')
    setSuccessMsg('')
  }

  const startAdd = () => {
    setFormTitle('')
    setFormFuncName('parseNewCommand')
    setFormCode('function parseNewCommand(cliOutput) {\n    const result = {};\n    // TODO: implement parser\n    return result;\n}')
    setFormCliOutput('')
    setFormParsedOutput('{}')
    setIsAdding(true)
    setIsEditing(false)
    setError('')
    setSuccessMsg('')
  }

  const handleDelete = async () => {
    if (!selected) return
    if (!window.confirm(`Are you sure you want to delete parser "${selected.title || selected.func_name}"?`)) return
    
    setLoading(true)
    setError('')
    setSuccessMsg('')
    try {
      const updated = functions.filter((_, idx) => idx !== selectedMainIndex)
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preface, functions: updated })
      })
      if (!res.ok) {
        const txt = await res.text()
        setError(`Failed to delete parser (${res.status}): ${txt}`)
        return
      }
      setSuccessMsg('Parser deleted successfully.')
      setFunctions(updated)
      setSelectedIndex(0)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    setSuccessMsg('')

    if (!formTitle.trim()) {
      setError('Title/Command description is required.')
      return
    }
    if (!formFuncName.trim()) {
      setError('Function name is required.')
      return
    }
    if (!formCode.includes(formFuncName)) {
      setError(`Code must contain the function definition matching "${formFuncName}".`)
      return
    }
    if (formParsedOutput.trim()) {
      try {
        JSON.parse(formParsedOutput)
      } catch (err) {
        setError('Expected Parsed Output must be valid JSON.')
        return
      }
    }

    setSaving(true)
    try {
      const newParser = {
        title: formTitle.trim(),
        func_name: formFuncName.trim(),
        code: formCode,
        cli_outputs: [formCliOutput],
        parsed_outputs: [formParsedOutput]
      }

      let updated = [...functions]
      if (isEditing && selectedMainIndex !== -1) {
        updated[selectedMainIndex] = newParser
      } else {
        updated.push(newParser)
      }

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preface, functions: updated })
      })

      if (!res.ok) {
        const txt = await res.text()
        setError(`Failed to save parser (${res.status}): ${txt}`)
        return
      }

      setSuccessMsg('Parser saved and testcases-markdown.md updated successfully.')
      setFunctions(updated)
      setIsEditing(false)
      setIsAdding(false)
      if (isAdding) {
        setSelectedIndex(updated.length - 1)
      }
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(1,169,130,0.10)', border: '1px solid rgba(1,169,130,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--hpe-green)' }}>
            <PanelsTopLeft size={18} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--foreground)' }}>PARSER EDITOR</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Add, edit, or delete parsing function definitions inside <span style={{ color: 'var(--accent-blue)' }}>discovery/parsers/testcases-markdown.md</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={startAdd}
            disabled={loading || saving || isAdding}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px',
              background: 'rgba(1,169,130,0.8)',
              border: '1px solid var(--hpe-green)',
              borderRadius: 10,
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 12
            }}
          >
            <Plus size={14} />
            Add Parser
          </button>
          
          <button
            onClick={load}
            disabled={loading || saving}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px',
              background: loading ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 10,
              color: 'var(--foreground)',
              cursor: loading ? 'wait' : 'pointer',
              fontWeight: 700,
              fontSize: 12
            }}
            title="Reload parsed JSON from backend"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Reloading…' : 'Reload'}
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, border: '1px solid rgba(255, 99, 71, 0.35)', background: 'rgba(255, 99, 71, 0.08)', color: 'var(--foreground)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4, color: '#ff8a80' }}>Error</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{error}</pre>
        </div>
      )}

      {successMsg && (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, border: '1px solid rgba(1, 169, 130, 0.35)', background: 'rgba(1, 169, 130, 0.08)', color: 'var(--foreground)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4, color: 'var(--hpe-green)' }}>Success</div>
          <div style={{ fontSize: 12 }}>{successMsg}</div>
        </div>
      )}

      {/* Main Workspace Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 14 }}>
        
        {/* Left Column: Parser List & Search */}
        <div style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minHeight: 500
        }}>
          {/* Search bar */}
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--muted)' }} />
            <input
              type="text"
              placeholder="Search parsers..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setSelectedIndex(0)
              }}
              style={{
                width: '100%',
                padding: '8px 12px 8px 30px',
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                color: 'var(--foreground)',
                fontSize: 12,
                outline: 'none'
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <FileText size={14} style={{ color: 'var(--hpe-green)' }} />
              <div style={{ fontSize: 13, fontWeight: 800 }}>Parsers List</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{filteredFunctions.length} found</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', maxHeight: '600px', paddingRight: 4 }}>
            {filteredFunctions.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>
                No parsers match the search criteria.
              </div>
            )}

            {filteredFunctions.map((fn, idx) => {
              const label = fn.title || fn.func_name || `Parser ${idx + 1}`
              const isSelected = selectedMainIndex !== -1 && functions[selectedMainIndex]?.func_name === fn.func_name && functions[selectedMainIndex]?.title === fn.title
              
              return (
                <button
                  key={idx}
                  onClick={() => {
                    setSelectedIndex(idx)
                    setIsEditing(false)
                    setIsAdding(false)
                    setError('')
                    setSuccessMsg('')
                  }}
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    border: isSelected ? '1px solid rgba(1,169,130,0.5)' : '1px solid rgba(255,255,255,0.08)',
                    background: isSelected ? 'rgba(1,169,130,0.12)' : 'rgba(255,255,255,0.03)',
                    color: 'var(--foreground)',
                    transition: 'all 0.2s'
                  }}
                  title={String(label)}
                >
                  <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.25 }}>
                    {String(label)}
                  </div>
                  {fn.func_name && (
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontFamily: 'monospace' }}>
                      {fn.func_name}()
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Right Column: Detail Display OR Editor Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          
          {(isEditing || isAdding) ? (
            /* EDITOR FORM */
            <form onSubmit={handleSave} style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(1,169,130,0.3)',
              borderRadius: 14,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 14
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--hpe-green)' }}>
                  {isAdding ? 'Create New Parser Definition' : `Edit Parser: ${formTitle}`}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false)
                      setIsAdding(false)
                      setError('')
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 8,
                      color: 'var(--foreground)',
                      fontSize: 11,
                      cursor: 'pointer'
                    }}
                  >
                    <X size={12} />
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px',
                      background: 'rgba(1,169,130,0.8)',
                      border: '1px solid var(--hpe-green)',
                      borderRadius: 8,
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {saving ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                    {saving ? 'Saving...' : 'Save Parser'}
                  </button>
                </div>
              </div>

              {/* Form Fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4, color: 'var(--muted)' }}>
                    Title/Command Description (e.g. SHOWSYS or SHOWVERSION -B)
                  </label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      color: 'var(--foreground)',
                      fontSize: 12
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4, color: 'var(--muted)' }}>
                    Parsing Function Name (e.g. parseShowSys)
                  </label>
                  <input
                    type="text"
                    required
                    value={formFuncName}
                    onChange={(e) => setFormFuncName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      color: 'var(--foreground)',
                      fontSize: 12,
                      fontFamily: 'monospace'
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4, color: 'var(--muted)' }}>
                  CLI Output Example (input to the parser)
                </label>
                <textarea
                  rows={4}
                  value={formCliOutput}
                  onChange={(e) => setFormCliOutput(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    color: 'var(--foreground)',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    resize: 'vertical'
                  }}
                  placeholder="Paste raw command CLI output here..."
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4, color: 'var(--muted)' }}>
                  Parsing Javascript Function Code
                </label>
                <textarea
                  rows={10}
                  required
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 8,
                    color: '#a5d6a7', // light green font for code
                    fontSize: 12,
                    fontFamily: 'Consolas, Monaco, Courier New, monospace',
                    resize: 'vertical',
                    lineHeight: '1.4'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4, color: 'var(--muted)' }}>
                  Expected Parsed Output (JSON format)
                </label>
                <textarea
                  rows={5}
                  value={formParsedOutput}
                  onChange={(e) => setFormParsedOutput(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    color: '#90caf9', // light blue font for json
                    fontSize: 12,
                    fontFamily: 'monospace',
                    resize: 'vertical'
                  }}
                  placeholder="{}"
                />
              </div>
            </form>
          ) : (
            /* READ-ONLY VIEW */
            <>
              {selected ? (
                <>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 14,
                    padding: '12px 16px'
                  }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--foreground)' }}>
                        {selected.title || selected.func_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'monospace' }}>
                        Source parser: {selected.func_name}()
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={startEdit}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '6px 12px',
                          background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.15)',
                          borderRadius: 8,
                          color: 'var(--foreground)',
                          fontSize: 11,
                          cursor: 'pointer'
                        }}
                      >
                        <Pencil size={12} />
                        Edit
                      </button>
                      <button
                        onClick={handleDelete}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '6px 12px',
                          background: 'rgba(255, 99, 71, 0.1)',
                          border: '1px solid rgba(255, 99, 71, 0.3)',
                          borderRadius: 8,
                          color: '#ff8a80',
                          fontSize: 11,
                          cursor: 'pointer'
                        }}
                      >
                        <Trash2 size={12} />
                        Delete
                      </button>
                    </div>
                  </div>

                  <Box title="Function Prototype" icon={<Code size={14} />}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, color: 'var(--foreground)', fontFamily: 'Consolas, monospace' }}>
                      {selected.code || '—'}
                    </pre>
                  </Box>

                  <Box title="CLI Output Example" icon={<FileText size={14} />}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, color: 'var(--foreground)', fontFamily: 'Consolas, monospace' }}>
                      {selected.cli_outputs?.[0] || '—'}
                    </pre>
                  </Box>

                  <Box title="Expected Parsed Output" icon={<PanelsTopLeft size={14} />}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, color: 'var(--foreground)', maxHeight: 380, overflow: 'auto', fontFamily: 'Consolas, monospace' }}>
                      {selected.parsed_outputs?.[0] ? pretty(safeJsonParse(selected.parsed_outputs[0]) || selected.parsed_outputs[0]) : '—'}
                    </pre>
                  </Box>
                </>
              ) : (
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 14,
                  padding: '40px 20px',
                  textAlign: 'center',
                  color: 'var(--muted)',
                  fontSize: 13
                }}>
                  No parser selected. Click a parser from the list or click "Add Parser" to create a new one.
                </div>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  )
}

