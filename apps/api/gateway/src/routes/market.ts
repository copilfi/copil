import express from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { optionalAuthMiddleware } from '../middleware/auth';

const router = express.Router();

router.use(optionalAuthMiddleware);

router.get('/prices', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      message: 'Market prices endpoint - to be implemented',
    },
  });
}));

export default router;