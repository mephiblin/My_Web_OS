# First Addon Quickstart

Status: `[ACTIVE]`

This is the smallest sandbox UI addon path.

## Package layout

```text
hello-addon/
  manifest.json
  index.html
```

## manifest.json

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

## index.html

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hello Addon</title>
  <style>
    body { margin: 0; padding: 16px; background: #0f172a; color: #e5e7eb; font-family: system-ui, sans-serif; }
    main { display: grid; gap: 12px; }
    button { width: fit-content; border: 1px solid #38bdf8; background: #075985; color: white; border-radius: 6px; padding: 8px 10px; }
    pre { white-space: pre-wrap; background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Hello Addon</h1>
    <button id="notify" type="button">Notify</button>
    <button id="save" type="button">Save App Data</button>
    <pre id="out">Starting...</pre>
  </main>
  <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
  <script>
    const out = document.getElementById('out');
    const show = (value) => { out.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };

    async function main() {
      const context = await window.WebOS.ready();
      show(context);
      document.getElementById('notify').onclick = () => window.WebOS.ui.notification('Hello from addon');
      document.getElementById('save').onclick = async () => {
        await window.WebOS.app.data.write({ path: 'hello.json', content: JSON.stringify({ savedAt: new Date().toISOString() }) });
        show(await window.WebOS.app.data.read({ path: 'hello.json' }));
      };
    }

    main().catch((err) => show({ code: err.code || 'ERROR', message: err.message || String(err) }));
  </script>
</body>
</html>
```

## Install

Zip the package root so `manifest.json` is at the root of the archive, then import it through Package Center.

## Next

- Read `SDK_API_REFERENCE.md` for platform APIs.
- Read `MANIFEST_PERMISSIONS_AND_EXTENSION_POINTS.md` for permissions and hybrid packages.
- Read `QUICKSTART_HYBRID_TOOL_KO.md` for local service tools.
