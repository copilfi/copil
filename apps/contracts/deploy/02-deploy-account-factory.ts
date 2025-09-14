import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log('Deploying AccountFactory with account:', deployer);

  // Get EntryPoint address from previous deployment
  const entryPoint = await get('EntryPoint');

  const accountFactory = await deploy('AccountFactory', {
    from: deployer,
    args: [entryPoint.address],
    log: true,
    waitConfirmations: 1,
  });

  console.log('AccountFactory deployed to:', accountFactory.address);

  // Verify deployment
  if (hre.network.name !== 'hardhat' && hre.network.name !== 'localhost') {
    console.log('Waiting for block confirmations...');
    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds

    try {
      await hre.run('verify:verify', {
        address: accountFactory.address,
        constructorArguments: [entryPoint.address],
      });
      console.log('AccountFactory verified on block explorer');
    } catch (error) {
      console.log('Verification failed:', error);
    }
  }

  return true;
};

func.tags = ['AccountFactory'];
func.id = 'deploy_account_factory';
func.dependencies = ['EntryPoint'];
export default func;