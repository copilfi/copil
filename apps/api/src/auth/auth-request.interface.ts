import { Request } from 'express';
import { User } from '@copil/database';

export interface AuthRequest extends Request {
  user: User;
}
