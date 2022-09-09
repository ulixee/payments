export default class ArgonUtils {
  static CentagonsPerArgon = 100n;
  static MicrogonsPerArgon = 1000000n;
  static MicrogonsPerCentagon = 10000n;

  static parseUnits(units: string, output: 'centagons'): bigint;
  static parseUnits(units: string, output: 'microgons'): number;
  static parseUnits(units: string, output: 'centagons' | 'microgons'): bigint | number {
    let value = Number(units.substring(0, units.length - 1));
    if (output === 'microgons') {
      if (units.endsWith('c')) value = this.centagonsToMicrogons(value);
      return value;
    }

    // if centagons
    if (units.endsWith('m')) return this.microgonsToCentagons(value);
    return BigInt(value);
  }

  static format(value: number, units: 'centagons' | 'microgons'): string {
    if (units === 'microgons') {
      let amount = `${value}m`;
      if (value % Number(this.MicrogonsPerCentagon) === 0) {
        amount = `${this.microgonsToCentagons(value).toString()}c`;
      }
      return amount;
    }
    return `${value}c`;
  }

  static microgonsToCentagons(microgons: number | bigint, floor = true): bigint {
    if (!floor) return BigInt(Math.ceil(Number(microgons) / Number(this.MicrogonsPerCentagon)));

    if (typeof microgons === 'number') {
      // don't allow any extra precision
      microgons = BigInt(Math.floor(microgons));
    }

    return microgons / this.MicrogonsPerCentagon;
  }

  static centagonsToMicrogons(centagons: bigint | number): number {
    return Number(centagons) * Number(this.MicrogonsPerCentagon);
  }
}
