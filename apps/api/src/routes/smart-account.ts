import { Router } from 'express';
import Joi from 'joi';
import { SmartAccountController } from '@/controllers/SmartAccountController';
import { authenticateToken } from '@/middleware/auth';
import { validateBody, validateQuery } from '@/middleware/validation';
import { commonSchemas } from '@/middleware/validation';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Validation schemas
const deployAccountSchema = Joi.object({
  // No parameters needed for deployment preparation
});

const executeTransactionSchema = Joi.object({
  to: commonSchemas.address,
  value: commonSchemas.amount.optional(),
  data: Joi.string().pattern(/^0x[0-9a-fA-F]*$/).optional(),
  privateKey: commonSchemas.privateKey
});

const executeBatchSchema = Joi.object({
  transactions: Joi.array().items(
    Joi.object({
      to: commonSchemas.address,
      value: commonSchemas.amount.optional(),
      data: Joi.string().pattern(/^0x[0-9a-fA-F]*$/).optional()
    })
  ).min(1).max(10).required(),
  privateKey: commonSchemas.privateKey
});

const createSessionKeySchema = Joi.object({
  sessionKey: commonSchemas.address,
  validUntil: Joi.number().integer().min(Math.floor(Date.now() / 1000)).required(),
  limitAmount: commonSchemas.amount,
  allowedTargets: Joi.array().items(commonSchemas.address).optional(),
  allowedFunctions: Joi.array().items(
    Joi.string().pattern(/^0x[0-9a-fA-F]{8}$/)
  ).optional(),
  description: Joi.string().max(255).optional()
  // privateKey removed - platform sponsors session key creation
});

const revokeSessionKeySchema = Joi.object({
  sessionKey: commonSchemas.address,
  privateKey: commonSchemas.privateKey
});

const listSessionKeysSchema = Joi.object({
  page: commonSchemas.pagination.page,
  limit: commonSchemas.pagination.limit,
  includeInactive: Joi.boolean().default(false)
});

const confirmDeploymentSchema = Joi.object({
  transactionHash: Joi.string().pattern(/^0x[0-9a-fA-F]{64}$/).required(),
  contractAddress: commonSchemas.address
});

// Routes
router.post('/deploy', validateBody(deployAccountSchema), SmartAccountController.deployAccount);
router.post('/deploy/prepare', validateBody(deployAccountSchema), SmartAccountController.prepareDeployment);
router.post('/deploy/confirm', validateBody(confirmDeploymentSchema), SmartAccountController.confirmDeployment);
router.get('/info', SmartAccountController.getAccountInfo);

router.post('/execute', validateBody(executeTransactionSchema), SmartAccountController.executeTransaction);
router.post('/batch', validateBody(executeBatchSchema), SmartAccountController.executeBatch);

router.post('/session-keys', validateBody(createSessionKeySchema), SmartAccountController.createSessionKey);
router.delete('/session-keys', validateBody(revokeSessionKeySchema), SmartAccountController.revokeSessionKey);
router.delete('/session-keys/:sessionKeyId', SmartAccountController.revokeSessionKeyById);
router.get('/session-keys', validateQuery(listSessionKeysSchema), SmartAccountController.listSessionKeys);

export default router;