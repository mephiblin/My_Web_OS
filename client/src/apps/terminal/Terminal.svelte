<script>
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from 'xterm';
  import { FitAddon } from 'xterm-addon-fit';
  import 'xterm/css/xterm.css';
  import { io } from 'socket.io-client';
  import { API_BASE } from '../../utils/constants.js';

  let terminalElement;
  let term;
  let socket;
  let fitAddon;

  onMount(() => {
    const token = localStorage.getItem('web_os_token');
    socket = io(API_BASE, {
      auth: { token }
    });

    term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#161b22',
        foreground: '#c9d1d9',
        cursor: '#58a6ff'
      },
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace'
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalElement);
    fitAddon.fit();

    socket.on('connect', () => {
      term.writeln('\x1b[32mConnected to Web OS Terminal\x1b[0m');
      socket.emit('terminal:init', {
        cols: term.cols,
        rows: term.rows
      });
    });

    socket.on('terminal:output', (data) => {
      term.write(data);
    });

    term.onData((data) => {
      socket.emit('terminal:input', data);
    });

    globalThis.addEventListener('resize', () => fitAddon.fit());
  });

  onDestroy(() => {
    if (socket) socket.disconnect();
    if (term) term.dispose();
  });
</script>

<div class="terminal-container" bind:this={terminalElement}></div>

<style>
  .terminal-container { width: 100%; height: 100%; background: #161b22; padding: 10px; }
  :global(.xterm) { height: 100%; }
</style>
