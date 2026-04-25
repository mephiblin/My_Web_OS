const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const mediaService = require('../services/mediaService');

test('parsePdfPageCountFromText counts page entries and ignores /Pages', () => {
  const sample = [
    '%PDF-1.7',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R >> endobj',
    '4 0 obj << /Type /Page /Parent 2 0 R >> endobj'
  ].join('\n');

  const count = mediaService.__internal.parsePdfPageCountFromText(sample);
  assert.equal(count, 2);
});

test('getStationMetadata returns page count for pdf file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-media-service-'));
  const pdfPath = path.join(dir, 'sample.pdf');

  try {
    await fs.writeFile(
      pdfPath,
      [
        '%PDF-1.4',
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '3 0 obj << /Type /Page /Parent 2 0 R >> endobj',
        '4 0 obj << /Type /Page /Parent 2 0 R >> endobj'
      ].join('\n'),
      'utf8'
    );

    const metadata = await mediaService.getStationMetadata(pdfPath);
    assert.equal(metadata.kind, 'document');
    assert.equal(metadata.pages, 2);
    assert.equal(metadata.durationSeconds, null);
    assert.equal(metadata.resolution, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('getStationMetadata throws path-not-found code for missing files', async () => {
  await assert.rejects(
    () => mediaService.getStationMetadata('/tmp/webos-media-service-missing-file.pdf'),
    (err) => err && err.code === 'MEDIA_STATION_PATH_NOT_FOUND'
  );
});
