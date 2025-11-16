import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KMSClient, CreateKeyCommand, DescribeKeyCommand, ScheduleKeyDeletionCommand, GenerateDataKeyCommand, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import * as crypto from 'crypto';
import { ethers } from 'ethers';

// Interfaces
export interface KeyPairResult {
  keyId: string;
  publicKey: string;
  address?: string;
  encryptedPrivateKey: string;
}

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  tag: string;
  keyId: string;
  revoked?: boolean;
}

@Injectable()
export class KmsKeyManager {
  private readonly logger = new Logger(KmsKeyManager.name);
  private readonly kms?: KMSClient;
  private readonly masterKeyId: string | undefined;
  private readonly encryptionAlgorithm = 'aes-256-gcm';

  constructor(private readonly configService: ConfigService) {
    const kmsProvider = this.configService.get<string>('KMS_PROVIDER', 'aws');
    
    switch (kmsProvider) {
      case 'aws':
        this.kms = new KMSClient({
          region: this.configService.get<string>('AWS_REGION', 'us-east-1'),
          credentials: {
            accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
            secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY', ''),
          },
        });
        this.masterKeyId = this.configService.get<string>('AWS_KMS_KEY_ID');
        break;
      
      case 'vault':
        this.initializeVaultClient();
        this.masterKeyId = 'transit';
        break;
        
      case 'hsm':
        this.initializeHSMClient();
        this.masterKeyId = 'hsm-default';
        break;
        
      default:
        throw new Error(`Unsupported KMS provider: ${kmsProvider}`);
    }
  }

  private initializeVaultClient(): void {
    // HashiCorp Vault client initialization
    this.logger.log('Initializing HashiCorp Vault client');
  }

  private initializeHSMClient(): void {
    // Hardware Security Module client initialization
    this.logger.log('Initializing Hardware Security Module client');
  }

