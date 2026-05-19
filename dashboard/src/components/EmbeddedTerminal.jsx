import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'

/**
 * EmbeddedTerminal
 * Renders a full xterm.js terminal that connects to the SAN Agent's
 * backend shell subprocess via SSE (output) + REST (input).
 *
 * Props:
 *   apiBase  – e.g. "http://localhost:5000"
 *   active   – boolean; whether the terminal should be connected
 */
const EmbeddedTerminal = forwardRef(function EmbeddedTerminal({ apiBase, active }, ref) {
  const containerRef = useRef(null)
  const termRef      = useRef(null)
  const fitAddon     = useRef(null)
  const esRef        = useRef(null)

  // Expose a write() method so parent can inject text programmatically
  useImperativeHandle(ref, () => ({
    write: (text) => termRef.current?.write(text),
    clear: () => termRef.current?.clear(),
  }))

  useEffect(() => {
    if (!containerRef.current) return

    // ── Create terminal ──────────────────────────────────────────────────
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: {
        background:  '#0d1117',
        foreground:  '#e6edf3',
        cursor:      '#01a982',
        selectionBackground: 'rgba(1,169,130,0.3)',
        black:   '#1c2128', red:     '#ff7b72', green:   '#3fb950',
        yellow:  '#d29922', blue:    '#58a6ff', magenta: '#bc8cff',
        cyan:    '#39d0d8', white:   '#b1bac4',
        brightBlack:   '#6e7681', brightRed:   '#ffa198',
        brightGreen:   '#56d364', brightYellow:'#e3b341',
        brightBlue:    '#79c0ff', brightMagenta:'#d2a8ff',
        brightCyan:    '#56d8e4', brightWhite: '#f0f6fc',
      },
      scrollback: 5000,
      convertEol: true,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitAddon.current = fit

    term.writeln('\x1b[36m  ┌────────────────────────────────────────────┐\x1b[0m')
    term.writeln('\x1b[36m  │  HPE SAN Agent — Embedded Terminal         │\x1b[0m')
    term.writeln('\x1b[36m  │  Connecting to shell...                     │\x1b[0m')
    term.writeln('\x1b[36m  └────────────────────────────────────────────┘\x1b[0m')
    term.writeln('')

    // ── Resize observer ──────────────────────────────────────────────────
    const ro = new ResizeObserver(() => fit.fit())
    ro.observe(containerRef.current)

    // ── Keyboard input → backend ─────────────────────────────────────────
    term.onData((data) => {
      fetch(`${apiBase}/api/terminal/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      }).catch(() => {})
    })

    // ── SSE output stream from backend ───────────────────────────────────
    const connect = () => {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      const es = new EventSource(`${apiBase}/api/terminal/output`)
      esRef.current = es

      es.onmessage = (e) => {
        try {
          const { data: chunk } = JSON.parse(e.data)
          if (chunk) term.write(chunk)
        } catch {
          if (e.data) term.write(e.data)
        }
      }

      es.addEventListener('connected', () => {
        term.writeln('\x1b[32m  ✓ Shell connected. You can type here or let the SAN Agent run commands.\x1b[0m')
        term.writeln('')
      })

      es.onerror = () => {
        // Reconnect after 2s if SSE drops
        setTimeout(connect, 2000)
      }
    }

    if (active) connect()

    return () => {
      ro.disconnect()
      esRef.current?.close()
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase])

  // Reconnect SSE when active changes
  useEffect(() => {
    if (!termRef.current) return
    if (active && !esRef.current) {
      const es = new EventSource(`${apiBase}/api/terminal/output`)
      esRef.current = es
      es.onmessage = (e) => {
        try {
          const { data: chunk } = JSON.parse(e.data)
          if (chunk) termRef.current?.write(chunk)
        } catch {
          if (e.data) termRef.current?.write(e.data)
        }
      }
      es.onerror = () => setTimeout(() => {
        esRef.current?.close()
        esRef.current = null
      }, 1000)
    } else if (!active && esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
  }, [active, apiBase])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#0d1117',
        borderRadius: 8,
        overflow: 'hidden',
        padding: '4px 0',
      }}
    />
  )
})

export default EmbeddedTerminal
