import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { logger } from '@/utils/logger';

export const validateBody = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.body, { 
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: true
    });

    if (error) {
      const errorMessage = error.details
        .map(detail => detail.message.replace(/"/g, ''))
        .join(', ');
      
      logger.warn('Validation error:', {
        message: errorMessage,
        body: req.body,
        details: error.details
      });
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(detail => ({
          field: detail.context?.label || detail.path.join('.'),
          message: detail.message.replace(/"/g, '')
        }))
      });
      return;
    }

    next();
  };
};

export const validateQuery = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.query, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true
    });

    if (error) {
      const errorMessage = error.details
        .map(detail => detail.message.replace(/"/g, ''))
        .join(', ');
      
      logger.warn('Query validation error:', errorMessage);
      res.status(400).json({
        error: 'Query validation failed',
        details: error.details.map(detail => ({
          field: detail.context?.label || detail.path.join('.'),
          message: detail.message.replace(/"/g, '')
        }))
      });
      return;
    }

    next();
  };
};

export const validateParams = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.params, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true
    });

    if (error) {
      const errorMessage = error.details
        .map(detail => detail.message.replace(/"/g, ''))
        .join(', ');
      
      logger.warn('Params validation error:', errorMessage);
      res.status(400).json({
        error: 'Parameter validation failed',
        details: error.details.map(detail => ({
          field: detail.context?.label || detail.path.join('.'),
          message: detail.message.replace(/"/g, '')
        }))
      });
      return;
    }

    next();
  };
};

// Common validation schemas
export const commonSchemas = {
  address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required()
    .messages({
      'string.pattern.base': 'Address must be a valid Ethereum address'
    }),
  
  privateKey: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).optional()
    .messages({
      'string.pattern.base': 'Private key must be a valid 64-character hex string'
    }),
  
  amount: Joi.string().pattern(/^\d*\.?\d+$/).required()
    .messages({
      'string.pattern.base': 'Amount must be a valid number'
    }),
  
  percentage: Joi.number().min(0).max(100).required(),
  
  tokenSymbol: Joi.string().min(2).max(10).uppercase().required(),
  
  uuid: Joi.string().uuid().required(),
  
  pagination: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string().valid('asc', 'desc').default('desc'),
    sortBy: Joi.string().default('createdAt')
  }
};