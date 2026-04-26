# First Addon Quickstart

Status: `[ACTIVE]`

Use this copy-ready path when an AI agent needs to create the smallest addon
that appears in the Web OS launcher.

## Create Files

```bash
mkdir -p server/storage/inventory/apps/hello-addon
```

Create `server/storage/inventory/apps/hello-addon/manifest.json`:

```json
{
  "id": "hello-addon",
  "title": "Hello Addon",
  "description": "Small sandbox addon used as a development smoke test.",
  "version": "1.0.0",
  "type": "app",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  },
  "permissions": [
    "ui.notification",
    "app.data.list",
    "app.data.read",
    "app.data.write"
  ]
}
```

Create `server/storage/inventory/apps/hello-addon/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hello Addon</title>
  <style>
    body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; background: #111827; color: #e5e7eb; }
    main { display: grid; gap: 12px; align-content: start; }
    button { width: fit-content; border: 1px solid #38bdf8; background: #075985; color: white; border-radius: 6px; padding: 8px 10px; }
    pre { white-space: pre-wrap; background: #020617; border: 1px solid #243244; border-radius: 6px; padding: 12px; }
    .error { color: #fecaca; }
  </style>
</head>
<body>
  <main>
    <h1>Hello Addon</h1>
    <button id="notifyButton" type="button">Send Notification</button>
    <button id="saveButton" type="button">Save App Data</button>
    <pre id="output">Starting...</pre>
    <div id="status">Waiting for WebOS context...</div>
  </main>

  <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
  <script>
    const statusEl = document.getElementById('status');
    const outputEl = document.getElementById('output');
    const notifyButton = document.getElementById('notifyButton');
    const saveButton = document.getElementById('saveButton');

    function setStatus(text, isError = false) {
      statusEl.textContent = text;
      statusEl.className = isError ? 'error' : '';
    }

    function show(value) {
      outputEl.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }

    async function main() {
      const context = await window.WebOS.ready();
      const app = context?.app || {};
      setStatus(`Ready: ${app.id || 'unknown app'}`);
      show({ appId: app.id, permissions: app.permissions || [], launchData: app.launchData || null });

      notifyButton.addEventListener('click', async () => {
        await window.WebOS.ui.notification({
          title: app.title || 'Hello Addon',
          message: 'Hello from sandbox addon.',
          type: 'success'
        });
      });

      saveButton.addEventListener('click', async () => {
        await window.WebOS.app.data.write({
          path: 'settings.json',
          content: JSON.stringify({ savedAt: new Date().toISOString() }, null, 2)
        });
        const files = await window.WebOS.app.data.list({ path: '' });
        const saved = await window.WebOS.app.data.read({ path: 'settings.json' });
        show({ files, saved });
      });
    }

    main().catch((err) => {
      setStatus(err?.message || 'Addon failed to start.', true);
      show({ code: err?.code || 'ADDON_START_FAILED', message: err?.message || String(err) });
    });
  </script>
</body>
</html>
```

## Verify

```bash
npm run package:doctor -- --manifest=server/storage/inventory/apps/hello-addon/manifest.json
git diff --check
```

Reload the browser after adding files directly to inventory. The backend reads
the inventory from disk, but the client app registry is cached after first
load.

## Next References

- `CORE_INTEGRATION_MAP.md` for File Station, launch data, iframe limits, and grants.
- `SDK_API_REFERENCE.md` for method response shapes and errors.
- `PACKAGE_LIFECYCLE_AND_DISTRIBUTION.md` for ZIP, registry, approval, backup, and rollback.
