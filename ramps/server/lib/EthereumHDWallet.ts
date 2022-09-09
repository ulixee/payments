import { utils, Wallet } from 'ethers';
import { randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { IBlockchain } from './USDCNetworks';

export default class EthereumHDWallet<T extends IBlockchain> {
  public static basePath = utils.defaultPath.slice(0, -1); // trim trailing 0
  public get address(): string {
    return this.node.address;
  }

  public get mnemonic(): utils.Mnemonic {
    return this.node.mnemonic;
  }

  public wallet: Wallet;

  constructor(public meta: IHDWalletMeta<T>, private node: utils.HDNode, public readonly path) {
    this.wallet = node.mnemonic ? new Wallet(node) : null;
  }

  public deriveChild(fullPathOrIndex: number | string): EthereumHDWallet<T> {
    const path =
      typeof fullPathOrIndex === 'string'
        ? fullPathOrIndex
        : EthereumHDWallet.basePath + fullPathOrIndex;
    if (this.path === path) return this;

    const childIndex = path.replace(EthereumHDWallet.basePath, '');

    const node = this.node.derivePath(childIndex);

    return new EthereumHDWallet(this.meta, node, path);
  }

  public exportNeuteredKey(): string {
    const { rootWalletGuid, blockchainNetwork, blockchain } = this.meta;
    const extendedKey = this.node.neuter().extendedKey;
    return [
      blockchain,
      blockchainNetwork,
      rootWalletGuid,
      extendedKey,
      this.path.split('/').pop(),
    ].join('/');
  }

  public async exportFull(
    password: string,
    options?: { scryptIterations: number },
  ): Promise<IHDWalletJson<T>> {
    const encryptOptions: any = {};
    if (options?.scryptIterations) encryptOptions.scrypt = { N: options.scryptIterations };
    return { meta: this.meta, keystoreJson: await this.wallet.encrypt(password, encryptOptions) };
  }

  static create<T extends IBlockchain>(
    meta: Omit<IHDWalletMeta<T>, 'rootWalletGuid'>,
    options: IHDWalletOptions = {},
  ): EthereumHDWallet<T> {
    const entropy = randomBytes(16);
    const mneumonic = utils.entropyToMnemonic(entropy, options.wordlistLocale);
    const fullMeta = meta as IHDWalletMeta<any>;
    fullMeta.rootWalletGuid = nanoid(5);

    const node = utils.HDNode.fromMnemonic(mneumonic, null, options.wordlistLocale).derivePath(
      utils.defaultPath,
    );

    return new EthereumHDWallet(fullMeta, node, utils.defaultPath);
  }

  static loadNeutered<T extends IBlockchain>(keyPath: string): EthereumHDWallet<T> {
    const [blockchain, blockchainNetwork, rootWalletGuid, extendedKey, index] = keyPath.split('/');
    const node = utils.HDNode.fromExtendedKey(extendedKey);

    return new EthereumHDWallet<T>(
      { blockchainNetwork, blockchain, rootWalletGuid } as IHDWalletMeta<T>,
      node,
      this.basePath + index,
    );
  }

  static async loadFromEncrypted<T extends IBlockchain>(
    json: IHDWalletJson<T>,
    password: string,
  ): Promise<EthereumHDWallet<T>> {
    const wallet = await Wallet.fromEncryptedJson(json.keystoreJson, password);

    const mnemonic = wallet.mnemonic;
    const node = utils.HDNode.fromMnemonic(mnemonic.phrase, null, mnemonic.locale).derivePath(
      mnemonic.path,
    );
    return new EthereumHDWallet(json.meta, node, mnemonic.path);
  }
}

export interface IHDWalletJson<T extends IBlockchain> {
  meta: IHDWalletMeta<T>;
  keystoreJson: string;
}

export interface IHDWalletMeta<T extends IBlockchain> {
  rootWalletGuid: string;
  blockchain: T;
  blockchainNetwork: string;
}

export interface IHDWalletOptions {
  wordlistLocale?: string;
}
