CREATE TABLE addresses (
  address varchar(64) PRIMARY KEY,
  created_at timestamp NOT NULL DEFAULT NOW()
 ) WITH (autovacuum_enabled=false);

CREATE TABLE notes (
  note_hash bytea PRIMARY KEY,
  from_address varchar(64) NOT NULL,
  to_address varchar(64) NOT NULL,
  centagons bigint NOT NULL CHECK (centagons > 0), --the amount moved from From to To
  timestamp timestamp NOT NULL, --the time the note occurred
  effective_block_height integer null CHECK (effective_block_height > 0),
  type integer NOT NULL,
  signature json NOT NULL,
  guarantee_block_height integer NOT NULL
);

-- TODO: partition notes table (probably by date at first)
-- TODO2: create summary tables after we drop off from partition table

CREATE INDEX idx_note_lookup_from on notes (from_address);
CREATE INDEX idx_note_lookup_to on notes (to_address);

CREATE TABLE mainchain_blocks (
  block_hash bytea NOT NULL PRIMARY KEY,
  height integer NOT NULL,
  next_link_target json NOT NULL,
  prev_block_hash bytea NULL REFERENCES mainchain_blocks(block_hash),
  is_longest_chain boolean NOT NULL DEFAULT false
);

CREATE TABLE stakes (
  identity varchar(64) NOT NULL PRIMARY KEY,
  address varchar(64) NOT NULL,
  note_hash bytea NOT NULL REFERENCES notes(note_hash),
  block_start_height integer NOT NULL,
  open_date timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE stake_history (
  identity varchar(64) NOT NULL,
  address varchar(64) NOT NULL,
  note_hash bytea NOT NULL REFERENCES notes(note_hash),
  block_start_height integer NOT NULL,
  block_end_height integer NOT NULL,
  refund_note_hash bytea NULL,
  open_date timestamp NOT NULL DEFAULT NOW(),
  closed_date timestamp NOT NULL,
  PRIMARY KEY (address, block_start_height)
);

CREATE INDEX idx_stake_address on stakes (address);

CREATE TABLE securities (
  transaction_hash bytea NOT NULL,
  transaction_output_index integer NOT NULL,
  transaction_output_address varchar(64) NOT NULL, -- need to store to be able to output
  transaction_time text NOT NULL,
  centagons bigint NOT NULL CHECK (centagons > 0),
  from_address varchar(64) NOT NULL,
  to_address varchar(64) NOT NULL,
  is_to_sidechain boolean NOT NULL,
  is_burn boolean NOT NULL default false,
  is_transfer_in boolean NOT NULL default false,
  note_hash bytea NULL REFERENCES notes (note_hash), -- record if this ends up in notes
  spent_on_transaction_hash bytea NULL,
  confirmed_block_height integer NULL,
  PRIMARY KEY (transaction_hash, transaction_output_index)
);

CREATE INDEX idx_mainchain_security_ownership on securities (to_address);
CREATE INDEX idx_securities_unspent on securities (spent_on_transaction_hash, is_to_sidechain)
  where spent_on_transaction_hash is null and is_to_sidechain = true;
CREATE INDEX idx_unconfirmed_securities on securities (confirmed_block_height)
  where confirmed_block_height is null;

CREATE TABLE security_mainchain_blocks (
  transaction_hash bytea NOT NULL,
  block_hash bytea NOT NULL REFERENCES mainchain_blocks (block_hash),
  block_height integer NOT NULL,
  block_stable_ledger_index integer NOT NULL,
  PRIMARY KEY (transaction_hash, block_hash)
);

CREATE TABLE funding_transfers_out (
  note_hash bytea NOT NULL PRIMARY KEY references notes (note_hash),
  transaction_hash bytea NULL
);
CREATE INDEX idx_unsettled_funding_transfers_out on funding_transfers_out (transaction_hash) where transaction_hash is null;

CREATE TABLE micronote_batches (
  address varchar(64) PRIMARY KEY,
  slug varchar(14) NOT NULL,
  type varchar(10) NOT NULL,
  private_key bytea NOT NULL, -- TODO: move to a vault at some point
  open_time timestamp NOT NULL DEFAULT NOW(),
  stop_new_notes_time timestamp NULL,
  planned_closing_time  timestamp NULL,
  closed_time timestamp,
  settled_time timestamp
);

CREATE INDEX idx_unsettled_batches on micronote_batches (settled_time) where settled_time is null;

CREATE TABLE micronote_batch_outputs (
  address varchar(64) PRIMARY KEY REFERENCES micronote_batches (address),
  start_block_height integer NOT NULL,
  end_block_height integer NOT NULL,
  guarantee_block_height integer NOT NULL,
  archive_path varchar NULL,
  new_notes_hash bytea NOT NULL,
  new_notes_count integer NOT NULL,
  funding_microgons bigint NOT NULL,
  allocated_microgons bigint NOT NULL,
  revenue_microgons bigint NOT NULL,
  micronotes_count integer NOT NULL,
  settled_centagons bigint NOT NULL,
  burned_centagons bigint NOT NULL,
  settlement_fee_centagons bigint NOT NULL,
  burn_note_hash bytea NULL references notes (note_hash),
  burn_security_transaction_hash bytea NULL
) WITH (autovacuum_enabled=false);

CREATE INDEX idx_micronote_batch_outputs_security on micronote_batch_outputs (burn_security_transaction_hash);

CREATE TABLE mainchain_transactions (
  transaction_hash bytea NOT NULL PRIMARY KEY,
  data json NOT NULL
);
