const { ethers } = require('hardhat');

async function main() {
  console.log('=== DEBUGGING ACTUAL USER ADDRESS ===\n');
  
  const factoryAddress = '0x3597342717C9545D555233b195525542B7f591c2';
  console.log('Factory Address:', factoryAddress);
  
  // Use the actual user address from the API logs
  const userAddress = '0x8df3e4806a3320d2642b1f2835adda1a40719c4e';
  const salt = ethers.keccak256(ethers.toUtf8Bytes(userAddress));
  
  console.log('\nActual User Address from API logs:', userAddress);
  console.log('Generated Salt:', salt);
  
  try {
    // Test getAccount method (should return zero address if not deployed)
    const getAccountSelector = ethers.id('getAccount(address)').slice(0, 10);
    const getAccountCallData = ethers.concat([
      getAccountSelector,
      ethers.zeroPadValue(userAddress, 32)
    ]);
    
    const getAccountResult = await ethers.provider.call({
      to: factoryAddress,
      data: getAccountCallData
    });
    
    const getAccountAddress = ethers.getAddress('0x' + getAccountResult.slice(-40));
    console.log('\ngetAccount() result:', getAccountAddress);
    console.log('Is zero address:', getAccountAddress === ethers.ZeroAddress);
    
    // Test getAddress method (should return computed address)
    const getAddressSelector = ethers.id('getAddress(address,bytes32)').slice(0, 10);
    const getAddressCallData = ethers.concat([
      getAddressSelector,
      ethers.zeroPadValue(userAddress, 32),
      salt
    ]);
    
    const getAddressResult = await ethers.provider.call({
      to: factoryAddress,
      data: getAddressCallData
    });
    
    const getAddressAddress = ethers.getAddress('0x' + getAddressResult.slice(-40));
    console.log('\ngetAddress() result:', getAddressAddress);
    console.log('Is factory address (BUG!):', getAddressAddress === factoryAddress);
    console.log('Is different from user:', getAddressAddress.toLowerCase() !== userAddress.toLowerCase());
    
    if (getAddressAddress === factoryAddress) {
      console.log('\n🚨 CRITICAL BUG CONFIRMED: getAddress returns factory address!');
      console.log('This explains why the API is returning the factory address as Smart Account address');
    } else {
      console.log('\n✅ Contract working correctly - issue must be in backend code');
    }
    
    // Test with ethers.js contract interface (simulating backend call)
    const factory = new ethers.Contract(factoryAddress, [
      'function getAddress(address owner, bytes32 salt) external view returns (address)'
    ], ethers.provider);
    
    const ethersResult = await factory.getAddress(userAddress, salt);
    console.log('\nEthers.js Contract result:', ethersResult);
    console.log('Ethers result matches manual call:', ethersResult === getAddressAddress);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main().catch(console.error);