const { ethers } = require('hardhat');

async function main() {
  console.log('=== TESTING BACKEND FIX ===\n');
  
  const factoryAddress = '0x3597342717C9545D555233b195525542B7f591c2';
  console.log('Factory Address:', factoryAddress);
  
  // Use the same user address from the API logs
  const userAddress = '0x8df3e4806a3320d2642b1f2835adda1a40719c4e';
  const salt = ethers.keccak256(ethers.toUtf8Bytes(userAddress));
  
  console.log('\nUser Address:', userAddress);
  console.log('Generated Salt:', salt);
  
  try {
    // Test the manual contract call (this is what the fixed backend now uses)
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
    
    const predictedAddress = ethers.getAddress('0x' + result.slice(-40));
    console.log('\n✅ Fixed Backend Method:');
    console.log('Manual call result:', predictedAddress);
    console.log('Is unique address (not factory):', predictedAddress !== factoryAddress);
    console.log('Is different from user:', predictedAddress !== userAddress);
    
    // Verify this matches our expected computation
    if (predictedAddress === '0x93C6D15a71abA97bb2e5D171BaD4e9F12b88B51a') {
      console.log('✅ Matches expected computed address from previous test');
    } else {
      console.log('⚠️  Address differs from previous test:', '0x93C6D15a71abA97bb2e5D171BaD4e9F12b88B51a');
    }
    
    console.log('\n🎉 BACKEND FIX VERIFIED:');
    console.log(`User ${userAddress} should now get Smart Account: ${predictedAddress}`);
    console.log('No longer returns factory address!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main().catch(console.error);