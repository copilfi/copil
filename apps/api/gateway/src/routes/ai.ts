import express from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { aiRateLimiter } from '../middleware/rateLimiter';

const router = express.Router();

router.use(aiRateLimiter);

router.post('/chat', asyncHandler(async (req: AuthenticatedRequest, res) => {
  res.json({
    success: true,
    data: {
      message: 'AI chat endpoint - to be implemented',
    },
  });
}));

export default router;