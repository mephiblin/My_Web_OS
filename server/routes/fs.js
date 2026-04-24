const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const multer = require('multer');
const path = require('path');
const pathGuard = require('../middleware/pathGuard');
const auth = require('../middleware/auth');
const auditService = require('../services/auditService');
const indexService = require('../services/indexService');
const trashService = require('../services/trashService');
const fileGrantService = require('../services/fileGrantService');
const serverConfig = require('../config/serverConfig');
const { resolveSafePath, isWithinAllowedRoots, isSafeLeafName } = require('../utils/pathPolicy');

// Auth required for ALL fs routes
router.use(auth);

function createFsHttpError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function mapFsError(err, fallbackCode = 'FS_OPERATION_FAILED', fallbackMessage = 'File operation failed.') {
  if (err?.status && err?.code) {
    return {
      status: err.status,
      code: err.code,
      message: err.message || fallbackMessage,
      details: err.details || null,
    };
  }

  switch (err?.code) {
    case 'ENOENT':
      return { status: 404, code: 'FS_PATH_NOT_FOUND', message: 'The requested path was not found.', details: null };
    case 'EACCES':
    case 'EPERM':
      return { status: 403, code: 'FS_ACCESS_DENIED', message: 'Permission denied for this file operation.', details: null };
    case 'EEXIST':
      return { status: 409, code: 'FS_CONFLICT', message: 'A file or directory with the same name already exists.', details: null };
    case 'ENOTDIR':
      return { status: 400, code: 'FS_NOT_DIRECTORY', message: 'Path is not a directory.', details: null };
    case 'EISDIR':
      return { status: 400, code: 'FS_NOT_FILE', message: 'Path is not a file.', details: null };
    default:
      return {
        status: err?.status || 500,
        code: err?.code || fallbackCode,
        message: err?.message || fallbackMessage,
        details: err?.details || null,
      };
  }
}

function sendFsError(res, err, fallbackCode, fallbackMessage) {
  const mapped = mapFsError(err, fallbackCode, fallbackMessage);
  return res.status(mapped.status).json({
    error: true,
    code: mapped.code,
    message: mapped.message,
    details: mapped.details,
  });
}

function requireSafePath(req) {
  if (!req.safePath) {
    throw createFsHttpError(400, 'FS_INVALID_PATH', 'A valid path is required.');
  }
  return req.safePath;
}

function consumeFileGrant(grantId, options = {}) {
  try {
    return fileGrantService.consumeGrant(grantId, options);
  } catch (err) {
    if (String(err.code || '').startsWith('FS_FILE_GRANT_')) {
      throw createFsHttpError(
        err.code === 'FS_FILE_GRANT_REQUIRED' ? 400 : 403,
        err.code,
        err.message
      );
    }
    throw err;
  }
}


/**
 * GET /api/fs/trash
 * List trash items
 */
router.get('/trash', async (req, res) => {
  try {
    const items = await trashService.getTrashItems();
    res.json(items);
  } catch (err) {
    sendFsError(res, err, 'FS_TRASH_LIST_FAILED', 'Failed to list trash items.');
  }
});

/**
 * POST /api/fs/restore
 * Restore from trash
 */
