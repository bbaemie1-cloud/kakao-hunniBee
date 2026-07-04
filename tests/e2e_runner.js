const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const PORT = process.env.PORT || 3000;

function waitPort(port, host, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    function tryConnect() {
      const socket = new net.Socket();
      
      socket.connect(port, host, () => {
        socket.end();
        resolve();
      });
      
      socket.on('error', () => {
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(tryConnect, 150);
        }
      });
    }
    
    tryConnect();
  });
}

async function main() {
  console.log('Starting mock server as a child process...');
  const serverPath = path.join(__dirname, '../src/server.js');
  const server = spawn('node', [serverPath], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit'
  });

  server.on('error', (err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });

  // Handle sudden server exit before tests start/complete
  let serverExited = false;
  server.on('exit', (code) => {
    serverExited = true;
    console.log(`Server process exited with code ${code}`);
  });

  try {
    console.log(`Waiting for port ${PORT} to open...`);
    await waitPort(PORT, '127.0.0.1');
    console.log(`Port ${PORT} is open! Running tests...`);

    const testFiles = [
      path.join(__dirname, 'tier1_coverage.test.js'),
      path.join(__dirname, 'tier2_boundary.test.js'),
      path.join(__dirname, 'tier3_combination.test.js'),
      path.join(__dirname, 'tier4_workload.test.js')
    ];

    // Run the native test runner
    const runner = spawn('node', ['--test', ...testFiles], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'inherit'
    });

    runner.on('close', (code) => {
      console.log(`Tests finished with exit code ${code}`);
      if (!serverExited) {
        server.kill();
      }
      process.exit(code);
    });

    runner.on('error', (err) => {
      console.error('Error running tests:', err);
      if (!serverExited) {
        server.kill();
      }
      process.exit(1);
    });

  } catch (err) {
    console.error(err);
    if (!serverExited) {
      server.kill();
    }
    process.exit(1);
  }
}

main();
