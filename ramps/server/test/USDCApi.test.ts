import '@ulixee/commons/lib/SourceMapSupport';
import { parseUnits } from 'ethers/lib/utils';
import * as hre from 'hardhat';
import { TASK_NODE, TASK_NODE_SERVER_READY } from 'hardhat/builtin-tasks/task-names';
import { JsonRpcServer } from 'hardhat/types';
import { Contract, ethers } from 'ethers';
import config from '../config';
import USDCApi from "../lib/USDCApi";
import { USDCNetworks } from "../lib/USDCNetworks";
import EthereumHDWallet from "../lib/EthereumHDWallet";

let usdc: Contract;
let hreServer: JsonRpcServer;
let hreTask: Promise<any>;
let reserveAccount: EthereumHDWallet<any>;
let holdingsAccount: EthereumHDWallet<any>;
let api: USDCApi<any>;

beforeAll(async () => {
  hreTask = hre.run(TASK_NODE, { port: 0 });
  await new Promise<void>(resolve =>
    hre.tasks[TASK_NODE_SERVER_READY].setAction(async ({ server }) => {
      hreServer = server;
      resolve();
    }),
  );

  await hre.network.provider.send('hardhat_setLoggingEnabled', [false]);

  // CREATE WALLETS
  reserveAccount = EthereumHDWallet.create({
    blockchain: 'ethereum',
    blockchainNetwork: USDCNetworks.ethereum.testnet,
  });
  holdingsAccount = EthereumHDWallet.create({
    blockchain: 'ethereum',
    blockchainNetwork: USDCNetworks.ethereum.testnet,
  });

  // DEPLOY ERC20 CONTRACT
  const USDC = await hre.ethers.getContractFactory('USDC');
  usdc = await USDC.deploy();
  config.ethereumApis.contractAddress = usdc.address;
  await usdc.deployed();

  // MINT TOKENS
  const [owner] = await hre.ethers.getSigners();
  await usdc.connect(owner)['mint(address,uint256)'](reserveAccount.address, parseUnits('1000', 6));

  // FUND RESERVE ACCOUNTS
  const gas = await hre.ethers.provider.getGasPrice();

  await owner.sendTransaction({
    from: owner.address,
    to: holdingsAccount.address,
    value: ethers.utils.parseEther('10'),
    nonce: hre.ethers.provider.getTransactionCount(owner.address, 'latest'),
    gasLimit: '0x100000',
    gasPrice: gas,
  });
  await owner.sendTransaction({
    from: owner.address,
    to: reserveAccount.address,
    value: ethers.utils.parseEther('10'),
    nonce: hre.ethers.provider.getTransactionCount(owner.address, 'latest'),
    gasLimit: '0x100000',
    gasPrice: gas,
  });

  api = new USDCApi(
    'ethereum',
    USDCNetworks.ethereum.testnet,
    reserveAccount.wallet,
    hre.ethers.provider,
  );
}, 15e3);

afterAll(async () => {
  clearTimeout(hre.ethers.provider._bootstrapPoll);
  hre.ethers.provider.removeAllListeners();
  await hreServer?.close();
  await hreTask;
});

describe('should be able to interact with UDSC', () => {
  test('can check balances', async () => {
    // check balance
    await expect(api.getBalanceOf(holdingsAccount.address)).resolves.toBe(0n);
    await expect(api.getBalanceOf(reserveAccount.address)).resolves.toBe(BigInt(1000e6));
  });

  test('can check blockheight', async () => {
    await expect(api.currentBlockNumber()).resolves.toBeGreaterThanOrEqual(1);
  });

  test('can transfer funds (NOTE: sender needs gwei for gas)', async () => {
    // transfer USDC (NOTE: needs gwei for gas)
    await api.transfer(holdingsAccount.address, 10);
    await expect(api.getBalanceOf(holdingsAccount.address)).resolves.toBe(BigInt(10e6));
  });

  test('can watch for transfers to one address', async () => {
    const transfers = await api.findTransfersToAddresses([holdingsAccount.address], -5);
    expect(transfers).toHaveLength(1);
    const [transfer] = transfers;
    expect(transfer.toAddress).toBe(holdingsAccount.address);
    expect(transfer.usdc).toBe(BigInt(10e6));

    const confirmations = await api.getConfirmations(transfer.transactionHash);
    expect(confirmations.confirmations).toBeGreaterThanOrEqual(1);
  });

  test('can watch for transfers to multiple address', async () => {
    const holdingsAccount2 = EthereumHDWallet.create({
      blockchain: 'ethereum',
      blockchainNetwork: USDCNetworks.ethereum.testnet,
    });

    await api.transfer(holdingsAccount2.address, 1.1);
    await api.transfer(holdingsAccount.address, 12);

    const transfers = await api.findTransfersToAddresses(
      [holdingsAccount.address, holdingsAccount2.address],
      -5,
    );
    expect(transfers).toHaveLength(3);
    const [transfer1, transfer2, transfer3] = transfers;
    expect(transfer1.toAddress).toBe(holdingsAccount.address);
    expect(transfer2.toAddress).toBe(holdingsAccount2.address);
    expect(transfer3.toAddress).toBe(holdingsAccount.address);
    expect(transfer1.usdc).toBe(BigInt(10e6));
    expect(transfer2.usdc).toBe(BigInt(1.1e6));
    expect(transfer3.usdc).toBe(BigInt(12e6));
  });
});
