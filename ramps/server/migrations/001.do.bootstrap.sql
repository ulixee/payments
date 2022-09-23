CREATE TABLE locks (
  id varchar(64) PRIMARY KEY
);

CREATE TABLE usdc_addresses (
  id serial PRIMARY KEY,
  blockchain varchar NOT NULL,
  blockchain_network varchar NOT NULL,
  usdc_address varchar NOT NULL,
  hd_wallet_guid varchar(10) NOT NULL, -- internal wallet id
  hd_wallet_index integer NOT NULL,
  sidechain_address varchar(62) NOT NULL, -- argon address
  monitoring_expiration_time date NOT NULL,
  allocated_at_block_number integer NOT NULL,
  last_checked_block_number integer NULL
);

CREATE UNIQUE INDEX idx_blockchain_address on usdc_addresses (blockchain, blockchain_network, usdc_address);
CREATE INDEX idx_wallet_guid on usdc_addresses(hd_wallet_guid);

CREATE TABLE usdc_transfers (
  id serial PRIMARY KEY,
  blockchain varchar NOT NULL,
  blockchain_network varchar NOT NULL,
  contract_address varchar NOT NULL,
  transaction_hash varchar NOT NULL,
  usdc bigint NOT NULL CHECK (usdc > 0),
  from_usdc_address varchar(64) NOT NULL,
  from_usdc_address_id integer NULL REFERENCES usdc_addresses(id),
  to_usdc_address varchar(64) NOT NULL,
  to_usdc_address_id integer NULL REFERENCES usdc_addresses(id),
  recorded_time timestamp NOT NULL DEFAULT NOW(),
  argon_conversion_rate numeric NOT NULL,
  block_number integer NOT NULL,
  block_hash varchar NOT NULL,
  note_hash bytea, -- record destination note once confirmed
  confirmed_block_number integer,
  confirmed_time timestamp
);
CREATE INDEX idx_usdc_transfers_ownership on usdc_transfers (blockchain, blockchain_network, to_usdc_address);
CREATE INDEX idx_unconfirmed_securities on usdc_transfers (confirmed_block_number)
  where confirmed_block_number is null;

CREATE TABLE consumer_price_index (
  date date PRIMARY KEY,
  value numeric NOT NULL,
  conversion_rate numeric NOT NULL
);

CREATE TABLE ramp_audits (
  audit_date date PRIMARY KEY,
  usdc_addresses JSON ARRAY NOT NULL,
  usdc_reserves_e6 bigint NOT NULL,
  usdc_to_argon_conversion_rate numeric NOT NULL,
  argons_in_circulation_e6 bigint NOT NULL,
  proof_of_usdc_address_custody varchar(132) ARRAY NOT NULL,
  signatures_complete_date date NULL
);
CREATE INDEX idx_ramp_audits_completed on ramp_audits (audit_date, signatures_complete_date)
  where signatures_complete_date is null;
