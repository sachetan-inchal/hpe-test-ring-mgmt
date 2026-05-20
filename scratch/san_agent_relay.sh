#!/usr/bin/env bash
# HPE SAN Agent - Desktop Relay Runner (bash/Linux/macOS)
# Run this script in your terminal BEFORE using Desktop Gateway mode.
# It watches for commands from the SAN Agent and executes them live in THIS terminal.
#
# Usage:   bash san_agent_relay.sh
# Stop:    Press Ctrl+C

WATCH_DIR="${TMPDIR:-/tmp}"
CMD_FILE="$WATCH_DIR/san_agent_cmd.txt"
OUT_FILE="$WATCH_DIR/san_agent_out.txt"

# Clean up stale files
rm -f "$CMD_FILE" "$OUT_FILE"

echo ""
echo "  ┌──────────────────────────────────────────────┐"
echo "  │  HPE SAN Agent - Desktop Relay Runner        │"
echo "  │  Listening for commands...  (Ctrl+C to stop) │"
echo "  └──────────────────────────────────────────────┘"
echo ""
echo "  Ready. Switch to the SAN Agent dashboard and ask a question."
echo ""

trap "echo '  Relay stopped.'; rm -f \"$CMD_FILE\" \"$OUT_FILE\"; exit 0" INT

while true; do
    if [ -f "$CMD_FILE" ]; then
        CMD=$(cat "$CMD_FILE")
        rm -f "$CMD_FILE"

        if [ -n "$CMD" ]; then
            echo ""
            echo "  [SAN Agent] > $CMD"
            # Execute, tee to screen AND capture output
            OUTPUT=$(eval "$CMD" 2>&1 | tee /dev/stderr)
            echo "$OUTPUT" > "$OUT_FILE"
            echo ""
        fi
    fi
    sleep 0.12
done
