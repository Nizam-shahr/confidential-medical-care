import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import type { HardhatUserConfig } from "hardhat/config";
import { vars } from "hardhat/config";
import "solidity-coverage";

import "./tasks/accounts";
import "./tasks/FHECounter";

const DEPLOYER_PRIVATE_KEY: string = vars.get("DEPLOYER_PRIVATE_KEY");
const ALCHEMY_API_KEY: string = vars.get("ALCHEMY_API_KEY");

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: 0,
  },
  etherscan: {
    apiKey: vars.get("ETHERSCAN_API_KEY"),
  },
  gasReporter: {
    currency: "USD",
    enabled: process.env.REPORT_GAS ? true : false,
    excludeContracts: [],
  },
  networks: {
    // In-process network uses Hardhat's built-in test accounts (tests need several signers)
    hardhat: {
      chainId: 31337,
    },
    anvil: {
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 31337,
      url: "http://localhost:8545",
    },
    // Sepolia testnet — uses your real deployer private key
    sepolia: {
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 11155111,
      url: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    },
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
  solidity: {
    version: "0.8.27",
    settings: {
      metadata: {
        bytecodeHash: "none",
      },
      optimizer: {
        enabled: true,
        runs: 800,
      },
      evmVersion: "cancun",
    },
  },
  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },
};

export default config;