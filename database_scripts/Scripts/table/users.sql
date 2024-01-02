-- prod.users definition

-- Drop table

-- DROP TABLE prod.users;

CREATE TABLE prod.users (
	id serial4 NOT NULL,
	id_telegram int4 NOT NULL,
	CONSTRAINT users_id_telegram_key UNIQUE (id_telegram),
	CONSTRAINT users_pkey PRIMARY KEY (id)
);