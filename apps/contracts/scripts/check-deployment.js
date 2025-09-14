const { ethers } = require('hardhat');

async function main() {
  console.log('Checking deployed AccountFactory...');
  
  // Check contract code
  const code = await ethers.provider.getCode('0x3597342717C9545D555233b195525542B7f591c2');
  console.log('Contract has code:', code !== '0x');
  console.log('Code length:', code.length);
  
  // Try to interact with contract
  try {
    const factory = await ethers.getContractAt('AccountFactory', '0x3597342717C9545D555233b195525542B7f591c2');
    
    // Check basic contract info
    const entryPoint = await factory.entryPoint();
    console.log('EntryPoint address:', entryPoint);
    
    const implementation = await factory.accountImplementation();
    console.log('Account implementation:', implementation);
    
    // Test getAddress function with different inputs
    const testOwner = '0x1234567890123456789012345678901234567890';
    const salt1 = ethers.keccak256(ethers.toUtf8Bytes('salt1'));
    const salt2 = ethers.keccak256(ethers.toUtf8Bytes('salt2'));
    
    const addr1 = await factory.getAddress(testOwner, salt1);
    const addr2 = await factory.getAddress(testOwner, salt2);
    
    console.log('Test results:');
    console.log('Factory address:', factory.target);
    console.log('Address with salt1:', addr1);
    console.log('Address with salt2:', addr2);
    console.log('Different salts produce different addresses:', addr1 !== addr2);
    
  } catch (error) {
    console.error('Error interacting with contract:', error.message);
  }
}

main().catch(console.error);