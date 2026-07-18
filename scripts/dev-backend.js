const { spawn } = require('node:child_process')

const pythonPath = process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python'

const child = spawn(pythonPath, ['-m', 'uvicorn', 'app.main:app', '--reload'], {
  cwd: 'backend',
  stdio: 'inherit',
})

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(
      `Could not find ${pythonPath} in backend/. Have you created the venv and installed dependencies?\n` +
        'See README.md "Running locally" for the one-time setup steps.',
    )
  } else {
    console.error(`Failed to start backend: ${err.message}`)
  }
  process.exit(1)
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
