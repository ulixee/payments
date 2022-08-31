import { HardhatUserConfig } from 'hardhat/config';
import '@nomiclabs/hardhat-ethers';
import 'hardhat-gas-reporter';

const hardhatUserConfig: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  solidity: '0.8.9',
  paths: {
    sources: './test/assets/contracts',
  },
};
export default hardhatUserConfig;