router.post('/restore', async (req, res) => {
  const { id } = req.body;
  try {
    if (!id || typeof id !== 'string') {
      throw createFsHttpError(400, 'FS_TRASH_RESTORE_ID_REQUIRED', 'A valid trash item id is required.');
    }
    await trashService.restore(id);
    await auditService.log('FILE_TRANSFER', 'Restore from Trash', { id, user: req.user?.username }, 'INFO');
    res.json({ success: true });
  } catch (err) {
    sendFsError(res, err, 'FS_TRASH_RESTORE_FAILED', 'Failed to restore trash item.');
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
    sendFsError(res, err, 'FS_TRASH_EMPTY_FAILED', 'Failed to empty trash.');
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
  serverConfig.getPaths()
    .then((paths) => {
      res.json({
        initialPath: paths.initialPath || '/',
        allowedRoots: Array.isArray(paths.allowedRoots) ? paths.allowedRoots : [],
        inventoryRoot: paths.inventoryRoot || ''
      });
    })
    .catch((err) => {
      sendFsError(res, err, 'FS_CONFIG_FETCH_FAILED', 'Failed to read file system config.');
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
    sendFsError(res, err, 'FS_USER_DIRS_FETCH_FAILED', 'Failed to detect user directories.');
  }
});

/**
 * Routes below require pathGuard (user-supplied path)
 */
router.use(pathGuard);

router.post('/grant', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    const { mode, appId, source } = req.body && typeof req.body === 'object' ? req.body : {};
    const stats = await fs.stat(targetPath);
    if (!stats.isFile()) {
      throw createFsHttpError(400, 'FS_FILE_GRANT_NOT_FILE', 'File grants can only be issued for files.');
    }

    const grant = fileGrantService.createGrant({
      path: targetPath,
      mode,
      appId,
      source,
      user: req.user?.username
    });

    await auditService.log(
      'FILE_TRANSFER',
      'Issue File Grant',
      {
        path: targetPath,
        mode: grant.mode,
        appId: grant.appId,
        source: grant.source,
        grantId: grant.id,
        user: req.user?.username
      },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      grant: {
        id: grant.id,
        appId: grant.appId,
        source: grant.source,
        scope: grant.scope,
        mode: grant.mode,
        path: grant.path,
        createdAt: new Date(grant.createdAt).toISOString(),
        expiresAt: new Date(grant.expiresAt).toISOString(),
        expiresOnWindowClose: grant.expiresOnWindowClose
      }
    });
  } catch (err) {
    sendFsError(res, err, 'FS_FILE_GRANT_FAILED', 'Failed to create file grant.');
  }
});

/**
 * GET /api/fs/list
 * List directory contents
 */
router.get('/list', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    const stats = await fs.stat(targetPath);

    if (!stats.isDirectory()) {
      throw createFsHttpError(400, 'FS_NOT_DIRECTORY', 'Path is not a directory.');
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
    sendFsError(res, err, 'FS_LIST_FAILED', 'Failed to list directory.');
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
    const targetPath = requireSafePath(req);
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
    sendFsError(res, err, 'FS_SEARCH_FAILED', 'Failed to search files.');
  }
});

/**
 * GET /api/fs/read
 * Read file content
 */
router.get('/read', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    const grantId = String(req.query?.grantId || '').trim();
    const appId = String(req.query?.appId || '').trim();
    if (grantId) {
      consumeFileGrant(grantId, {
        path: targetPath,
        requiredMode: 'read',
        appId,
        user: req.user?.username
      });
    }
    const stats = await fs.stat(targetPath);

    if (stats.isDirectory()) {
      throw createFsHttpError(400, 'FS_NOT_FILE', 'Cannot read a directory as a file.');
    }

    const content = await fs.readFile(targetPath, 'utf8');
    res.json({ path: targetPath, content });
  } catch (err) {
    sendFsError(res, err, 'FS_READ_FAILED', 'Failed to read file.');
  }
});

/**
 * GET /api/fs/raw
 * Serve raw file for streaming/viewing
 */
router.get('/raw', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    const stats = await fs.stat(targetPath);

    if (stats.isDirectory()) {
      throw createFsHttpError(400, 'FS_NOT_FILE', 'Cannot stream a directory.');
    }

    console.log(`[FS] Sending raw file: ${targetPath}`);
    res.sendFile(targetPath, (err) => {
      if (err) {
        console.error(`[FS] Error sending file: ${err.message}`);
        if (!res.headersSent) {
          sendFsError(res, err, 'FS_RAW_STREAM_FAILED', 'Failed to stream file.');
        }
      }
    });
  } catch (err) {
    console.error(`[FS] Error in /raw: ${err.message}`);
    sendFsError(res, err, 'FS_RAW_FETCH_FAILED', 'Failed to fetch file stream.');
  }
});

/**
 * POST /api/fs/write
 * Create or update file content
 */
