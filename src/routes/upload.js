import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';

export function createUploadRouter() {
  const router = Router();

  const storage = multer.memoryStorage();

  const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 }, // 500KB limit for Base64 efficiency
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only images are allowed'));
      }
    }
  });

  // POST /upload/avatar
  // Note: we don't strictly require authMiddleware here just to upload, 
  // but it's usually better. We will rely on the frontend passing the file.
  router.post('/avatar', upload.single('avatar'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ code: 'BAD_REQUEST', message: 'No file uploaded' });
      }

      // Convert image buffer to base64 so it can be stored directly in the database
      // This prevents image loss when the Render backend goes to sleep.
      const base64 = req.file.buffer.toString('base64');
      const publicUrl = `data:${req.file.mimetype};base64,${base64}`;
      return res.json({ url: publicUrl });
    } catch (err) {
      return res.status(500).json({ code: 'UPLOAD_ERROR', message: err.message });
    }
  });

  return router;
}
