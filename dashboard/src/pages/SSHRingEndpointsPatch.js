export const SSH_RING_ENDPOINTS_PATCH = {
  // These endpoints should exist in the backend when you want the PTY console to work.
  // The current project backend does not implement them (in api/app.py).
  // We are aligning the frontend to the working server: sshclient/temp_inventory_server.py.
  // temp_inventory_server.py provides:
  //   GET  /api/devices
  //   POST /api/credentials/save
  //   POST /api/credentials/delete
  //   POST /api/ssh/exec
  // It does NOT provide a true PTY interactive session.
  // So the best working approach is to implement an interactive-ish console
  // by running per-command exec (paramiko exec_command) or by adding PTY streaming.
};

