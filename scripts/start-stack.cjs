#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

function spawnDevProcess(label, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`\n[${label}] exited with code ${code}`);
      process.exit(code ?? 1);
    }
  });

  child.on('error', (error) => {
    console.error(`\n[${label}] failed:`, error);
    process.exit(1);
  });

  return child;
}

async function ensureDockerServices() {
  console.log('\n🔧 Starting local infrastructure (Docker compose)...');
  await runCommand('npm', ['run', 'docker:dev'], { cwd: rootDir });
  console.log('✅ Docker services are up');
}

async function startDevProcesses() {
  console.log('\n🚀 Launching development services...');

  const processes = [
    {
      label: 'api',
      command: 'npm',
      args: ['run', 'dev', '--workspace=@copil/api'],
      options: { cwd: rootDir },
    },
    {
      label: 'frontend',
      command: 'npm',
      args: ['run', 'dev'],
      options: { cwd: frontendDir },
    },
  ];

  const running = processes.map((proc) =>
    spawnDevProcess(proc.label, proc.command, proc.args, proc.options)
  );

  const shutdown = () => {
    console.log('\n🛑 Shutting down stack...');
    for (const child of running) {
      if (!child.killed) {
        child.kill('SIGINT');
      }
    }
  };

  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });

  console.log('\n✅ Stack running. API: http://localhost:8888  Frontend: http://localhost:5173');
  console.log('Press Ctrl+C to stop.');
}

(async () => {
  try {
    await ensureDockerServices();
    await startDevProcesses();
  } catch (error) {
    console.error('\n❌ Failed to start development stack:', error.message || error);
    process.exit(1);
  }
})();
