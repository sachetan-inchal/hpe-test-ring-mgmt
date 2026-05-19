# HPE SAN Agent - Desktop Relay Runner (PowerShell)
# Run this script in your PowerShell/Windows Terminal BEFORE using Desktop Gateway mode.
# It watches for commands from the SAN Agent and executes them live in THIS terminal.
#
# Usage:   .\san_agent_relay.ps1
# Stop:    Press Ctrl+C

$watchDir = $env:TEMP
$cmdFile  = Join-Path $watchDir "san_agent_cmd.txt"
$outFile  = Join-Path $watchDir "san_agent_out.txt"
$ackFile  = Join-Path $watchDir "san_agent_ack.txt"

# Clean up any stale files from a previous session
Remove-Item -ErrorAction SilentlyContinue $cmdFile, $outFile, $ackFile

Write-Host ""
Write-Host "  ┌──────────────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "  │  HPE SAN Agent - Desktop Relay Runner        │" -ForegroundColor Cyan
Write-Host "  │  Listening for commands...  (Ctrl+C to stop) │" -ForegroundColor Cyan
Write-Host "  └──────────────────────────────────────────────┘" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Ready. Switch to the SAN Agent dashboard and ask a question." -ForegroundColor Green
Write-Host ""

while ($true) {
    if (Test-Path $cmdFile) {
        $cmd = (Get-Content $cmdFile -Raw).Trim()
        Remove-Item $cmdFile -ErrorAction SilentlyContinue

        if ($cmd -ne "") {
            Write-Host ""
            Write-Host "  [SAN Agent] > $cmd" -ForegroundColor Yellow

            # Execute command and tee output to both terminal AND result file
            $output = ""
            try {
                $output = Invoke-Expression $cmd 2>&1 | Tee-Object -Variable teeOut | Out-String
                $output = $output.Trim()
            } catch {
                $output = "ERROR: $_"
                Write-Host $output -ForegroundColor Red
            }

            # Write output to result file for the agent to pick up
            [System.IO.File]::WriteAllText($outFile, $output, [System.Text.Encoding]::UTF8)

            Write-Host ""
        }
    }
    Start-Sleep -Milliseconds 120
}
