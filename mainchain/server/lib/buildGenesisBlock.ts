import { IBlock, ITransaction, TransactionType } from '@ulixee/specification';
import { hashObject } from '@ulixee/commons/lib/hashUtils';
import MerkleTree from '@ulixee/crypto/lib/MerkleTree';
import config from '../config';

export default function buildGenesisBlock(): IBlock {
  let time = new Date('2022-10-01T12:00:00.000Z');

  const genesisSettings = config.genesisSettings;

  const block = {
    header: null,
    stableLedger: [],
    sharesLedger: [],
    coinages: [],
    sidechainGovernance: {
      authorizedSidechains: genesisSettings.authorizedSidechains.map(x => {
        return {
          ...x,
          sidechainHash: hashObject(x),
        };
      }),
    },
    datumSummary: null,
    bitSampling: null,
  } as IBlock;

  // stable coin bootstrap backed by DLF USDC
  let stableCentagonsCreated = 0n;
  block.stableLedger = genesisSettings.bootstrappedReserves.map(funding => {
    stableCentagonsCreated += funding.centagons;
    funding.time ??= time;

    if (funding.time > time) time = funding.time;

    const tx = {
      version: '1',
      type: TransactionType.COINBASE,
      time: funding.time,
      expiresAtBlockHeight: undefined,
      sources: [],
      outputs: [
        {
          centagons: funding.centagons,
          address: genesisSettings.authorizedSidechains[0].transferInAddress,
          addressOnSidechain: funding.address,
          isSidechained: true,
          isBond: false,
          isBurned: false,
        },
      ],
    } as ITransaction;
    tx.transactionHash = hashObject(tx);
    return tx;
  });

  block.header = {
    version: '1',
    height: 0,
    time,
    prevBlockHash: null,
    xoredCandidateAverage: 2,
    xoredCandidateDistance: { powerOf2: 256 },
    nextLinkTarget: { ...genesisSettings.startingDifficulty },
    stableCoinVolume: Number(stableCentagonsCreated / 100n),
    stableCoinUSDCents: 100,
    stableMerkleRoot: new MerkleTree(block.stableLedger.map(x => x.transactionHash)).getRoot(),
    sidechainChangesHash: hashObject(
      Buffer.concat(block.sidechainGovernance.authorizedSidechains.map(x => x.sidechainHash)),
    ),
    bondCentagonsCreated: 0n,
    sharesMerkleRoot: null,
    sampledBitsHash: null,
    datumSummaryHash: null,
    coinagesHash: null,
    linkNonce: null,
    hash: null, // Calculate next!
    sidechainSnapshotsHash: null,
  };

  block.header.hash = hashObject(block.header, { ignoreProperties: ['hash'] });

  return block;
}
