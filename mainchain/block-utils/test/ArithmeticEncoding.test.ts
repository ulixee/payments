import ArithmeticEncoding, { log2Floor } from '../lib/ArithmeticEncoding';

test('log2Floor', async () => {
  expect(log2Floor(2n)).toBe(1);
  expect(log2Floor(3n)).toBe(1);
  expect(log2Floor(4n)).toBe(2);
  expect(log2Floor(6n)).toBe(2);
  expect(log2Floor(2000n)).toBe(10);
});

test('arithmetic encoding should be within 1000 precision (it is not exact)', async () => {
  const max = 115792089237316195423570985008687907853269984665640564039457584007913129639936n;
  expect(new ArithmeticEncoding({ powerOf2: 256 }).toBigInt()).toBe(max);
  expect(ArithmeticEncoding.fromBigInt(max).powerOf2).toBe(256);
  expect(ArithmeticEncoding.fromBigInt(max).multiplierE6).toBe(1e6);

  expect(ArithmeticEncoding.fromBigInt(1957355847n).toBigInt() - 1957355847n).toBeLessThanOrEqual(
    1000n,
  );

  expect(
    ArithmeticEncoding.fromBigInt(115792089237316195423570985008687907853269n).toBigInt() -
      115792089237316195423570985008687907853269n,
  ).toBeLessThanOrEqual(1000n);
});
