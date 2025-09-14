const { ethers } = require('hardhat');

async function main() {
  console.log('=== CHECKING ACTUAL USER SMART ACCOUNT DEPLOYMENT ===\n');
  
  // Yeni kullanıcının adresi (loglardan)
  const userAddress = '0xe92ec4Ea222f8b5cEe4D7B3Ec1378302CC20020B';
  const predictedSmartAccount = '0x73DC78ef2C43D921ED5C63Ccb9676621ceF807D6';
  
  console.log('User Address:', userAddress);
  console.log('Predicted Smart Account:', predictedSmartAccount);
  
  try {
    // Predicted adresteki kod kontrolü
    const code = await ethers.provider.getCode(predictedSmartAccount);
    const isDeployed = code !== '0x';
    
    console.log('\n=== DEPLOYMENT STATUS ===');
    console.log('Contract Code Length:', code.length);
    console.log('Is Actually Deployed:', isDeployed);
    
    if (!isDeployed) {
      console.log('❌ PROBLEM: Smart Account is NOT deployed on blockchain!');
      console.log('🔍 The system only calculated the address but did not deploy the contract');
      console.log('💰 User should pay gas fees to actually deploy the Smart Account');
      
      // Factory kontrat ile doğrulama
      const factoryAddress = '0x3597342717C9545D555233b195525542B7f591c2';
      const getAccountSelector = ethers.id('getAccount(address)').slice(0, 10);
      const getAccountCallData = ethers.concat([
        getAccountSelector,
        ethers.zeroPadValue(userAddress, 32)
      ]);
      
      const result = await ethers.provider.call({
        to: factoryAddress,
        data: getAccountCallData
      });
      
      const factoryStoredAddress = ethers.getAddress('0x' + result.slice(-40));
      console.log('\nFactory stored address:', factoryStoredAddress);
      console.log('Is zero (not deployed):', factoryStoredAddress === ethers.ZeroAddress);
      
    } else {
      console.log('✅ Smart Account is actually deployed!');
      console.log('🎉 User paid gas fees and contract exists on blockchain');
      
      // Kontrat sahibini kontrol et
      const smartAccountInterface = new ethers.Interface([
        'function owner() external view returns (address)'
      ]);
      
      const ownerCallData = smartAccountInterface.encodeFunctionData('owner');
      const ownerResult = await ethers.provider.call({
        to: predictedSmartAccount,
        data: ownerCallData
      });
      
      const owner = ethers.getAddress('0x' + ownerResult.slice(-40));
      console.log('Smart Account Owner:', owner);
      console.log('✅ Owner matches user:', owner.toLowerCase() === userAddress.toLowerCase());
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main().catch(console.error);