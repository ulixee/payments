import EthereumHDWallet from '../lib/EthereumHDWallet';
import { USDCNetworks } from '../lib/USDCNetworks';

test('should be able to save and load a wallet with private keys', async () => {
  const wallet = await EthereumHDWallet.create({
    blockchain: 'ethereum',
    blockchainNetwork: USDCNetworks.ethereum.mainnet,
  });
  const signTest = await wallet.wallet.signMessage('Test1234');

  const saved = await wallet.exportFull('test1', { scryptIterations: 2 });

  const derived = await EthereumHDWallet.loadFromEncrypted(saved, 'test1');
  expect(derived.path).toBe(wallet.path);
  expect(derived.wallet.privateKey).toBe(wallet.wallet.privateKey);
  await expect(derived.wallet.signMessage('Test1234')).resolves.toBe(signTest);
}, 30e3);

test('should be able to save and recover a "neutered" wallet', async () => {
  const wallet = await EthereumHDWallet.create({
    blockchain: 'ethereum',
    blockchainNetwork: USDCNetworks.ethereum.mainnet,
  });

  const neutered = wallet.exportNeuteredKey();

  const wallet2 = EthereumHDWallet.loadNeutered(neutered);
  expect(wallet.path).toBe(wallet2.path);
  expect(wallet.address).toBe(wallet2.address);
  expect(wallet2.wallet).toBeNull();
});

test('should be able to generate child addresses', async () => {
  const wallet = await EthereumHDWallet.create({
    blockchain: 'ethereum',
    blockchainNetwork: USDCNetworks.ethereum.mainnet,
  });

  const neutered = wallet.exportNeuteredKey();
  const wallet2 = EthereumHDWallet.loadNeutered(neutered);
  expect(wallet.deriveChild(2).path).toBe(wallet2.deriveChild(2).path);
  expect(wallet.deriveChild(2).address).toBe(wallet2.deriveChild(2).address);
  expect(wallet.deriveChild(25).path).toBe(wallet2.deriveChild(25).path);
  expect(wallet.deriveChild(25).address).toBe(wallet2.deriveChild(25).address);
});
