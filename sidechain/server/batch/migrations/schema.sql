CREATE TABLE locks (
  address varchar(64) PRIMARY KEY
);

CREATE TABLE micronote_funds (
  id serial PRIMARY KEY,
  address varchar(64) NOT NULL,
  guarantee_block_height integer NOT NULL,
  note_hash bytea NULL,
  credit_id varchar(32) NULL,
  allowed_recipient_addresses varchar(64) ARRAY NULL,
  microgons integer NOT NULL
      CHECK (microgons > 0), --immutable stored once
  microgons_allocated integer DEFAULT 0 NOT NULL
      CHECK (microgons_allocated >= 0 and (microgons_allocated <= microgons)),
  last_updated_time timestamp NOT NULL DEFAULT NOW(),
  created_time timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE credits (
  id varchar(32) PRIMARY KEY,
  microgons integer NOT NULL CHECK (microgons > 0),
  allowed_recipient_addresses varchar(64) ARRAY NOT NULL,
  allowed_recipient_signatures json ARRAY NOT NULL,
  claim_address varchar(64) NULL,
  claimed_time timestamp NULL,
  funds_id integer NULL REFERENCES micronote_funds (id),
  funded_time timestamp NULL,
  last_updated_time timestamp NOT NULL DEFAULT NOW(),
  created_time timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_micronote_funds_address on micronote_funds (address);

CREATE TABLE micronotes (
  id varchar(64) PRIMARY KEY,
  funds_id integer NOT NULL REFERENCES micronote_funds (id),
  nonce bytea NOT NULL,
  block_height integer NOT NULL,
  client_address varchar(64) NOT NULL,
  microgons_allocated integer NOT NULL
      CHECK (microgons_allocated > 0),
  locked_by_identity varchar(64) NULL,
  locked_time timestamp NULL,
  claimed_time timestamp NULL,
  canceled_time timestamp NULL,
  is_auditable boolean,
  last_updated_time timestamp NOT NULL DEFAULT NOW(),
  created_time timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notes_client_address on micronotes (client_address);

CREATE TABLE micronote_recipients (
  micronote_id varchar(64) NOT NULL REFERENCES micronotes (id),
  address varchar(64) NOT NULL,
  microgons_earned integer NULL
      CHECK (microgons_earned > 0),
  created_time timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (micronote_id, address)
);

CREATE INDEX idx_note_recipients on micronote_recipients (address);

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
