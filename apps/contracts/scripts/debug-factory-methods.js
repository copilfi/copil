const { ethers } = require('hardhat');

async function main() {
  console.log('=== DEBUGGING FACTORY METHODS ===\n');
  
  const factoryAddress = '0x3597342717C9545D555233b195525542B7f591c2';
  console.log('Factory Address:', factoryAddress);
  
  // Test with a real user address (using treasury address as example)
  const testUserAddress = '0x742d35Cc6634C0532925a3b8D88f9BE5a45AFdF8';
  const salt = ethers.keccak256(ethers.toUtf8Bytes(testUserAddress));
  
  console.log('\nTest User Address:', testUserAddress);
  console.log('Salt:', salt);
  
  try {
    // Test getAccount method
    const getAccountSelector = ethers.id('getAccount(address)').slice(0, 10);
    const getAccountCallData = ethers.concat([
      getAccountSelector,
      ethers.zeroPadValue(testUserAddress, 32)
    ]);
    
    const getAccountResult = await ethers.provider.call({
      to: factoryAddress,
      data: getAccountCallData
    });
    
    const getAccountAddress = ethers.getAddress('0x' + getAccountResult.slice(-40));
    console.log('\ngetAccount() result:', getAccountAddress);
    console.log('Is zero address:', getAccountAddress === ethers.ZeroAddress);
    
    // Test getAddress method
    const getAddressSelector = ethers.id('getAddress(address,bytes32)').slice(0, 10);
    const getAddressCallData = ethers.concat([
      getAddressSelector,
      ethers.zeroPadValue(testUserAddress, 32),
      salt
    ]);
    
    const getAddressResult = await ethers.provider.call({
      to: factoryAddress,
      data: getAddressCallData
    });
    
    const getAddressAddress = ethers.getAddress('0x' + getAddressResult.slice(-40));
    console.log('\ngetAddress() result:', getAddressAddress);
    console.log('Is different from factory:', getAddressAddress.toLowerCase() !== factoryAddress.toLowerCase());
    console.log('Is different from user:', getAddressAddress.toLowerCase() !== testUserAddress.toLowerCase());
    
    // Test what the backend might be doing wrong
    console.log('\n=== TESTING BACKEND LOGIC ===');
    console.log('If getAccount returns zero address:', getAccountAddress === ethers.ZeroAddress);
    console.log('Then should use getAddress result:', getAddressAddress);
    
    if (getAccountAddress !== ethers.ZeroAddress) {
      console.log('⚠️  WARNING: getAccount returned non-zero address when no account should be deployed!');
      console.log('This indicates a logic error in the contract or backend');
    } else {
      console.log('✅ getAccount correctly returns zero address for undeployed account');
      console.log('✅ getAddress correctly returns predicted address:', getAddressAddress);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main().catch(console.error);