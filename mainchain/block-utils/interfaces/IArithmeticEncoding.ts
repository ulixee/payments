export default interface IArithmeticEncoding {
  powerOf2: number;
  multiplierInThousandths?: number;
}

export function convertToBigInt(encoding: IArithmeticEncoding): bigint {
  return (2n ** BigInt(encoding.powerOf2 ?? 1n) * BigInt(encoding.multiplierInThousandths ?? 1000n)) / 1000n;
}