router.post('/write', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { content } = body;
    const grantId = String(body.grantId || '').trim();
    const appId = String(body.appId || '').trim();
    const operationSource = String(body.operationSource || '').trim().toLowerCase();
    const overwrite = body.overwrite === true;
    const approval = body.approval && typeof body.approval === 'object' ? body.approval : {};
    const approvalReceived = approval.approved === true;

    if (typeof content !== 'string' && content !== undefined && content !== null) {
      throw createFsHttpError(400, 'FS_WRITE_CONTENT_INVALID', 'File content must be a string.');
    }

    if (operationSource === 'addon') {
      consumeFileGrant(grantId, {
        path: targetPath,
        requiredMode: 'readwrite',
        appId,
        user: req.user?.username
      });
    }

    const exists = await fs.pathExists(targetPath);
    if (operationSource === 'addon' && exists && !overwrite) {
      throw createFsHttpError(
        409,
        'FS_WRITE_OVERWRITE_APPROVAL_REQUIRED',
        'Overwrite requires explicit approval for addon file writes.',
        {
          path: targetPath,
          requiresApproval: true
        }
      );
    }
    if (operationSource === 'addon' && exists && overwrite && !approvalReceived) {
      throw createFsHttpError(
        400,
        'FS_WRITE_APPROVAL_REQUIRED',
        'Addon overwrite approval is required.',
        {
          path: targetPath,
          requiresApproval: true
        }
      );
    }

    await fs.writeFile(targetPath, content || '', 'utf8');
    await auditService.log(
      'FILE_TRANSFER',
      'Write File',
      {
        path: targetPath,
        appId: appId || null,
        operationSource: operationSource || 'direct',
        grantId: grantId || null,
        overwrite,
        approvalReceived,
        user: req.user?.username
      },
      'INFO'
    );
    res.json({ success: true, message: 'File saved successfully.' });
  } catch (err) {
    sendFsError(res, err, 'FS_WRITE_FAILED', 'Failed to save file.');
  }
});

/**
 * DELETE /api/fs/delete
 * Delete file or directory
 */
router.delete('/delete', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    await trashService.moveToTrash(targetPath);
    await auditService.log('FILE_TRANSFER', 'Move to Trash', { path: targetPath, user: req.user?.username }, 'INFO');
    res.json({ success: true, message: 'Item moved to trash.' });
  } catch (err) {
    sendFsError(res, err, 'FS_DELETE_FAILED', 'Failed to move item to trash.');
  }
});

/**
 * POST /api/fs/create-dir
 * Create a new directory
 */
router.post('/create-dir', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);

    if (await fs.pathExists(targetPath)) {
      throw createFsHttpError(409, 'FS_CONFLICT', 'A file or directory already exists at this location.');
    }

    await fs.ensureDir(targetPath);
    await auditService.log('FILE_TRANSFER', 'Create Directory', { path: targetPath, user: req.user?.username }, 'INFO');
    res.json({ success: true, message: 'Directory created successfully.' });
  } catch (err) {
    sendFsError(res, err, 'FS_CREATE_DIR_FAILED', 'Failed to create directory.');
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
      throw createFsHttpError(400, 'FS_RENAME_PARAMS_INVALID', 'oldPath and newName are required.');
    }

    const resolvedOld = resolveSafePath(oldPath);
    const { allowedRoots } = await serverConfig.getPaths();
    const isAllowed = isWithinAllowedRoots(resolvedOld, allowedRoots);
    if (!isAllowed) {
      throw createFsHttpError(403, 'FS_PERMISSION_DENIED', 'Access to this path is restricted.');
    }

    if (!isSafeLeafName(newName)) {
      throw createFsHttpError(400, 'FS_INVALID_NAME', 'Invalid file name.');
    }

    const newPath = path.join(path.dirname(resolvedOld), newName);
    if (await fs.pathExists(newPath)) {
      throw createFsHttpError(409, 'FS_CONFLICT', 'A file or directory with the target name already exists.');
    }
    await fs.rename(resolvedOld, newPath);
    await auditService.log('FILE_TRANSFER', 'Rename Item', { oldPath: resolvedOld, newPath, user: req.user?.username }, 'INFO');
    res.json({ success: true, message: 'Renamed successfully.' });
  } catch (err) {
    sendFsError(res, err, 'FS_RENAME_FAILED', 'Failed to rename item.');
  }
});

/**
 * GET /api/fs/archive-list
 * List contents of a ZIP archive
 */
