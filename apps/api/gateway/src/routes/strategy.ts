import express from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = express.Router();

router.get('/', asyncHandler(async (req: AuthenticatedRequest, res) => {
  res.json({
    success: true,
    data: {
      message: 'Strategy list endpoint - to be implemented',
    },
  });
}));

router.post('/', asyncHandler(async (req: AuthenticatedRequest, res) => {
  res.json({
    success: true,
    data: {
      message: 'Strategy create endpoint - to be implemented',
    },
  });
}));

export default router;