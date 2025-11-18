import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import * as secrets from 'secrets.js-grempe';

export interface ThresholdKeyResult {
  address: string;
  publicKey: string;
  threshold: number;
  totalParticipants: number;
}

export interface KeyShare {
  participantId: string;
  share: string;
  publicKey: string;
}

export interface SignatureRequest {
  messageHash: string;
  shares: KeyShare[];
  threshold: number;
}

export interface PartialSignature {
  participantId: string;
  signature: string;
}

@Injectable()
export class MPCClient {
  private readonly logger = new Logger(MPCClient.name);

  constructor(private readonly configService: ConfigService) {}

  async generateThresholdKey(
    threshold: number,
    totalParticipants: number,
    participants: string[],
  ): Promise<ThresholdKeyResult> {
    try {
      this.logger.log(`Generating ${threshold}-of-${totalParticipants} threshold key`);

      // Generate random private key
      const privateKey = ethers.Wallet.createRandom().privateKey;
      const wallet = new ethers.Wallet(privateKey);

      // Convert private key to hex for Shamir sharing
      const privateKeyHex = privateKey.replace('0x', '');

      // Generate shares using Shamir Secret Sharing
      const shares = secrets.share(privateKeyHex, totalParticipants, threshold);

      // Create key share objects
      const keyShares: KeyShare[] = shares.map((share, index) => ({
        participantId: participants[index] || `participant-${index + 1}`,
        share: share,
        publicKey: wallet.signingKey.publicKey,
      }));

      // Store shares securely (in production, use KMS)
      await this.storeKeyShares(keyShares);

      this.logger.log(`Successfully generated threshold key: ${wallet.address}`);

      return {
        address: wallet.address,
        publicKey: wallet.signingKey.publicKey,
        threshold,
        totalParticipants,
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate threshold key: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async initiateSignatureCollection(operation: SignatureRequest): Promise<void> {
    try {
      this.logger.log(`Initiating signature collection for threshold ${operation.threshold}`);

      // In production, this would coordinate with multiple participants
      // For now, simulate the process
      const partialSignatures = await this.collectPartialSignatures(operation);
      const finalSignature = await this.combinePartialSignatures(
        partialSignatures,
        operation.threshold,
      );

      this.logger.log(`Signature collection completed: ${finalSignature}`);
    } catch (error) {
      this.logger.error(
        `Failed to initiate signature collection: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async initiateKeyRefresh(
    walletId: string,
    participants: string[],
    operationId: string,
  ): Promise<void> {
    try {
      this.logger.log(`Initiating key refresh for wallet ${walletId}`);

      // In production, this would re-share the existing key with new participants
      // without changing the underlying private key
      throw new Error('Key refresh not implemented yet - requires existing key lookup');
    } catch (error) {
      this.logger.error(
        `Failed to initiate key refresh: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // Helper methods for production implementation
  private async storeKeyShares(shares: KeyShare[]): Promise<void> {
    // In production, store shares in KMS or secure vault
    this.logger.log(`Storing ${shares.length} key shares securely`);
  }

  private async collectPartialSignatures(operation: SignatureRequest): Promise<PartialSignature[]> {
    // In production, coordinate with multiple participants to sign
    // For demonstration, simulate with available shares
    const partialSignatures: PartialSignature[] = [];

    for (const share of operation.shares) {
      const partialSignature = await this.generatePartialSignature(share, operation.messageHash);
      partialSignatures.push(partialSignature);
    }

    return partialSignatures;
  }

  private async generatePartialSignature(
    share: KeyShare,
    messageHash: string,
  ): Promise<PartialSignature> {
    try {
      // Reconstruct private key from share (simplified for demo)
      // In production, each participant would sign with their share independently
      const privateKeyHex = share.share;
      const wallet = new ethers.Wallet(`0x${privateKeyHex}`);

      const signature = await wallet.signMessage(ethers.getBytes(messageHash));

      return {
        participantId: share.participantId,
        signature,
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate partial signature: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async combinePartialSignatures(
    partialSignatures: PartialSignature[],
    threshold: number,
  ): Promise<string> {
    if (partialSignatures.length < threshold) {
      throw new Error(`Insufficient signatures: ${partialSignatures.length} < ${threshold}`);
    }

    // In production, this would use proper threshold signature combination
    // For demonstration, return the first valid signature
    return partialSignatures[0].signature;
  }
}
