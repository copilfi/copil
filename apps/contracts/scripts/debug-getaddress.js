const { ethers } = require('hardhat');

async function main() {
  console.log('Debugging getAddress function...');
  
  const factory = await ethers.getContractAt('AccountFactory', '0x3597342717C9545D555233b195525542B7f591c2');
  
  // Let's try to understand what the getAddress function actually returns
  const testOwner = '0x1234567890123456789012345678901234567890';
  const salt = ethers.keccak256(ethers.toUtf8Bytes('test'));
  
  console.log('Factory address:', factory.target);
  console.log('Test owner:', testOwner);
  console.log('Salt:', salt);
  
  try {
    // Try calling the internal components directly
    console.log('\n=== Testing getAddress function ===');
    const predictedAddress = await factory.getAddress(testOwner, salt);
    console.log('Predicted address:', predictedAddress);
    
    // Let's compare this to a manual calculation
    console.log('\n=== Manual calculation ===');
    
    // Get the account implementation address
    const accountImplementation = await factory.accountImplementation();
    console.log('Account implementation:', accountImplementation);
    
    // Try to manually calculate what should be the address
    // This should match the logic in AccountFactory.getAddress()
    
    // First, let's see what the SmartAccount.initialize function selector is
    const SmartAccountFactory = await ethers.getContractFactory('SmartAccount');
    const initData = SmartAccountFactory.interface.encodeFunctionData('initialize', [testOwner]);
    console.log('Initialize data:', initData);
    
    // Get proxy bytecode
    const ProxyFactory = await ethers.getContractFactory('@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy');
    const proxyBytecode = ProxyFactory.bytecode;
    console.log('Proxy bytecode length:', proxyBytecode.length);
    
    // Calculate salt used in contract
    const calculatedSalt = ethers.keccak256(ethers.solidityPacked(['address', 'bytes32'], [testOwner, salt]));
    console.log('Calculated salt:', calculatedSalt);
    
    // Try to determine if the factory is actually working correctly
    console.log('\n=== Testing with different parameters ===');
    const addr1 = await factory.getAddress(testOwner, ethers.keccak256(ethers.toUtf8Bytes('salt1')));
    const addr2 = await factory.getAddress(testOwner, ethers.keccak256(ethers.toUtf8Bytes('salt2')));
    const addr3 = await factory.getAddress('0x9999999999999999999999999999999999999999', salt);
    
    console.log('Same owner, different salt 1:', addr1);
    console.log('Same owner, different salt 2:', addr2);
    console.log('Different owner, same salt:', addr3);
    
    console.log('Are all addresses the same?', addr1 === addr2 && addr2 === addr3);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main().catch(console.error);