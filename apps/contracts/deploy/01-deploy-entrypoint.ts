import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log('Deploying EntryPoint with account:', deployer);

  // Note: In production, you would use the standard EntryPoint contract
  // For this example, we'll assume it's already deployed at a known address
  const ENTRY_POINT_ADDRESS = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';

  console.log('Using existing EntryPoint at:', ENTRY_POINT_ADDRESS);

  // Save the EntryPoint address for other deployments to use
  await deployments.save('EntryPoint', {
    address: ENTRY_POINT_ADDRESS,
    abi: [], // Would include full EntryPoint ABI in production
  });

  return true;
};

func.tags = ['EntryPoint'];
func.id = 'deploy_entrypoint';
export default func;