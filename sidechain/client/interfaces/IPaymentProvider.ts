import IMicronote from './IMicronote';

export default interface IPaymentProvider {
  createMicronote(
    microgons: number,
    recipientAddresses: string[],
    isAuditable: boolean,
  ): Promise<IMicronote>;
}
