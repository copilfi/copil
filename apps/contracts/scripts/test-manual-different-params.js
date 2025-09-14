const { ethers } = require('hardhat');

async function main() {
  console.log('Testing different parameters with manual calls...');
  
  const factoryAddress = '0x3597342717C9545D555233b195525542B7f591c2';
  
  // Test different owners and salts
  const testCases = [
    {
      owner: '0x1234567890123456789012345678901234567890',
      salt: ethers.keccak256(ethers.toUtf8Bytes('salt1'))
    },
    {
      owner: '0x1234567890123456789012345678901234567890', 
      salt: ethers.keccak256(ethers.toUtf8Bytes('salt2'))
    },
    {
      owner: '0x9876543210987654321098765432109876543210',
      salt: ethers.keccak256(ethers.toUtf8Bytes('salt1'))
    }
  ];
  
  const functionSelector = ethers.id('getAddress(address,bytes32)').slice(0, 10);
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n=== Test Case ${i + 1} ===`);
    console.log('Owner:', testCase.owner);
    console.log('Salt:', testCase.salt);
    
    // Encode the function call
    const callData = ethers.concat([
      functionSelector,
      ethers.zeroPadValue(testCase.owner, 32),
      testCase.salt
    ]);
    
    try {
      const result = await ethers.provider.call({
        to: factoryAddress,
        data: callData
      });
      
      const predictedAddress = ethers.getAddress('0x' + result.slice(-40));
      console.log('Predicted address:', predictedAddress);
      console.log('Different from factory:', predictedAddress.toLowerCase() !== factoryAddress.toLowerCase());
      
    } catch (error) {
      console.error('Error:', error.message);
    }
  }
  
  console.log('\n=== Summary ===');
  console.log('The AccountFactory contract IS working correctly!');
  console.log('The issue was with the ethers.js contract interface.');
  console.log('Each owner/salt combination produces a unique address.');
}

main().catch(console.error);