import Address from '@ulixee/crypto/lib/Address';
import Identity from '@ulixee/crypto/lib/Identity';
import Log from '@ulixee/commons/lib/Logger';
import { Wallet } from 'ethers';
import TestClient from '@ulixee/sidechain-server/test/_TestClient';
import AddressGetBalance from '@ulixee/sidechain-server/main/endpoints/Address.getBalance';
import BlockManager from '@ulixee/sidechain-server/main/lib/BlockManager';
import moment = require('moment');
import ConsumerPriceIndex from '../models/ConsumerPriceIndex';
import ConsumerPriceIndexMonitor from '../lib/ConsumerPriceIndexMonitor';
import RampCreateTransferInAddress from '../endpoints/Ramp.createTransferInAddress';
import USDCAddress from '../models/USDCAddress';
import { start, stop } from './_setup';
import config from '../config';
import USDCApi from '../lib/USDCApi';
import USDCMonitor from '../lib/USDCMonitor';
import USDCTransfer from '../models/USDCTransfer';
import EthereumHDWallet from '../lib/EthereumHDWallet';
import { USDCNetworks } from '../lib/USDCNetworks';
import RampAudit from '../models/RampAudit';
import RampAuditEndpoint from '../endpoints/Ramp.audit';
import validateAudit from '../scripts/validateAudit';
import RampApp from '../lib/RampApp';

const { log } = Log(module);

const txOpts = { logger: log };

beforeAll(async () => {
  await start();
  await USDCMonitor.start();
  await BlockManager.start();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(ConsumerPriceIndexMonitor, 'start').mockImplementation(() => Promise.resolve());
});

afterAll(async () => {
  await stop();
  await BlockManager.stop();
  await USDCMonitor.stop();
});

describe('USDC -> Argons', () => {
  test('should be able to create a USDC address to exchange USDC for Argons', async () => {
    const address = Address.createFromSigningIdentities([Identity.createSync()]);
    const result = await RampCreateTransferInAddress.handler(
      { blockchain: 'ethereum', address: address.bech32 },
      txOpts,
    );
    expect(result.address).toBeTruthy();
    expect(result.expirationDate.getTime()).toBeGreaterThanOrEqual(new Date().getTime());

    const openAddresses = await USDCAddress.findOpenAddresses(txOpts);
    expect(openAddresses).toHaveLength(1);
  });

  test('should convert funds to Argons after enough confirmations', async () => {
    const address = Address.createFromSigningIdentities([Identity.createSync()]);
    const result = await RampCreateTransferInAddress.handler(
      { blockchain: 'ethereum', address: address.bech32 },
      txOpts,
    );
    const fakeEtherAddress = Wallet.createRandom();
    const findTransfersToAddressesSpy = jest.spyOn(USDCApi.prototype, 'findTransfersToAddresses');
    findTransfersToAddressesSpy.mockImplementationOnce(async () => {
      return [
        {
          fromAddress: fakeEtherAddress.address,
          toAddress: result.address,
          usdc: BigInt(10e6),
          transactionHash: '0x0648696ec22f267ee00f4e03c78171985b8645eba93bbad2e4a67edf33606bfe',
          blockHash: '0x9b0b5185d28473c1852bc4669d16b6939eb4eaa452d8fe3b1c0ea256ec1497a0',
          blockNumber: 4,
          contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        },
      ];
    });

    jest.spyOn(RampAudit, 'latestSignedAudit').mockImplementationOnce(async () => {
      return {
        auditDate: new Date(),
        usdcToArgonConversionRate: 1,
        argonsInCirculationE6: 1n,
        proofOfUsdcAddressCustody: [],
        usdcAddresses: [],
        usdcReservesE6: 1n,
      };
    });
    // @ts-expect-error
    const transfers = await USDCMonitor.checkTransfers();
    expect(transfers).toHaveLength(1);
    expect(transfers[0].toUsdcAddress).toBe(result.address);
    expect(transfers[0].argonConversionRate).toBe(1);

    const blockNumber = transfers[0].blockNumber;
    jest
      .spyOn(USDCApi.prototype, 'currentBlockNumber')
      .mockImplementation(() => Promise.resolve(blockNumber + 11));
    jest.spyOn(USDCApi.prototype, 'getConfirmations').mockImplementation(async () => {
      return { blockNumber: blockNumber + 11, confirmations: 11, blockHash: '0x1' };
    });
    // @ts-expect-error
    await expect(USDCMonitor.checkConfirmations()).rejects.toThrowError(
      'Sidechain does not have any loaded Reserves accounts that can afford to sell to a USDC buyer',
    );

    const reservesClient = new TestClient();
    config.sidechainAddressesForReserves = [reservesClient.credentials.address];
    await reservesClient.grantCentagons(1000e2);
    // @ts-expect-error
    await expect(USDCMonitor.checkConfirmations()).resolves.toBeUndefined();

    const usdcTransferBalance = await AddressGetBalance.handler({ address: address.bech32 });
    expect(usdcTransferBalance.balance).toBe(1000n);

    const reservesBalance = await AddressGetBalance.handler({ address: reservesClient.address });
    expect(reservesBalance.balance).toBe(99000n);
  });
});

