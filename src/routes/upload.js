import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';

export function createUploadRouter() {
  const router = Router();

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/avatars');
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = crypto.randomBytes(8).toString('hex');
      const ext = path.extname(file.originalname);
      cb(null, `avatar_${uniqueSuffix}${ext}`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
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

      // Return the public URL path dynamically based on the request host
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.get('host');
      const publicUrl = `${protocol}://${host}/uploads/avatars/${req.file.filename}`;
      return res.json({ url: publicUrl });
    } catch (err) {
      return res.status(500).json({ code: 'UPLOAD_ERROR', message: err.message });
    }
  });

  return router;
}
