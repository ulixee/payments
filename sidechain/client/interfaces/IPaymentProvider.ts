import IMicronote from './IMicronote';

export default interface IPaymentProvider {
  createMicronote(microgons: number, isAuditable: boolean, schemaUri?: string): Promise<IMicronote>;
}
