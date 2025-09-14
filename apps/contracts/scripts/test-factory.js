const { ethers } = require('hardhat');

async function main() {
  const factory = await ethers.getContractAt('AccountFactory', '0x3597342717C9545D555233b195525542B7f591c2');
  console.log('Factory Address:', factory.target);
  
  const testOwner1 = '0x1234567890123456789012345678901234567890';
  const testOwner2 = '0x9876543210987654321098765432109876543210';
  const salt = ethers.keccak256(ethers.toUtf8Bytes('test'));
  
  const addr1 = await factory.getAddress(testOwner1, salt);
  const addr2 = await factory.getAddress(testOwner2, salt);
  
  console.log('Test Owner 1 Address:', testOwner1);
  console.log('Predicted Smart Account 1:', addr1);
  console.log('Test Owner 2 Address:', testOwner2);
  console.log('Predicted Smart Account 2:', addr2);
  console.log('Addresses are different:', addr1 !== addr2);
  console.log('Address 1 different from factory:', addr1 !== factory.target);
  console.log('Address 2 different from factory:', addr2 !== factory.target);
}

main().catch(console.error);