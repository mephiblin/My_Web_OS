const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const pathGuard = require('../middleware/pathGuard');
const auth = require('../middleware/auth');
const auditService = require('../services/auditService');
const indexService = require('../services/indexService');
const trashService = require('../services/trashService');

// Auth required for ALL fs routes
router.use(auth);


/**
 * GET /api/fs/trash
 * List trash items
 */
router.get('/trash', async (req, res) => {
  try {
    const items = await trashService.getTrashItems();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * POST /api/fs/restore
 * Restore from trash
 */
router.post('/restore', async (req, res) => {
  const { id } = req.body;
  try {
    await trashService.restore(id);
    await auditService.log('FILE_TRANSFER', 'Restore from Trash', { id, user: req.user?.username }, 'INFO');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * DELETE /api/fs/empty-trash
 */
router.delete('/empty-trash', async (req, res) => {
  try {
    await trashService.emptyTrash();
    await auditService.log('SYSTEM', 'Empty Trash', { user: req.user?.username }, 'WARNING');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * Routes that do NOT require pathGuard (no user-supplied path)
 */

/**
 * GET /api/fs/config
 * Return public fs configuration like initial path
 */
router.get('/config', (req, res) => {
  res.json({
    initialPath: process.env.INITIAL_PATH || '/'
  });
});

/**
 * GET /api/fs/user-dirs
 * Auto-detect user directories (cross-platform)
 */
router.get('/user-dirs', (req, res) => {
  try {
    const { detectUserDirs } = require('../services/userDirs');
    const dirs = detectUserDirs();
    res.json(dirs);
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * Routes below require pathGuard (user-supplied path)
 */
router.use(pathGuard);

/**
 * GET /api/fs/list
 * List directory contents
 */
router.get('/list', async (req, res) => {
  try {
    const targetPath = req.safePath;
    const stats = await fs.stat(targetPath);

    if (!stats.isDirectory()) {
      return res.status(400).json({ error: true, message: 'Path is not a directory.' });
    }

    const files = await fs.readdir(targetPath);
    const details = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(targetPath, file);
        try {
          const fileStats = await fs.stat(filePath);
          return {
            name: file,
            path: filePath,
            isDirectory: fileStats.isDirectory(),
            size: fileStats.size,
            mtime: fileStats.mtime,
            birthtime: fileStats.birthtime,
          };
        } catch (err) {
          return { name: file, error: 'Could not retrieve stats' };
        }
      })
    );

    res.json({ path: targetPath, items: details });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/fs/search
 * Recursive directory file search
 */
async function searchDirectory(dir, query, limit, results = []) {
  if (results.length >= limit) return results;
  try {
    const files = await fs.readdir(dir, { withFileTypes: true });
    for (const file of files) {
      if (results.length >= limit) break;
      const fullPath = path.join(dir, file.name);
      
      if (file.name.toLowerCase().includes(query)) {
        try {
          const stats = await fs.stat(fullPath);
          results.push({
            name: file.name,
            path: fullPath,
            isDirectory: file.isDirectory(),
            size: stats.size,
            mtime: stats.mtime
          });
        } catch(e) {}
      }

      if (file.isDirectory() && !file.name.startsWith('.')) {
         await searchDirectory(fullPath, query, limit, results);
      }
    }
  } catch (err) {
    // Ignore permissions/access errors
  }
  return results;
}

router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    const targetPath = req.safePath;
    if (!q) {
      return res.json({ items: [], meta: null });
    }
    const query = q.toLowerCase();
    
    // 1. Try index search first
    let results = indexService.search(query, targetPath);
    let source = 'index';

    // 2. Fallback to recursive scan if index is empty or has very few results 
    // (This helps if indexing is still in progress or specifically excluded by index rules)
    if (results.length < 5) {
      const scanResults = await searchDirectory(targetPath, query, 200);
      // Merge results, avoiding duplicates by path
      const resultPaths = new Set(results.map(r => r.path));
      for (const item of scanResults) {
        if (!resultPaths.has(item.path)) {
          results.push(item);
        }
        if (results.length >= 200) break;
      }
      source = results.length > scanResults.length ? 'mixed' : 'scan';
    }

    res.json({
      items: results,
      meta: {
        query: q,
        source: source,
        total: results.length,
        path: targetPath
      }
    });

  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/fs/read
 * Read file content
 */
router.get('/read', async (req, res) => {
  try {
    const targetPath = req.safePath;
    const stats = await fs.stat(targetPath);

    if (stats.isDirectory()) {
      return res.status(400).json({ error: true, message: 'Cannot read a directory as a file.' });
    }

    const content = await fs.readFile(targetPath, 'utf8');
    res.json({ path: targetPath, content });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/fs/raw
 * Serve raw file for streaming/viewing
 */
router.get('/raw', async (req, res) => {
  try {
    const targetPath = req.safePath;
    const stats = await fs.stat(targetPath);

    if (stats.isDirectory()) {
      return res.status(400).json({ error: true, message: 'Cannot stream a directory.' });
    }

    console.log(`[FS] Sending raw file: ${targetPath}`);
    res.sendFile(targetPath, (err) => {
      if (err) {
        console.error(`[FS] Error sending file: ${err.message}`);
        if (!res.headersSent) {
          res.status(err.status || 500).end();
        }
      }
    });
  } catch (err) {
    console.error(`[FS] Error in /raw: ${err.message}`);
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * POST /api/fs/write
 * Create or update file content
 */
router.post('/write', async (req, res) => {
  try {
    const targetPath = req.safePath;
    const { content } = req.body;

    await fs.writeFile(targetPath, content || '', 'utf8');
    await auditService.log('FILE_TRANSFER', 'Write File', { path: targetPath, user: req.user?.username }, 'INFO');
    res.json({ success: true, message: 'File saved successfully.' });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * DELETE /api/fs/delete
 * Delete file or directory
 */
router.delete('/delete', async (req, res) => {
  try {
    const targetPath = req.safePath;
    await trashService.moveToTrash(targetPath);
    await auditService.log('FILE_TRANSFER', 'Move to Trash', { path: targetPath, user: req.user?.username }, 'INFO');
    res.json({ success: true, message: 'Item moved to trash.' });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * POST /api/fs/create-dir
 * Create a new directory
 */
router.post('/create-dir', async (req, res) => {
  try {
    const targetPath = req.safePath;
    await fs.ensureDir(targetPath);
    await auditService.log('FILE_TRANSFER', 'Create Directory', { path: targetPath, user: req.user?.username }, 'INFO');
    res.json({ success: true, message: 'Directory created successfully.' });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * PUT /api/fs/rename
 * Rename a file or directory
 */
router.put('/rename', async (req, res) => {
  try {
    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) {
      return res.status(400).json({ error: true, message: 'oldPath and newName are required.' });
    }
    // Security: Validate oldPath against ALLOWED_ROOTS (same logic as pathGuard)
    const resolvedOld = path.resolve(oldPath);
    const ALLOWED_ROOTS = JSON.parse(process.env.ALLOWED_ROOTS || '[]');
    const isAllowed = ALLOWED_ROOTS.some(root => resolvedOld.startsWith(path.resolve(root)));
    if (!isAllowed) {
      return res.status(403).json({ error: true, code: 'FS_PERMISSION_DENIED', message: 'Access to this path is restricted.' });
    }
    // Security: Prevent path traversal in newName
    if (newName.includes('/') || newName.includes('..')) {
      return res.status(400).json({ error: true, message: 'Invalid file name.' });
    }
    const newPath = path.join(path.dirname(resolvedOld), newName);
    await fs.rename(resolvedOld, newPath);
    await auditService.log('FILE_TRANSFER', 'Rename Item', { oldPath: resolvedOld, newPath, user: req.user?.username }, 'INFO');
    res.json({ success: true, message: 'Renamed successfully.' });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/fs/archive-list
 * List contents of a ZIP archive
 */
router.get('/archive-list', async (req, res) => {
  try {
    const AdmZip = require('adm-zip');
    const targetPath = req.safePath;
    
    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: true, message: 'Not an archive.' });
    }

    const zip = new AdmZip(targetPath);
    const zipEntries = zip.getEntries();
    
    const items = zipEntries.map(e => ({
      name: e.entryName,
      isDirectory: e.isDirectory,
      size: e.header.size
    }));
    
    res.json({ path: targetPath, items });
  } catch (err) {
    res.status(500).json({ error: true, message: 'Failed to read archive: ' + err.message });
  }
});

/**
 * POST /api/fs/extract
 * Extract a ZIP archive to a destination
 */
router.post('/extract', async (req, res) => {
  try {
    const AdmZip = require('adm-zip');
    const sourcePath = req.safePath;
    let { destPath } = req.body;
    
    if (!destPath) {
       destPath = path.dirname(sourcePath); 
    } else {
       const resolvedDest = path.resolve(destPath);
       const ALLOWED_ROOTS = JSON.parse(process.env.ALLOWED_ROOTS || '[]');
       const isAllowed = ALLOWED_ROOTS.some(root => resolvedDest.startsWith(path.resolve(root)));
       if (!isAllowed) {
         return res.status(403).json({ error: true, message: 'Restricted dest location.' });
       }
       destPath = resolvedDest;
    }

    const zip = new AdmZip(sourcePath);
    zip.extractAllToAsync(destPath, true, false, async (err) => {
       if (err) return res.status(500).json({ error: true, message: err.message });
       await auditService.log('FILE_TRANSFER', 'Extract Archive', { path: sourcePath, destPath, user: req.user?.username }, 'INFO');
       res.json({ success: true, message: 'Extracted successfully.' });
    });
  } catch (err) {
    res.status(500).json({ error: true, message: 'Failed to extract archive: ' + err.message });
  }
});

const multer = require('multer');
const upload = multer({ dest: path.join(__dirname, '../storage/tmp/') });

/**
 * POST /api/fs/upload-chunk
 * Handle multipart chunked file upload
 * Body should have: path (target directory valid for pathGuard), uploadId, chunkIndex, totalChunks, fileName
 */
router.post('/upload-chunk', upload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks, fileName } = req.body;
    const targetDir = req.safePath;
    
    if (!req.file || !uploadId || chunkIndex === undefined || !totalChunks || !fileName) {
      if (req.file) await fs.remove(req.file.path);
      return res.status(400).json({ error: true, message: 'Missing parameters.' });
    }

    const chunkDir = path.join(__dirname, '../storage/tmp', uploadId);
    await fs.ensureDir(chunkDir);
    
    // Move uploaded chunk to uploadId folder named by chunkIndex
    await fs.move(req.file.path, path.join(chunkDir, chunkIndex), { overwrite: true });

    // Merge if last chunk
    if (parseInt(chunkIndex) === parseInt(totalChunks) - 1) {
       const finalPath = path.join(targetDir, fileName);
       
       // Security: Prevent path traversal in fileName
       if (fileName.includes('/') || fileName.includes('..')) {
         await fs.remove(chunkDir);
         return res.status(400).json({ error: true, message: 'Invalid file name.' });
       }

       const outStream = fs.createWriteStream(finalPath);
       
       for (let i = 0; i < totalChunks; i++) {
         const cp = path.join(chunkDir, i.toString());
         const data = await fs.readFile(cp);
         outStream.write(data);
       }
       outStream.end();
       
       await new Promise((resolve, reject) => {
         outStream.on('finish', resolve);
         outStream.on('error', reject);
       });
       
       await fs.remove(chunkDir);
       await auditService.log('FILE_TRANSFER', 'Upload File', { path: finalPath, user: req.user?.username }, 'INFO');
       return res.json({ success: true, complete: true });
    }
    
    res.json({ success: true, complete: false });
  } catch (err) {
    if (req.file) await fs.remove(req.file.path);
    res.status(500).json({ error: true, message: err.message });
  }
});

module.exports = router;
