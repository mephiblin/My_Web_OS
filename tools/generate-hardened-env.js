#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function randomSecret(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function parseOutputArg(args) {
  const explicit = args.find((arg) => arg.startsWith('--output='));
  if (explicit) {
    return explicit.slice('--output='.length).trim();
  }
  const idx = args.findIndex((arg) => arg === '--output');
  if (idx >= 0 && args[idx + 1]) {
    return String(args[idx + 1]).trim();
  }
  return '';
}

function buildEnvTemplate() {
  const jwtSecret = randomSecret(48);
  const adminPassword = randomSecret(18);
  const now = new Date().toISOString();

  return [
    '# Web OS hardened deployment environment template',
    `# generated_at=${now}`,
    '# Rotate credentials before real use and keep this file private.',
    'WEBOS_PUBLIC_ORIGIN=https://localhost:8443',
    'WEBOS_TLS_HOST=localhost',
    'WEBOS_HTTP_PORT=8080',
    'WEBOS_HTTPS_PORT=8443',
    'WEBOS_ACME_EMAIL=admin@example.com',
    '# WEBOS_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory',
    `JWT_SECRET=${jwtSecret}`,
    'ADMIN_USERNAME=admin',
    `ADMIN_PASSWORD=${adminPassword}`,
    'ALLOWED_ROOTS=["/workspace/data","/workspace/media"]',
    'INITIAL_PATH=/workspace/data',
    'INDEX_DEPTH=5',
    'RATE_LIMIT_WINDOW_MS=900000',
    'RATE_LIMIT_MAX=3000',
    'TRUST_PROXY_HOPS=1'
  ].join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  const outputTarget = parseOutputArg(args);
  const content = buildEnvTemplate();

  if (!outputTarget) {
    process.stdout.write(content);
    return;
  }

  const resolvedOutput = path.resolve(process.cwd(), outputTarget);
  fs.writeFileSync(resolvedOutput, content, 'utf8');
  process.stdout.write(`Wrote hardened env template to ${resolvedOutput}\n`);
}

main();
