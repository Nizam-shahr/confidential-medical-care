export const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "0xYourDeployedAddressHere";

export const SEPOLIA_FHEVM_CONFIG = {
  chainId: 11155111,
  aclContractAddress: "0x687820221192C5B662b25367F70076A37bc79b6c",
  kmsContractAddress: "0x1364cBBf2cDF5032C47d8226a6f6FBD2AFCDacAC",
  inputVerifierContractAddress: "0xbc91f3daD1A5F19F8390c400196e58073B6a0BC4",
  verifyingContractAddressDecryption: "0xb6E160B1ff80D67Bfe90A85eE06Ce0A2613607D1",
  verifyingContractAddressInputVerification: "0x7048C39f048125eDa9d678AEbaDfB22F7900a29F",
  gatewayChainId: 55815,
  relayerUrl: "https://relayer.testnet.zama.ai",
};

export const SEPOLIA_CHAIN_ID = "0xaa36a7"; // 11155111 in hex
export const MAX_CHUNKS = 32; // 32 × 8 bytes = 256 chars max text