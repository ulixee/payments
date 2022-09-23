import buildGenesisBlock from '../lib/buildGenesisBlock';

test('should create the genesis block hash consistenntly', async  () => {
  const block1 = buildGenesisBlock();
  const block2 = buildGenesisBlock();
  expect(block1).toStrictEqual(block2);
})