  async generateKeyPair(keyId?: string): Promise<KeyPairResult> {
    try {
      if (!this.masterKeyId) {
        throw new Error('Master key ID not configured');
      }

      // Generate secp256k1 key pair
      const wallet = ethers.Wallet.createRandom();
      const publicKey = wallet.publicKey;
      const address = wallet.address;

      // Generate data key for envelope encryption
      if (!this.kms) {
        throw new Error('KMS not initialized for AWS provider');
      }
      
      const dataKeyCommand = new GenerateDataKeyCommand({
        KeyId: this.masterKeyId,
        KeySpec: 'AES_256',
        EncryptionContext: {
          sessionKeyId: keyId || 'generated-key',
          service: 'copil-transaction-executor',
          timestamp: new Date().toISOString(),
        },
      });
      
      const dataKeyResponse = await this.kms.send(dataKeyCommand);
      const plaintextKey = dataKeyResponse.Plaintext;
      const encryptedDataKey = dataKeyResponse.CiphertextBlob;

      if (!plaintextKey) {
        throw new Error('Failed to generate data key');
      }

      // Encrypt private key with envelope encryption
      const encryptedPrivateKey = await this.encryptPrivateKey(
        Buffer.from(wallet.privateKey.slice(2), 'hex'),
        Buffer.from(plaintextKey)
      );

      // Store encrypted private key and data key
      await this.storeEncryptedKey(keyId || 'generated-key', {
        ...encryptedPrivateKey,
        keyId: dataKeyResponse.KeyId!,
      });

      return {
        keyId: dataKeyResponse.KeyId!,
        publicKey,
        address,
        encryptedPrivateKey: encryptedPrivateKey.ciphertext,
      };
    } catch (error) {
      this.logger.error(`Failed to generate key pair: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async getPrivateKey(sessionKeyId: string): Promise<string | null> {
    try {
      // Retrieve encrypted private key
      const encryptedKey = await this.retrieveEncryptedKey(sessionKeyId);
      if (!encryptedKey) {
        return null;
      }

      // Decrypt data key from KMS
      const dataKey = await this.decryptDataKey(encryptedKey.keyId);
      
      // Decrypt private key
      const privateKey = this.decryptPrivateKey(encryptedKey, dataKey);
      
      return privateKey;
    } catch (error) {
      this.logger.error(`Failed to retrieve private key for ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async revokeKey(sessionKeyId: string): Promise<boolean> {
    try {
      // Schedule key for deletion in KMS
      if (this.kms && this.masterKeyId) {
        await this.kms.send(new ScheduleKeyDeletionCommand({
          KeyId: sessionKeyId,
          PendingWindowInDays: 7,
        }));
      }

      // Mark key as revoked in secure storage
      await this.markKeyAsRevoked(sessionKeyId);
      
      this.logger.log(`Revoked key ${sessionKeyId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to revoke key ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async keyExists(sessionKeyId: string): Promise<boolean> {
    try {
      const encryptedKey = await this.retrieveEncryptedKey(sessionKeyId);
      return encryptedKey !== null && !encryptedKey.revoked;
    } catch (error) {
      return false;
    }
  }

  async rotateKey(sessionKeyId: string): Promise<KeyPairResult> {
    try {
      // Generate new key pair
      const newKeyResult = await this.generateKeyPair(`${sessionKeyId}-rotated-${Date.now()}`);
      
      // Mark old key for retirement
      await this.retireKey(sessionKeyId);
      
      this.logger.log(`Rotated key ${sessionKeyId} to ${newKeyResult.keyId}`);
      return newKeyResult;
    } catch (error) {
      this.logger.error(`Failed to rotate key ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  // === Private Methods ===

  private async generateDataKey(sessionKeyId: string): Promise<{ keyId: string; plaintext: Buffer }> {
    if (!this.kms || !this.masterKeyId) {
      throw new Error('KMS not initialized');
    }

    const result = await this.kms.send(new GenerateDataKeyCommand({
      KeyId: this.masterKeyId,
      KeySpec: 'AES_256',
      EncryptionContext: {
        sessionKeyId,
        service: 'copil-transaction-executor',
        timestamp: new Date().toISOString(),
      },
    }));

    return {
      keyId: result.KeyId!,
      plaintext: Buffer.from(result.Plaintext!),
    };
  }

  private async decryptDataKey(keyId: string): Promise<Buffer> {
    if (!this.kms) {
      throw new Error('KMS not initialized');
    }

    // Retrieve encrypted data key from storage
    const encryptedDataKey = await this.retrieveEncryptedDataKey(keyId);
    
    const result = await this.kms.send(new DecryptCommand({
      CiphertextBlob: Buffer.from(encryptedDataKey, 'base64'),
      EncryptionContext: {
        service: 'copil-transaction-executor',
      },
    }));

    return Buffer.from(result.Plaintext!);
  }

  private async encryptPrivateKey(privateKey: Buffer, dataKey: Buffer): Promise<EncryptedData> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.encryptionAlgorithm, dataKey, iv);
    cipher.setAAD(Buffer.from('private-key'));
    
    let ciphertext = cipher.update(privateKey);
    ciphertext = Buffer.concat([ciphertext, cipher.final()]);
    
    const tag = cipher.getAuthTag();
    
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      keyId: '', // Will be set by caller
    };
  }

  private decryptPrivateKey(encryptedData: EncryptedData, dataKey: Buffer): string {
    const decipher = crypto.createDecipheriv(
      this.encryptionAlgorithm,
      dataKey,
      Buffer.from(encryptedData.iv, 'base64')
    );
    decipher.setAAD(Buffer.from('private-key'));
    decipher.setAuthTag(Buffer.from(encryptedData.tag, 'base64'));
    
    let plaintext = decipher.update(Buffer.from(encryptedData.ciphertext, 'base64'));
    plaintext = Buffer.concat([plaintext, decipher.final()]);
    
    return plaintext.toString();
  }

  private calculateEvmAddress(publicKey: crypto.KeyObject): string {
    const publicKeyBytes = publicKey.export({ format: 'der', type: 'spki' });
    const hash = crypto.createHash('sha256').update(publicKeyBytes).digest();
    const address = crypto.createHash('ripemd160').update(hash).digest();
    return '0x' + address.toString('hex');
  }

  private async storeEncryptedKey(sessionKeyId: string, encryptedData: EncryptedData): Promise<void> {
    // Implementation to store encrypted key in secure database or vault
    // This would integrate with your secure storage solution
    this.logger.debug(`Storing encrypted key for ${sessionKeyId}`);
  }

  private async retrieveEncryptedKey(sessionKeyId: string): Promise<EncryptedData | null> {
    // Implementation to retrieve encrypted key from secure storage
    this.logger.debug(`Retrieving encrypted key for ${sessionKeyId}`);
    return null; // Placeholder
  }

  private async retrieveEncryptedDataKey(keyId: string): Promise<string> {
    // Implementation to retrieve encrypted data key
    this.logger.debug(`Retrieving encrypted data key ${keyId}`);
    return ''; // Placeholder
  }

  private async markKeyAsRevoked(sessionKeyId: string): Promise<void> {
    // Implementation to mark key as revoked in storage
    this.logger.debug(`Marking key ${sessionKeyId} as revoked`);
  }

  private async retireKey(sessionKeyId: string): Promise<void> {
    // Implementation to retire old key during rotation
    this.logger.debug(`Retiring key ${sessionKeyId}`);
  }
}