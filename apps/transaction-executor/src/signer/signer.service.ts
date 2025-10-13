import { Injectable, Logger } from '@nestjs/common';

export interface SignAndSendRequest {
  userId: number;
  sessionKeyId: number;
  transaction: {
    to: string;
    data: string;
    value?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface SignAndSendResult {
  status: 'success' | 'pending' | 'failed';
  txHash?: string;
  description?: string;
}

@Injectable()
export class SignerService {
  private readonly logger = new Logger(SignerService.name);

  async signAndSend(request: SignAndSendRequest): Promise<SignAndSendResult> {
    this.logger.warn(
      `Signer integration missing. Queued transaction for user ${request.userId}, session key ${request.sessionKeyId}.`,
    );

    return {
      status: 'pending',
      description: 'Transaction prepared; awaiting signer integration.',
    };
  }
}
