#!/bin/bash

echo "🚀 Starting Copil DeFi Platform Deployment to Sei Testnet..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found! Please copy .env.example to .env and configure your deployment settings."
    echo "Required environment variables:"
    echo "  - PRIVATE_KEY: Your deployer private key"
    echo "  - ADMIN_PRIVATE_KEY: Your admin private key (optional)"
    echo "  - SEI_TESTNET_RPC_URL: Sei testnet RPC URL (optional, defaults to official RPC)"
    echo ""
    echo "Creating .env file from template..."
    cp .env.example .env
    echo "✅ Please configure .env file with your deployment settings and run this script again."
    exit 1
fi

# Source environment variables
source .env

# Check if PRIVATE_KEY is configured
if [ -z "$PRIVATE_KEY" ]; then
    echo "❌ PRIVATE_KEY not configured in .env file"
    echo "Please add your deployer private key to the .env file"
    exit 1
fi

echo "📋 Deployment Configuration:"
echo "  Network: sei-testnet"
echo "  RPC URL: ${SEI_TESTNET_RPC_URL:-https://evm-rpc-testnet.sei-apis.com}"
echo "  Chain ID: 713715"
echo ""

# Compile contracts
echo "🔧 Compiling contracts..."
npm run compile
if [ $? -ne 0 ]; then
    echo "❌ Contract compilation failed"
    exit 1
fi

# Deploy contracts
echo "📦 Deploying contracts to Sei testnet..."
npx hardhat deploy --network sei-testnet --tags EntryPoint,AccountFactory,ConditionalOrderEngine

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Deployment completed successfully!"
    echo ""
    echo "📋 Deployment Summary:"
    echo "  Network: Sei Testnet (Chain ID: 713715)"
    echo "  Explorer: https://seitrace.com/?chain=sei-testnet"
    echo ""
    echo "📄 Deployed Contracts:"
    echo "  Check the deployment folder for contract addresses"
    echo "  Artifacts saved in deployments/sei-testnet/"
    echo ""
    echo "🔍 Next Steps:"
    echo "  1. Verify contract addresses in deployments/sei-testnet/"
    echo "  2. Update your application configuration with deployed addresses"
    echo "  3. Test contract interactions on testnet"
else
    echo "❌ Deployment failed"
    exit 1
fi