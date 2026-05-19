import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'

/**
 * EmbeddedTerminal
 * Renders a full xterm.js terminal with unified, robust SSE connection management.
 */
const EmbeddedTerminal = forwardRef(function EmbeddedTerminal({ apiBase, active }, ref) {
  const containerRef = useRef(null)
  const termRef      = useRef(null)
  const fitAddon     = useRef(null)
  const esRef        = useRef(null)

  // Expose methods for parent
  useImperativeHandle(ref, () => ({
    write: (text) => {
      console.log('[EmbeddedTerminal] Writing text from parent:', text)
      termRef.current?.write(text)
    },
    clear: () => termRef.current?.clear(),
  }))

  useEffect(() => {
    if (!containerRef.current) return

    console.log('[EmbeddedTerminal] Initializing terminal component...')

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

    const safeFit = () => {
      if (containerRef.current && containerRef.current.clientWidth > 0 && containerRef.current.clientHeight > 0) {
        try {
          fit.fit()
        } catch (err) {
          console.warn('[EmbeddedTerminal] fit.fit() deferred:', err)
        }
      }
    }

    let opened = false
    const tryInitialize = () => {
      if (opened) return
      if (containerRef.current && containerRef.current.clientWidth > 20 && containerRef.current.clientHeight > 20) {
        console.log('[EmbeddedTerminal] Viewport has dimensions, opening xterm...')
        if (containerRef.current) {
          containerRef.current.innerHTML = ''
        }
        term.open(containerRef.current)
        safeFit()
        termRef.current = term
        fitAddon.current = fit
        opened = true

        term.writeln('\x1b[36m  ┌────────────────────────────────────────────┐\x1b[0m')
        term.writeln('\x1b[36m  │  HPE SAN Agent — Embedded Terminal         │\x1b[0m')
        term.writeln('\x1b[36m  │  Connecting to shell...                     │\x1b[0m')
        term.writeln('\x1b[36m  └────────────────────────────────────────────┘\x1b[0m')
        term.writeln('')

        if (active) startConnection()
      } else {
        // Try again shortly as layout grows
        setTimeout(tryInitialize, 50)
      }
    }

    // Connect SSE to Flask stream
    const startConnection = () => {
      if (esRef.current) {
        console.log('[EmbeddedTerminal] Closing previous connection...')
        esRef.current.close()
      }

      console.log('[EmbeddedTerminal] Opening EventSource connection to output stream...')
      const es = new EventSource(`${apiBase}/api/terminal/output`)
      esRef.current = es

      es.onopen = () => {
        console.log('[EmbeddedTerminal] EventSource opened successfully.')
        term.writeln('\x1b[32m  ✓ Shell stream connected. You can type here or let the SAN Agent execute.\x1b[0m')
        term.writeln('')
      }

      es.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data)
          if (payload && typeof payload.data === 'string') {
            term.write(payload.data)
          } else if (e.data) {
            term.write(e.data)
          }
        } catch {
          if (e.data) term.write(e.data)
        }
      }

      es.onerror = (err) => {
        console.warn('[EmbeddedTerminal] EventSource disconnected, retrying in 2s...', err)
        es.close()
        esRef.current = null
        setTimeout(startConnection, 2000)
      }
    }

    let initTimeout = setTimeout(tryInitialize, 150)

    const ro = new ResizeObserver(() => safeFit())
    ro.observe(containerRef.current)

    // Send local keystrokes to Flask endpoint
    const dataHandler = term.onData((data) => {
      console.log('[EmbeddedTerminal] Keystroke sent:', JSON.stringify(data))
      fetch(`${apiBase}/api/terminal/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      }).catch((err) => {
        console.error('[EmbeddedTerminal] Keystroke post error:', err)
      })
    })

    return () => {
      console.log('[EmbeddedTerminal] Cleaning up component...')
      clearTimeout(initTimeout)
      dataHandler.dispose()
      ro.disconnect()
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, active])

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