router.get('/archive-list', async (req, res) => {
  try {
    const AdmZip = require('adm-zip');
    const targetPath = requireSafePath(req);
    
    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
      throw createFsHttpError(400, 'FS_ARCHIVE_INVALID', 'Not an archive file.');
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
    sendFsError(res, err, 'FS_ARCHIVE_READ_FAILED', 'Failed to read archive.');
  }
});

/**
 * POST /api/fs/extract
 * Extract a ZIP archive to a destination
 */
router.post('/extract', async (req, res) => {
  try {
    const AdmZip = require('adm-zip');
    const sourcePath = requireSafePath(req);
    let { destPath } = req.body;
    
    if (!destPath) {
       destPath = path.dirname(sourcePath); 
    } else {
       const resolvedDest = resolveSafePath(destPath);
       const { allowedRoots } = await serverConfig.getPaths();
       const isAllowed = isWithinAllowedRoots(resolvedDest, allowedRoots);
       if (!isAllowed) {
         throw createFsHttpError(403, 'FS_RESTRICTED_DESTINATION', 'Destination path is restricted.');
       }
       destPath = resolvedDest;
    }

    const zip = new AdmZip(sourcePath);
    zip.extractAllToAsync(destPath, true, false, async (err) => {
       if (err) {
         return sendFsError(res, err, 'FS_ARCHIVE_EXTRACT_FAILED', 'Failed to extract archive.');
       }
       await auditService.log('FILE_TRANSFER', 'Extract Archive', { path: sourcePath, destPath, user: req.user?.username }, 'INFO');
       res.json({ success: true, message: 'Extracted successfully.' });
    });
  } catch (err) {
    sendFsError(res, err, 'FS_ARCHIVE_EXTRACT_FAILED', 'Failed to extract archive.');
  }
});

const upload = multer({ dest: path.join(__dirname, '../storage/tmp/') });

/**
 * POST /api/fs/upload-chunk
 * Handle multipart chunked file upload
 * Body should have: path (target directory valid for pathGuard), uploadId, chunkIndex, totalChunks, fileName
 */
router.post('/upload-chunk', upload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks, fileName } = req.body;
    const targetDir = requireSafePath(req);
    
    if (!req.file || !uploadId || chunkIndex === undefined || !totalChunks || !fileName) {
      if (req.file) await fs.remove(req.file.path);
      throw createFsHttpError(400, 'FS_UPLOAD_PARAMS_INVALID', 'Missing upload parameters.');
    }

    if (!isSafeLeafName(fileName)) {
      if (req.file) await fs.remove(req.file.path);
      throw createFsHttpError(400, 'FS_INVALID_NAME', 'Invalid file name.');
    }

    const parsedChunkIndex = Number(chunkIndex);
    const parsedTotalChunks = Number(totalChunks);
    if (!Number.isInteger(parsedChunkIndex) || !Number.isInteger(parsedTotalChunks) || parsedChunkIndex < 0 || parsedTotalChunks < 1 || parsedChunkIndex >= parsedTotalChunks) {
      if (req.file) await fs.remove(req.file.path);
      throw createFsHttpError(400, 'FS_UPLOAD_PARAMS_INVALID', 'Invalid chunk metadata.');
    }

    const chunkDir = path.join(__dirname, '../storage/tmp', uploadId);
    await fs.ensureDir(chunkDir);
    
    // Move uploaded chunk to uploadId folder named by chunkIndex
    await fs.move(req.file.path, path.join(chunkDir, chunkIndex), { overwrite: true });

    // Merge if last chunk
    if (parsedChunkIndex === parsedTotalChunks - 1) {
       const finalPath = path.join(targetDir, fileName);

       if (await fs.pathExists(finalPath)) {
         await fs.remove(chunkDir);
         throw createFsHttpError(409, 'FS_CONFLICT', 'A file with the same name already exists.');
       }

       const outStream = fs.createWriteStream(finalPath);
       
       for (let i = 0; i < parsedTotalChunks; i++) {
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
    sendFsError(res, err, 'FS_UPLOAD_FAILED', 'File upload failed.');
  }
});

module.exports = router;
