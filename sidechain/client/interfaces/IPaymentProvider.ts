import IMicronoteDetails from './IMicronoteDetails';

export default interface IPaymentProvider {
  createMicronote(
    microgons: number,
    recipientAddresses: string[],
    isAuditable: boolean,
  ): Promise<IMicronoteDetails>;
}
