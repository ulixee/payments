export default class ArgonUtils {
  static CentagonsPerArgon = 100n;
  static MicrogonsPerArgon = 1000000n;
  static MicrogonsPerCentagon = 10000n;

  static parseUnits(units: string, output: 'centagons'): bigint;
  static parseUnits(units: string, output: 'microgons'): bigint;
  static parseUnits(units: string, output: 'argons'): bigint;
  static parseUnits(units: string, output: 'centagons' | 'microgons' | 'argons'): bigint {
    if (!units.endsWith('c') && !units.endsWith('m') && !units.endsWith('a')) {
      if (output === 'centagons') units += 'c';
      else units += 'm';
    }

    let value = BigInt(units.substring(0, units.length - 1));
    if (output === 'microgons') {
      if (units.endsWith('c')) value = BigInt(this.centagonsToMicrogons(value));
      if (units.endsWith('a')) value = this.microgonsToArgons(value);

      return value;
    }

    if (output === 'centagons') {
      if (units.endsWith('m')) return this.microgonsToCentagons(value);
      if (units.endsWith('a')) return this.microgonsToArgons(value);
      return BigInt(value);
    }

    // else argons
    if (units.endsWith('c')) return this.centagonsToArgons(value);
    if (units.endsWith('m')) return this.microgonsToArgons(value);

    return value;
  }

  static format(
    value: number | bigint,
    fromUnits: 'centagons' | 'microgons' | 'argons',
    toUnits?: 'centagons' | 'microgons' | 'argons',
  ): string {
    if (typeof value === 'number') {
      value = BigInt(value);
    }

    if (fromUnits === 'microgons') {
      if (
        toUnits === 'argons' ||
        value % (this.MicrogonsPerCentagon * this.CentagonsPerArgon) === 0n
      ) {
        return `${this.microgonsToRoundedArgons(value)}₳`;
      }
      if (toUnits === 'centagons' || value % this.MicrogonsPerCentagon === 0n) {
        return `${this.microgonsToCentagons(value).toString()}c`;
      }
      return `${value}₥`;
    }

    if (fromUnits === 'centagons') {
      if (toUnits === 'argons' || value % this.CentagonsPerArgon === 0n) {
        return `${this.centagonsToRoundedArgons(value)}₳`;
      }
      if (toUnits === 'microgons') {
        return `${this.centagonsToMicrogons(value)}c`;
      }
      return `${value}c`;
    }

    // from argons

    if (toUnits === 'centagons') {
      return `${value * this.CentagonsPerArgon}₳`;
    }
    if (toUnits === 'microgons') {
      return `${value * this.CentagonsPerArgon * this.MicrogonsPerCentagon}c`;
    }
    return `₳${value}`;
  }

  public static microgonsToCentagons(microgons: number | bigint, floor = true): bigint {
    if (typeof microgons === 'number') {
      if (!floor) microgons = BigInt(Math.ceil(microgons));
      // don't allow any extra precision
      else microgons = BigInt(Math.floor(microgons));
    }

    return microgons / this.MicrogonsPerCentagon;
  }

  public static centagonsToMicrogons(centagons: number | bigint): number {
    if (typeof centagons === 'number') {
      centagons = BigInt(centagons);
    }
    return Number(centagons * this.MicrogonsPerCentagon);
  }

  private static microgonsToArgons(microgons: number | bigint, floor = true): bigint {
    if (typeof microgons === 'number') {
      if (!floor) microgons = BigInt(Math.ceil(microgons));
      // don't allow any extra precision
      else microgons = BigInt(Math.floor(microgons));
    }

    return microgons / this.MicrogonsPerCentagon / this.CentagonsPerArgon;
  }

  private static microgonsToRoundedArgons(microgons: number | bigint): number {
    return Math.round(Number(this.microgonsToArgons(BigInt(microgons) * 100n))) / 100;
  }

  private static centagonsToArgons(centagons: bigint): bigint {
    return centagons / this.CentagonsPerArgon;
  }

  private static centagonsToRoundedArgons(centagons: number | bigint): number {
    if (typeof centagons === 'number') {
      centagons = BigInt(centagons);
    }
    return Math.round(100 * Number(this.centagonsToArgons(centagons))) / 100;
  }
}
