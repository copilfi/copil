import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer, admin } = await getNamedAccounts();

  console.log('Deploying ConditionalOrderEngine with account:', deployer);

  // Use admin address as fee recipient, fallback to deployer
  const feeRecipient = admin || deployer;

  const conditionalOrderEngine = await deploy('ConditionalOrderEngine', {
    from: deployer,
    args: [feeRecipient],
    log: true,
    waitConfirmations: 1,
    contract: 'contracts/ConditionalOrderEngine.sol:ConditionalOrderEngine',
  });

  console.log('ConditionalOrderEngine deployed to:', conditionalOrderEngine.address);

  // Verify deployment
  if (hre.network.name !== 'hardhat' && hre.network.name !== 'localhost') {
    console.log('Waiting for block confirmations...');
    await new Promise(resolve => setTimeout(resolve, 30000));

    try {
      await hre.run('verify:verify', {
        address: conditionalOrderEngine.address,
        constructorArguments: [feeRecipient],
      });
      console.log('ConditionalOrderEngine verified on block explorer');
    } catch (error) {
      console.log('Verification failed:', error);
    }
  }

  return true;
};

func.tags = ['ConditionalOrderEngine'];
func.id = 'deploy_conditional_order_engine';
export default func;