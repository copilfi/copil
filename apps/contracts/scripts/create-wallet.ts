import { ethers } from 'ethers';
import { writeFileSync, existsSync } from 'fs';
import * as crypto from 'crypto';

async function main() {
  console.log('🔐 Creating production wallet...');

  // Generate cryptographically secure random wallet
  const wallet = ethers.Wallet.createRandom();
  
  console.log('\n✅ Wallet created successfully!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 Address: ${wallet.address}`);
  console.log(`🔑 Private Key: ${wallet.privateKey}`);
  console.log(`🌱 Mnemonic: ${wallet.mnemonic?.phrase}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Create wallet info file (WITHOUT private key for security)
  const walletInfo = {
    address: wallet.address,
    created: new Date().toISOString(),
    network: 'sei-mainnet',
    note: 'Production wallet - Private key stored separately'
  };

  writeFileSync('wallet-info.json', JSON.stringify(walletInfo, null, 2));
  
  console.log('\n📄 Wallet info saved to wallet-info.json');
  
  console.log('\n⚠️  SECURITY INSTRUCTIONS:');
  console.log('1. 🔒 NEVER commit the private key to git');
  console.log('2. 💾 Save private key to secure password manager');  
  console.log('3. 🏦 Consider using hardware wallet for mainnet');
  console.log('4. 💰 Fund this wallet with SEI tokens for gas');
  console.log('5. 🔄 Set PRIVATE_KEY in .env file');

  // Check current .env status
  if (existsSync('.env')) {
    console.log('\n📝 Update your .env file:');
    console.log(`PRIVATE_KEY=${wallet.privateKey.slice(2)}`);
  }

  console.log('\n🚀 Ready for mainnet deployment!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });