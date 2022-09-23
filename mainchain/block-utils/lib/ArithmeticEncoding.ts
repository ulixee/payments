import IArithmeticEncoding from '@ulixee/specification/types/IArithmeticEncoding';

export default class ArithmeticEncoding implements IArithmeticEncoding {
  private static BaseConversion = BigInt(1.0e6);
  public powerOf2: number;
  // multiplier up to 1.000001 => 1000001. Means precision is not exact
  public multiplierE6: number;

  constructor(data: IArithmeticEncoding) {
    this.powerOf2 = data.powerOf2;
    this.multiplierE6 = data.multiplierE6 ?? 1.0e6;
  }

  public toBigInt(): bigint {
    return (
      (2n ** BigInt(this.powerOf2 ?? 1n) * BigInt(this.multiplierE6)) /
      ArithmeticEncoding.BaseConversion
    );
  }

  public static fromBigInt(value: bigint): ArithmeticEncoding {
    const powerOf2 = log2Floor(value);

    const model: IArithmeticEncoding = { powerOf2 };
    const power = 2n ** BigInt(powerOf2);
    model.multiplierE6 = Number((ArithmeticEncoding.BaseConversion * value) / power);

    return new ArithmeticEncoding(model);
  }
}

export function log2Floor(value: bigint): number {
  let power = 0;
  do {
    power += 1;
    value /= 2n;
  } while (value >= 2n);

  return power;
}
