export default function SanParametersPage() {
  return (
    <div style={{ width: '100%', height: 'calc(100vh - 80px)', overflow: 'hidden', padding: 0, margin: 0, borderRadius: 12 }}>
      <iframe 
        src="/analysis_report.html" 
        style={{ width: '100%', height: '100%', border: 'none', background: '#ffffff' }}
        title="SAN Parameters"
      />
    </div>
  )
}
