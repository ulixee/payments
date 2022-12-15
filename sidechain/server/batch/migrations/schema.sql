CREATE TABLE locks (
  address varchar(64) PRIMARY KEY
);

CREATE TABLE micronote_funds (
  id varchar(30) PRIMARY KEY,
  address varchar(64) NOT NULL,
  guarantee_block_height integer NOT NULL,
  note_hash bytea NULL,
  allowed_recipient_addresses varchar(64) ARRAY NULL,
  microgons integer NOT NULL
      CHECK (microgons > 0), --immutable stored once
  microgons_allocated integer DEFAULT 0 NOT NULL
      CHECK (microgons_allocated >= 0 and (microgons_allocated <= microgons)),
  last_updated_time timestamp NOT NULL DEFAULT NOW(),
  created_time timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_micronote_funds_address on micronote_funds (address);

CREATE TABLE micronotes (
  id varchar(64) PRIMARY KEY,
  funds_id varchar(30) NOT NULL REFERENCES micronote_funds (id),
  nonce bytea NOT NULL,
  block_height integer NOT NULL,
  client_address varchar(64) NOT NULL,
  microgons_allocated integer NOT NULL
      CHECK (microgons_allocated > 0),
  locked_by_identity varchar(64) NULL,
  locked_time timestamp NULL,
  hold_authorization_code varchar(16) NOT NULL,
  has_settlements boolean NOT NULL,
  finalized_time timestamp NULL,
  canceled_time timestamp NULL,
  is_auditable boolean,
  last_updated_time timestamp NOT NULL DEFAULT NOW(),
  created_time timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_micronotes_client_address on micronotes (client_address);

CREATE TABLE micronote_transactions (
  id varchar(30) NOT NULL PRIMARY KEY,
  funds_id varchar(30) NULL REFERENCES micronote_funds (id),
  micronote_id varchar(64) NOT NULL REFERENCES micronotes (id),
  parent_id varchar(30)  NULL REFERENCES micronote_transactions(id),
  type varchar(25) NOT NULL,
  identity varchar(64) NOT NULL,
  microgons integer NOT NULL,
  created_time timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_micronote_transactions_id on micronote_transactions (micronote_id);
CREATE INDEX idx_micronote_transactions_funds_id on micronote_transactions (funds_id);

CREATE TABLE micronote_disbursements (
  micronote_id varchar(64) NOT NULL REFERENCES micronotes (id),
  address varchar(64) NOT NULL,
  microgons_earned integer NULL CHECK (microgons_earned > 0),
  last_updated_time timestamp NOT NULL DEFAULT NOW(),
  created_time timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (micronote_id, address)
);

CREATE INDEX idx_micronote_disbursements on micronote_disbursements (address);

CREATE TABLE note_outputs (
  note_hash bytea PRIMARY KEY,
  from_address varchar(64) NOT NULL, -- should always be the micronoteBatch address
  to_address varchar(64) NOT NULL,
  centagons bigint NOT NULL CHECK (centagons > 0), --the amount moved from From to To
  timestamp timestamp NOT NULL, --the time the transaction funds are available
  effective_block_height integer NULL,
  type integer NOT NULL,
  signature json NOT NULL,
  guarantee_block_height integer NOT NULL
);

CREATE TABLE gift_cards (
  id varchar(12) PRIMARY KEY,
  issued_microgons integer NOT NULL CHECK (issued_microgons > 0),
  redemption_key varchar(64) NOT NULL,
  issuer_identities varchar(64) ARRAY NOT NULL,
  issuer_signatures BYTEA ARRAY NOT NULL,
  last_updated_time timestamp NOT NULL DEFAULT NOW(),
  created_time timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE gift_card_transactions (
  id varchar(32) PRIMARY KEY,
  gift_card_id varchar(12) REFERENCES gift_cards(id),
  microgons_debited integer NOT NULL,
  hold_time timestamp NULL,
  canceled_time timestamp NULL,
  settled_time timestamp NULL,
  created_time timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_gift_card_transaction_card_id on gift_card_transactions (gift_card_id);
