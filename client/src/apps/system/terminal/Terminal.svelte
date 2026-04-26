<script>
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from 'xterm';
  import { FitAddon } from 'xterm-addon-fit';
  import 'xterm/css/xterm.css';
  import { createTerminalSessionClient } from '../nexus-term/services/terminalSessionClient.js';

  let terminalElement;
  let term;
  let fitAddon;
  let resizeHandler;
  let terminalSession;
  let initialized = $state(false);
  let sessionRequested = $state(false);
  let sessionStarting = $state(false);
  let sessionError = $state('');
  let sessionPreflight = $state(null);
  let typedConfirmation = $state('');

  function syncSessionState(nextState) {
    const previousPreflight = sessionPreflight;
    initialized = nextState.initialized;
    sessionRequested = nextState.sessionRequested;
    sessionStarting = nextState.sessionStarting;
    sessionError = nextState.sessionError;
    sessionPreflight = nextState.sessionPreflight;
    if (nextState.sessionPreflight !== previousPreflight) {
      typedConfirmation = '';
    }
  }

  function requestSessionPreflight() {
    typedConfirmation = '';
    terminalSession?.requestSessionPreflight();
  }

  function approveAndStartSession() {
    terminalSession?.approveAndStartSession(typedConfirmation);
  }

  function requestSession() {
    terminalSession?.requestSession();
  }

  function bindInputBridge() {
    term.onData((data) => {
      terminalSession?.sendInput(data);
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
      fontFamily: '"D2Coding", "Noto Sans Mono CJK KR", "Noto Sans Mono", Menlo, Monaco, "Courier New", monospace',
      scrollback: 5000
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalElement);
    fitAddon.fit();

    terminalSession = createTerminalSessionClient({
      getTerminalSize: () => ({
        cols: term?.cols || 80,
        rows: term?.rows || 24
      }),
      write: (data) => term?.write(data),
      writeln: (data) => term?.writeln(data),
      onStateChange: syncSessionState
    });

    bindInputBridge();

    resizeHandler = () => {
      if (!fitAddon || !term) return;
      fitAddon.fit();
      terminalSession?.resize({
        cols: term.cols,
        rows: term.rows
      });
    };
    globalThis.addEventListener('resize', resizeHandler);
  });

  onDestroy(() => {
    if (resizeHandler) {
      globalThis.removeEventListener('resize', resizeHandler);
    }
    terminalSession?.disconnect();
    if (term) term.dispose();
  });
</script>

<div class="terminal-shell">
  {#if !initialized}
    <div class="session-gate">
      <div class="session-panel">
        <h3>Start Terminal Session</h3>
        <p>Terminal opens a privileged local shell on this host. Commands run as the backend process user and can change real files, services, and system state.</p>
        {#if sessionPreflight}
          <div class="session-meta">
            <span>Action</span>
            <strong>{sessionPreflight.action}</strong>
          </div>
          <div class="session-meta">
            <span>Target</span>
            <strong>{sessionPreflight.target?.label || sessionPreflight.target?.id || 'Terminal session'}</strong>
          </div>
          <div class="session-meta stack">
            <span>Impact</span>
            <strong>{Array.isArray(sessionPreflight.impact) ? sessionPreflight.impact.join(' ') : sessionPreflight.impact}</strong>
          </div>
          <div class="session-meta stack">
            <span>Recoverability</span>
            <strong>Closing the session stops future input. Commands already run may not be reversible.</strong>
          </div>
          <label class="typed-confirmation">
            <span>Type <b>{sessionPreflight.approval?.typedConfirmation}</b> to approve</span>
            <input
              value={typedConfirmation}
              oninput={(event) => typedConfirmation = event.currentTarget.value}
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          <div class="session-actions">
            <button class="start-session-btn ghost" onclick={requestSessionPreflight} disabled={sessionStarting}>Refresh Preflight</button>
            <button
              class="start-session-btn"
              onclick={approveAndStartSession}
              disabled={sessionStarting || typedConfirmation !== sessionPreflight.approval?.typedConfirmation}
            >
              Approve And Start
            </button>
          </div>
        {:else}
          <div class="session-meta">
            <span>Impact</span>
            <strong>Raw admin shell access</strong>
          </div>
          <div class="session-meta">
            <span>Recoverability</span>
            <strong>Depends on the command you run</strong>
          </div>
          <button class="start-session-btn" onclick={requestSession} disabled={sessionStarting}>Start Shell</button>
        {/if}
        {#if sessionStarting}
          <div class="session-status">{sessionPreflight ? 'Approving terminal session...' : 'Requesting backend preflight...'}</div>
        {/if}
        {#if sessionError}
          <div class="session-error">{sessionError}</div>
        {/if}
      </div>
    </div>
  {/if}
  <div class="terminal-container" class:hidden={!initialized} bind:this={terminalElement}></div>
</div>

<style>
  .terminal-shell { position: relative; width: 100%; height: 100%; background: #161b22; }
  .terminal-container { width: 100%; height: 100%; background: #161b22; padding: 10px; }
  .terminal-container.hidden { visibility: hidden; }
  :global(.xterm) { height: 100%; }
  .session-gate {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: #161b22;
    color: #c9d1d9;
  }
  .session-panel {
    width: min(540px, 100%);
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.92);
    padding: 18px;
    display: grid;
    gap: 12px;
  }
  .session-panel h3 { margin: 0; font-size: 16px; color: #f8fafc; }
  .session-panel p { margin: 0; color: #cbd5e1; font-size: 13px; line-height: 1.5; }
  .session-meta {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 8px;
    padding: 8px;
    font-size: 12px;
  }
  .session-meta.stack {
    display: grid;
  }
  .session-meta span { color: #94a3b8; }
  .session-meta strong { color: #e2e8f0; text-align: right; }
  .session-meta.stack strong { text-align: left; line-height: 1.45; }
  .typed-confirmation {
    display: grid;
    gap: 6px;
    color: #cbd5e1;
    font-size: 12px;
  }
  .typed-confirmation input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid rgba(148, 163, 184, 0.32);
    border-radius: 8px;
    background: rgba(2, 6, 23, 0.72);
    color: #f8fafc;
    padding: 9px 10px;
  }
  .session-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }
  .session-status { color: #93c5fd; font-size: 13px; }
  .session-error { color: #fca5a5; font-size: 13px; line-height: 1.4; }
  .start-session-btn {
    justify-self: end;
    border: 1px solid rgba(88, 166, 255, 0.45);
    border-radius: 8px;
    background: rgba(88, 166, 255, 0.14);
    color: #bfdbfe;
    padding: 9px 12px;
    cursor: pointer;
  }
  .start-session-btn:hover { background: rgba(88, 166, 255, 0.22); }
  .start-session-btn:disabled { opacity: .55; cursor: not-allowed; }
  .start-session-btn.ghost {
    border-color: rgba(148, 163, 184, 0.34);
    background: rgba(15, 23, 42, 0.72);
    color: #dbeafe;
  }
</style>
