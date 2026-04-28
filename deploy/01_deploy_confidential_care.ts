import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import * as fs from "fs";
import * as path from "path";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log(`\n🏥 Deploying ConfidentialCare with account: ${deployer}`);

  const result = await deploy("ConfidentialCare", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });

  console.log(`\n✅ ConfidentialCare deployed at: ${result.address}`);
  console.log(`   Network: ${hre.network.name}`);
  console.log(`   Block:   ${result.receipt?.blockNumber}`);

  // Save to deployments-output for frontend
  const deploymentsDir = path.join(__dirname, "../deployments-output");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const data = {
    ConfidentialCare: result.address,
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    blockNumber: result.receipt?.blockNumber,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(deploymentsDir, "deployments.json"),
    JSON.stringify(data, null, 2)
  );

  console.log(`\n📄 deployments.json saved to deployments-output/`);
  console.log(`\n📋 Next steps:`);
  console.log(`   1. Update frontend/.env.local with:`);
  console.log(`      NEXT_PUBLIC_CONTRACT_ADDRESS=${result.address}`);
  console.log(`   2. Add doctors via the admin panel in the frontend`);
  console.log(`   3. Test the full consultation flow`);
};

deploy.tags = ["ConfidentialCare"];
export default deploy;
