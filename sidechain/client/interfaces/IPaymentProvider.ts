import IMicronote from './IMicronote';

export default interface IPaymentProvider {
  createMicronote(microgons: number, isAuditable: boolean): Promise<IMicronote>;
}
