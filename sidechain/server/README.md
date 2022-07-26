## Quick Security/User Overview

Users are identified by public keys that are part of an ECSDA keypair.  
Each request to private data will be signed using the users private key.

# Ledger

The ledger keeps track of full balances for each associated public key

### v1:

- Tracks all credits and debits in a transactions table
- Balance is retrieved by summing amounts where current user (public key) is
  the "to_address" and then subtracting where they are the "from_address"

### Volumes (< 100k? users):

The MicronoteBatch service should guarantee that each consumer has limited
outputs from the ledger (~1/day) and probably 1 change returned. Each miner will likely
have 1 stake transaction, and 1 return, and then 1\*n (n = clients) transactions.

Expected data volume is therefore 2*consumers + 2*miners + X queries per
consumer \* miners.

If there are 100k consumers, producing an average of 5000 queries per day, we should expect
to have 100,000 \* 5,000 = 500M queries/day. If a miner can handle 10tx/5 seconds, then
we will probably have around 6000 miners. Assume there are 10000 decoder scripts owners and 200 routers
that are not already miners (tbd: better calc on these).

Worst case, this means each day has 100k*2 + (6000 + 10000 + 200)*2 = 223,400 transaction outputs to the ledger (1.3/second).

NOTE: This does not account for routers/decoder scripts, and distribution will likely not be this bad

### Infrastructure

1. Kubernetes cluster of nodes
1. Postgres for db (Aurura for redundancy?)
1. Process to cleanup old partitions and move to longer term storage

### Scaling Challenges

1.  Write volume
    1. Shard database
    1. Summarize writes (by period - day/hour) into static tables (account -> balance)
    1. Full summary of current balance
1.  Sum current balance
    1. Partition transactions by day
    1. Cache value for read transactions against ledger
    1. Create baseline rows that you add to sum (or a separate summary table)
