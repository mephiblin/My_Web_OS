const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const mediaService = require('../services/mediaService');

const THUMBNAIL_DIR = path.join(__dirname, '../storage/thumbnails');
if (!fs.existsSync(THUMBNAIL_DIR)) fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

// Get media metadata
router.get('/info', async (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });

  try {
    const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filePath);
    
    if (isImage) {
      const stats = fs.statSync(filePath);
      return res.json({
        filename: path.basename(filePath),
        size: stats.size,
        format: path.extname(filePath).slice(1),
        isImage: true
      });
    }

    const info = await mediaService.getMetadata(filePath);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get or generate thumbnail
router.get('/thumbnail', async (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });

  try {
    const thumbPath = await mediaService.generateThumbnail(filePath, THUMBNAIL_DIR);
    res.sendFile(thumbPath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Find matching subtitles
router.get('/subtitles', async (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });

  try {
    const dir = path.dirname(filePath);
    const fileName = path.basename(filePath, path.extname(filePath));
    const files = fs.readdirSync(dir);
    
    // Search for .vtt or .srt with same name
    const subFile = files.find(f => {
      const ext = path.extname(f).toLowerCase();
      return (ext === '.vtt' || ext === '.srt') && path.basename(f, ext) === fileName;
    });

    if (subFile) {
      res.json({ path: path.join(dir, subFile), name: subFile });
    } else {
      res.json({ path: null });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get neighboring files for navigation (previous/next)
router.get('/neighbors', async (req, res) => {
  const { path: filePath, type } = req.query; // type: 'image' or 'media'
  if (!filePath) return res.status(400).json({ error: 'Path is required' });

  try {
    const dir = path.dirname(filePath);
    const files = fs.readdirSync(dir);
    
    let filtered;
    if (type === 'image') {
      filtered = files.filter(f => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f));
    } else {
      filtered = files.filter(f => /\.(mp4|webm|mkv|mov|avi|mp3|wav|ogg|flac|m4a)$/i.test(f));
    }

    const currentIndex = filtered.indexOf(path.basename(filePath));
    res.json({
      total: filtered.length,
      current: currentIndex,
      prev: currentIndex > 0 ? path.join(dir, filtered[currentIndex - 1]) : null,
      next: currentIndex < filtered.length - 1 ? path.join(dir, filtered[currentIndex + 1]) : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
