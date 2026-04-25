<script>
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from 'xterm';
  import { FitAddon } from 'xterm-addon-fit';
  import 'xterm/css/xterm.css';
  import { io } from 'socket.io-client';
  import { API_BASE } from '../../../utils/constants.js';

  const RISKY_COMMAND_RE = /\b(rm\s+-rf|mkfs|fdisk|dd\s+if=|shutdown|reboot|halt|init\s+0|systemctl\s+poweroff|systemctl\s+reboot|chmod\s+777\s+\/|:\(\)\s*\{)/i;

  let terminalElement;
  let term;
  let socket;
  let fitAddon;
  let resizeHandler;
  let commandBuffer = '';
  let initialized = false;

  function isRiskyCommand(command) {
    const trimmed = String(command || '').trim();
    if (!trimmed) return false;
    return RISKY_COMMAND_RE.test(trimmed);
  }

  function connectSocket() {
    const token = localStorage.getItem('web_os_token');
    socket = io(API_BASE, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 600
    });

    socket.on('connect', () => {
      term.writeln('\x1b[32mConnected to Web OS Terminal\x1b[0m');
      socket.emit('terminal:init', {
        cols: term.cols,
        rows: term.rows
      });
      initialized = true;
      commandBuffer = '';
    });

    socket.on('disconnect', (reason) => {
      term.writeln(`\r\n\x1b[33m[terminal] disconnected: ${reason}\x1b[0m`);
      initialized = false;
    });

    socket.on('connect_error', (error) => {
      term.writeln(`\r\n\x1b[31m[terminal] connection failed: ${error?.message || 'unknown error'}\x1b[0m`);
    });

    socket.on('terminal:output', (data) => {
      term.write(data);
    });

    socket.on('terminal:exit', ({ exitCode, signal }) => {
      term.writeln(`\r\n\x1b[33m[terminal] session ended (exit=${exitCode}, signal=${signal || '-'})\x1b[0m`);
      initialized = false;
    });
  }

  function bindInputBridge() {
    term.onData((data) => {
      if (!socket || !initialized) return;

      if (data === '\r') {
        const command = commandBuffer.trim();
        if (command && isRiskyCommand(command)) {
          const approved = globalThis.confirm(`Run risky command?\n\n${command}`);
          socket.emit('terminal:approval', {
            command,
            approved
          });
          if (!approved) {
            term.write('\r\n\x1b[33m[approval] command canceled by user\x1b[0m\r\n');
            socket.emit('terminal:input', '\u0003');
            commandBuffer = '';
            return;
          }
        }
        socket.emit('terminal:input', data);
        commandBuffer = '';
        return;
      }

      if (data === '\u007f') {
        if (commandBuffer.length > 0) {
          commandBuffer = commandBuffer.slice(0, -1);
        }
        socket.emit('terminal:input', data);
        return;
      }

      if (data === '\u0003') {
        commandBuffer = '';
        socket.emit('terminal:input', data);
        return;
      }

      if (data === '\u0015') {
        commandBuffer = '';
        socket.emit('terminal:input', data);
        return;
      }

      if (data.length === 1 && data >= ' ') {
        commandBuffer += data;
      }

      socket.emit('terminal:input', data);
    });
  }

  onMount(() => {
    term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#161b22',
        foreground: '#c9d1d9',
        cursor: '#58a6ff'
      },
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 5000
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalElement);
    fitAddon.fit();

    bindInputBridge();
    connectSocket();

    resizeHandler = () => {
      if (!fitAddon || !term) return;
      fitAddon.fit();
      if (socket && initialized) {
        socket.emit('terminal:resize', {
          cols: term.cols,
          rows: term.rows
        });
      }
    };
    globalThis.addEventListener('resize', resizeHandler);
  });

  onDestroy(() => {
    if (resizeHandler) {
      globalThis.removeEventListener('resize', resizeHandler);
    }
    if (socket) socket.disconnect();
    if (term) term.dispose();
  });
</script>

<div class="terminal-container" bind:this={terminalElement}></div>

<style>
  .terminal-container { width: 100%; height: 100%; background: #161b22; padding: 10px; }
  :global(.xterm) { height: 100%; }
</style>
