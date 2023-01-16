# Ulixee Payments
This repository hosts a per-query payment mechanism for the Ulixee Network. It aims to eventually be a fully decentralized payments system. However, version 1 has the underpinnings of decentralization run from central authorities. As we prove out the model and security, we will open up the network to more running nodes.

```
NOTE: this repo is public, but not intended to be run on your own yet -- we don't have 
documentation for doing so, and we're not ready to actively support running sidechains quite yet.
```

## High Level
Ulixee Payments are based on the Bitcoin protocol - it's a proof of work blockchain that uses data queries instead of energy to provide chain security. It also inherits the UXTO model. Ulixee Payments diverge from Bitcoin in the following ways:
1. It integrates an algorithmic stable coin protocol: selling discounted bonds to bring the price back towards baseline, and minting more currency when prices rise above baseline (eg, floating more currency supply to reduce prices).
2. It has no scripting. Multisig is built-in, which was our primary use case for scripting.
3. The blockchain provides evidence of Data work to close blocks.
4. A Sidechain construct is built-in for scaling per-query data payments.

## Primitives
### Address
Addresses are the source and destination "addresses" where money can be sent and received. Their string representations look like `ar1tlju6l6wvm6h20r2yp06vl49r5tpak32ag076jx8lswsas3dkzxsq8ltzv` (starting with ar for Argon, and containing a bech32 encoded merkle root of keys). Internally, an address consists of 1 to 6 ED25519 keys that are held private via a Merkle Tree. Addresses define how many of the keys a signature must contain, along with an optional Salt value.

### Identities
Identities are bech32 encoded ED25519 key pairs. Their string representations start with `id1` and contain a bech32 encoded public key. Identities are a mechanism for providing proof of identity or ownership within the Ulixee network. Underneath, it uses standard cryptographic signatures and PEM storage.

## Denominations
Ulixee Payments (or tokens) come in the following denominations:
- *Argon*: ~1 USD adjusted for inflation.
- *Centagon*: ~1 hundredth of a USD adjusted for inflation. These are the base currency for the Sidechain and Mainchain network.
- *Microgon*: ~1 millionth of a USD adjusted for inflation. These are used for micro payments.

NOTE: the naming of the Ulixee currency derives from Ulysses (which Ulixee is a derivation of). Ulysses trusted dog was named Argos. Argon is also the most stable gaseous element, which is an attribute the currency strives to achieve.

## Mainchain
This the is the name given to the blockchain model run by the Ulixee network. The mainchain will re-generate a single block in the shortterm until it begins running again in full.

## Sidechain
Ulixee Payments operate with a Federated Sidechain model. Sidechains provide a mechanism to creates 8-hour batches of micro-transactions. This enables many small payments to be paid out to multiple players that are below the smallest fiat amounts (eg, 1 cent). The aggregate of work is translated back to fiat level transactions that "settle" to a centralized double-entry accounting ledger. Sidechains are required to produce full transparency showing backing assets, full money traceability, and adherence to "network" decided rules. 

Sidechains have the following attributes:
- *Fully transparent*.
- *Trustless*: all sidechain queries require PublicKey interface signatures for verification of ownership and operation. There are no accounts or contracts.
- *Deflationary*: sidechains are required to burn a percent of micro transactions to reduce the supply of currency.
- *USDC-backed*: sidechains are (at least in phase 1) completely backed by USDC holdings.
- *Multisig support*: supporting the same multisig properties as the Mainchain.
-
### Sidechain Concepts
- *Address*: a holding location for currency
- *Note*: like a bank note, Notes are transfers of currency between Addresses. Denomination: Centagons.
- *MicronoteBatch*: batches are short duration servers that allow for a high volume of micro transactions that are bundled together for settlement. This mechanism allows for a horizontally scalable system, as many batches can exist concurrently. Batches allow funds to be transferred in using signed Notes, and Micronote transacions are created in a batch to allow for tiny transfers of value.
- *Micronote*: a reserved amount for a variable price data query. The resulting "Payment" is a signed packet containing verification of funds, verification of Sidechain authority, and verification of MicronoteBatch validity.
- *MicronoteBatchFund*: funding transferred into a MicronoteBatch from the Note ledger. Unused funds will be transferred back to source Addresses when a batch is settled.

_For Future Use_
- *Stake*: put up money to claim authoriation to be an node the decentralized network. This is a security deposit that can be taken if a node fails to follow network rules.
- *Transfers*: move money from the sidechain to the Mainchain (and back). This will be re-enabled once the Mainchain has utility again.
- *Sidechain Snapshots*: sidechains provide a full dump to the Mainchain as a security feature in the case that a Sidechain is found to be violating rules, operating unethically or goes defunct.

## Code base
This codebase has extract and converted some of the Sidechain and Mainchain projects from the Ulixee alpha network (deployed in 2019). Please note that some code has been ported which is not in active use (eg, Sidechain Stake, Sidechain transfers from the Mainchain, etc)

Below are brief overviews of the current structure:
* *mainchain*: this repo has some basics for network block settings and closing blocks.
  - *wallet*: a storage mechanism for Addresses and Mainchain Unspent Transaction Outputs. Currently only used for small use-cases in the Sidechain.
  - *client*: an api client for accessing Mainchain data elements, creating transactions, etc.
  - *block-utils*: features for calculating block closing, determing block nonce difficulty, etc.
* *sidechain*: 
  - *server*: a Postresql based Sidechain server capable of generating the full lifecycle of Micronote Batches. The code is structured so that MicronoteBatches and the Notes ledger can eventually be run on separate servers.
  - *client*: a client usable by CLI and Data queriers to use the various Sidechain features.
