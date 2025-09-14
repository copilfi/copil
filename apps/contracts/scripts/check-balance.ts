import { ethers } from 'ethers';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function checkBalance() {
    try {
        console.log('🔍 Checking wallet balance on SEI Mainnet...\n');
        
        // Connect to SEI mainnet
        const provider = new ethers.JsonRpcProvider(
            process.env.SEI_RPC_URL || 'https://evm-rpc.sei-apis.com'
        );
        
        // Create wallet instance
        const privateKey = process.env.PRIVATE_KEY;
        if (!privateKey) {
            throw new Error('PRIVATE_KEY not found in environment variables');
        }
        
        const wallet = new ethers.Wallet(privateKey, provider);
        
        // Get network info
        const network = await provider.getNetwork();
        console.log(`🌐 Network: ${network.name} (Chain ID: ${network.chainId})`);
        console.log(`📍 Wallet Address: ${wallet.address}`);
        
        // Check balance
        const balance = await provider.getBalance(wallet.address);
        const balanceInSei = ethers.formatEther(balance);
        
        console.log(`💰 Balance: ${balanceInSei} SEI`);
        
        // Check if we have enough for deployment (at least 1 SEI)
        const minBalance = ethers.parseEther('1.0');
        if (balance < minBalance) {
            console.log('⚠️  WARNING: Balance is below 1 SEI. You may need more tokens for contract deployment.');
        } else {
            console.log('✅ Balance is sufficient for contract deployment.');
        }
        
        // Get current gas price
        const feeData = await provider.getFeeData();
        console.log(`⛽ Current Gas Price: ${ethers.formatUnits(feeData.gasPrice || 0, 'gwei')} gwei`);
        
        // Estimate deployment costs (rough estimate)
        const estimatedGasForDeployment = 3000000; // 3M gas for all contracts
        const estimatedCost = (feeData.gasPrice || 0n) * BigInt(estimatedGasForDeployment);
        const estimatedCostInSei = ethers.formatEther(estimatedCost);
        
        console.log(`📊 Estimated deployment cost: ${estimatedCostInSei} SEI`);
        
        if (balance > estimatedCost * 2n) {
            console.log('✅ Sufficient balance for safe deployment with buffer.');
        } else if (balance > estimatedCost) {
            console.log('⚠️  Balance covers deployment but with minimal buffer.');
        } else {
            console.log('❌ Insufficient balance for deployment.');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('❌ Error checking balance:', error);
        process.exit(1);
    }
}

// Run the balance check
if (require.main === module) {
    checkBalance();
}

export { checkBalance };