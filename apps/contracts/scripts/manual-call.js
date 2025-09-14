const { ethers } = require('hardhat');

async function main() {
  console.log('Making manual calls to AccountFactory...');
  
  const factoryAddress = '0x3597342717C9545D555233b195525542B7f591c2';
  const testOwner = '0x1234567890123456789012345678901234567890';
  const salt = ethers.keccak256(ethers.toUtf8Bytes('test'));
  
  console.log('Factory address:', factoryAddress);
  console.log('Test owner:', testOwner);
  console.log('Salt:', salt);
  
  // Let's manually encode the getAddress function call
  const getAddressSignature = 'getAddress(address,bytes32)';
  const functionSelector = ethers.id(getAddressSignature).slice(0, 10);
  console.log('Function selector for getAddress:', functionSelector);
  
  // Encode the function call
  const callData = ethers.concat([
    functionSelector,
    ethers.zeroPadValue(testOwner, 32),
    salt
  ]);
  
  console.log('Call data:', callData);
  
  try {
    // Make the call
    const result = await ethers.provider.call({
      to: factoryAddress,
      data: callData
    });
    
    console.log('Raw result:', result);
    
    // Decode the result (should be an address)
    if (result && result !== '0x') {
      const decodedAddress = ethers.getAddress('0x' + result.slice(-40));
      console.log('Decoded address:', decodedAddress);
      console.log('Is same as factory?', decodedAddress.toLowerCase() === factoryAddress.toLowerCase());
    } else {
      console.log('Empty result');
    }
    
    // Let's also try to call the implementation address getter
    const implCallData = ethers.id('accountImplementation()').slice(0, 10);
    const implResult = await ethers.provider.call({
      to: factoryAddress,
      data: implCallData
    });
    
    console.log('Implementation result:', implResult);
    const implAddress = ethers.getAddress('0x' + implResult.slice(-40));
    console.log('Implementation address:', implAddress);
    
  } catch (error) {
    console.error('Error making manual call:', error);
  }
}

main().catch(console.error);