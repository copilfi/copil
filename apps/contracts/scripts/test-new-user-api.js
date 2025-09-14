const { ethers } = require('hardhat');

async function main() {
  console.log('=== TESTING API WITH NEW USER ===\n');
  
  const factoryAddress = '0x3597342717C9545D555233b195525542B7f591c2';
  const userAddress = '0xe92ec4ea222f8b5cee4d7b3ec1378302cc20020b';
  
  console.log('Factory Address:', factoryAddress);
  console.log('User Address:', userAddress);
  
  try {
    // Test manual contract call (what our fixed backend should do)
    const salt = ethers.keccak256(ethers.toUtf8Bytes(userAddress));
    const getAddressSelector = ethers.id('getAddress(address,bytes32)').slice(0, 10);
    const callData = ethers.concat([
      getAddressSelector,
      ethers.zeroPadValue(userAddress, 32),
      salt
    ]);
    
    const result = await ethers.provider.call({
      to: factoryAddress,
      data: callData
    });
    
    const correctSmartAccountAddress = ethers.getAddress('0x' + result.slice(-40));
    console.log('\n✅ CORRECT Smart Account Address:', correctSmartAccountAddress);
    
    // Check if it's deployed
    const code = await ethers.provider.getCode(correctSmartAccountAddress);
    const isActuallyDeployed = code !== '0x';
    
    console.log('Is Actually Deployed:', isActuallyDeployed);
    console.log('Contract Code Length:', code.length);
    
    if (!isActuallyDeployed) {
      console.log('\n❌ CONFIRMED: Smart Account is NOT deployed');
      console.log('💰 User must pay gas fees to deploy it');
      console.log('🔧 Frontend should show deploy button and trigger MetaMask');
    } else {
      console.log('\n✅ Smart Account is deployed on blockchain');
    }
    
    // Check if this matches what API returned
    const frontendReportedAddress = '0x73DC78ef2C43D921ED5C63Ccb9676621ceF807D6';
    console.log('\n=== API vs CONTRACT COMPARISON ===');
    console.log('Frontend/API reported:', frontendReportedAddress);
    console.log('Contract computed:   ', correctSmartAccountAddress);
    console.log('Addresses match:', frontendReportedAddress.toLowerCase() === correctSmartAccountAddress.toLowerCase());
    
    if (frontendReportedAddress.toLowerCase() === correctSmartAccountAddress.toLowerCase()) {
      console.log('✅ API fix is working! Addresses match');
    } else {
      console.log('❌ API still has issues - addresses do not match');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main().catch(console.error);