describe('USDC conversion', () => {
  test('should convert Argons at min of a) CPI ratio since start, b) USDC Reserves per Argon ratio', async () => {
    config.cpiBaseline.value = 100;
    // @ts-expect-error
    delete ConsumerPriceIndex.cachedBaseline;
    // @ts-expect-error
    ConsumerPriceIndex.cachedLatest.value = null;

    await RampApp.db.transaction(async db => {
      await db.update(
        'update consumer_price_index set value=100, conversion_rate=1.000 where date=$1',
        [moment(config.cpiBaseline.date).toDate()],
      );
    });
    await RampApp.db.transaction(db => ConsumerPriceIndex.record(db, new Date(), 250));
    const baseline = await ConsumerPriceIndex.getBaseline();
    expect(baseline.value).toBe(100);

    const latest = await ConsumerPriceIndex.getLatest(true);
    expect(latest.conversionRate).toBe(0.4);

    const USDCReserves = BigInt(10e3 * 1e6);
    // $1d = 40 centagons converted
    expect(
      USDCTransfer.convertDollarsToCentagons(
        1e6,
        latest.conversionRate,
        USDCReserves,
        BigInt(10e3 * 1e6),
      ),
    ).toBe(40n);

    expect(
      USDCTransfer.convertDollarsToCentagons(
        1e6,
        latest.conversionRate,
        // only 9k in reserves vs 10k Argons (that's only 9k*0.4 conversion rate = 3600/10k ratio = .36)
        BigInt(9e3 * 1e6),
        BigInt(10e3 * 1e6),
      ),
    ).toBe(36n);
  });
});

describe('Sidechain Audits', () => {
  let eth1;
  let eth2;
  let eth3;
  let USDCBalances: { [address: string]: bigint };
  beforeAll(async () => {
    eth1 = EthereumHDWallet.create({
      blockchain: 'ethereum',
      blockchainNetwork: USDCNetworks.ethereum.testnet,
    });
    eth2 = EthereumHDWallet.create({
      blockchain: 'ethereum',
      blockchainNetwork: USDCNetworks.ethereum.testnet,
    });
    eth3 = eth2.deriveChild(1);
    USDCBalances = {
      [eth1.address]: BigInt(10e3 * 1e6),
      [eth2.address]: BigInt(10e3 * 1e6),
      [eth3.address]: BigInt(1e3 * 1e6),
    };
  });

  test('should be able to audit the holdings of a Sidechain', async () => {
    config.neuteredHDWalletsForReserves = [
      eth1.exportNeuteredKey(),
      eth2.exportNeuteredKey(),
      eth3.exportNeuteredKey(),
    ].map(x => EthereumHDWallet.loadNeutered(x));

    const testClient1 = new TestClient();
    await testClient1.grantCentagons(21e3 * 1e2);
    config.sidechainAddressesForReserves = [testClient1.credentials.address];

    jest
      .spyOn(USDCApi.prototype, 'currentBlockNumber')
      .mockImplementation(() => Promise.resolve(10));
    jest.spyOn(USDCApi.prototype, 'getBalanceOf').mockImplementation(async address => {
      return USDCBalances[address];
    });

    const audit = await RampApp.db.transaction(db =>
      RampAudit.createAudit(db, 1, BigInt(21e3 * 1e2)),
    );
    expect(audit.signaturesCompleteDate).toBeUndefined();
    expect(audit.proofOfUsdcAddressCustody).toHaveLength(3);
    expect(audit.usdcAddresses).toHaveLength(3);
    expect(audit.usdcReservesE6).toBe(BigInt(21e3 * 1e6));
    expect(audit.usdcAddresses.some(x => x.address === eth1.address)).toBeTruthy();
    expect(audit.usdcAddresses.some(x => x.address === eth2.address)).toBeTruthy();
    expect(audit.usdcAddresses.some(x => x.address === eth3.address)).toBeTruthy();
    expect(audit.argonsInCirculationE6).toBe(BigInt(21e3 * 1e6));
  });

  test('should be able to sign audits proving ownership', async () => {
    const signatures1 = await RampAudit.signAudits(eth1);
    expect(signatures1).toHaveLength(1);
    expect(signatures1[0].proofOfUsdcAddressCustody.filter(Boolean)).toHaveLength(1);

    const signatures2 = await RampAudit.signAudits(eth2);
    expect(signatures2).toHaveLength(1);
    expect(signatures2[0].proofOfUsdcAddressCustody.filter(Boolean)).toHaveLength(3);
    expect(signatures2[0].signaturesCompleteDate).toBeTruthy();

    const audit = await RampAuditEndpoint.handler(undefined, { logger: null });
    expect(audit.argonsInCirculation_e6).toBe(BigInt(21e3 * 1e6));
    expect(audit.usdcReserves_e6).toBe(BigInt(21e3 * 1e6));
    expect(audit.usdcReserveAddresses).toHaveLength(3);

    jest.spyOn(USDCApi.prototype, 'getBalanceOf').mockImplementation(async address => {
      return USDCBalances[address];
    });
    // validate
    await expect(validateAudit(audit)).resolves.toEqual({ issues: [], isValid: true });
  });
});
